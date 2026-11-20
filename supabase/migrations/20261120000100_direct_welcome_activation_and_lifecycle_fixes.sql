-- Direct Resend transactional welcome & project activation tracking + lifecycle engine fixes:
--   1. Idempotency stamps (`profiles.welcome_email_sent_at`, `projects.activation_email_sent_at`)
--      so Day-0 transactional welcome and project-activation emails deliver directly via Resend
--      without depending on GoHighLevel, `synced_to_ghl`, or the lifecycle cron switch.
--   2. Fix contractor role race in `lifecycle_action_state` (`signup_intent = 'contractor'`).
--   3. Make `reply_domain` optional for enabling delivery and sending reminders/replies
--      (falls back to `sender_email` as Reply-To when inbound reply domain is not configured).
--   4. Remove the 24-hour penalty on `communications_paused` / `outside_test_group` holds in
--      `reconcile_lifecycle_enrollment` so unpausing delivery resumes within minutes.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamptz;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS activation_email_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.admin_save_communication_settings(p_settings jsonb, p_expected_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  s public.communication_settings%ROWTYPE;
  v_name text; v_email text; v_followup text; v_application text; v_domain text;
  v_owner uuid; v_test text[]; v_enabled boolean; v_hours int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT * INTO s FROM public.communication_settings WHERE id FOR UPDATE;
  IF s.updated_at IS DISTINCT FROM p_expected_at THEN RAISE EXCEPTION 'stale_settings'; END IF;
  v_name := btrim(p_settings->>'sender_name');
  v_email := lower(btrim(p_settings->>'sender_email'));
  v_domain := lower(btrim(p_settings->>'reply_domain'));
  v_followup := lower(btrim(coalesce(p_settings->>'followup_sender_email', s.followup_sender_email)));
  v_application := lower(btrim(coalesce(p_settings->>'application_sender_email', s.application_sender_email)));
  v_owner := nullif(p_settings->>'default_owner_id', '')::uuid;
  v_enabled := coalesce((p_settings->>'delivery_enabled')::boolean, false);
  v_hours := coalesce((p_settings->>'next_contact_hours')::int, 48);
  SELECT coalesce(array_agg(DISTINCT lower(btrim(value))), '{}') INTO v_test
    FROM jsonb_array_elements_text(coalesce(p_settings->'test_recipients', '[]')) value
    WHERE btrim(value) <> '';
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 100 OR v_name ~ '[<>\r\n]' OR v_hours NOT BETWEEN 1 AND 720 OR cardinality(v_test) > 100 THEN
    RAISE EXCEPTION 'invalid_settings';
  END IF;
  IF coalesce(v_email, '') <> '' AND v_email !~ '^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' THEN
    RAISE EXCEPTION 'invalid_sender';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[v_followup, v_application]) value WHERE coalesce(value, '') !~ '^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$') THEN
    RAISE EXCEPTION 'invalid_sender';
  END IF;
  IF coalesce(v_domain, '') <> '' AND v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
    RAISE EXCEPTION 'invalid_reply_domain';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_test) value WHERE value !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$') THEN
    RAISE EXCEPTION 'invalid_test_recipient';
  END IF;
  IF v_owner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = v_owner AND role = 'admin') THEN
    RAISE EXCEPTION 'owner_must_be_admin';
  END IF;
  -- Sender address is required to enable delivery; reply_domain is optional (falls back to sender_email).
  IF v_enabled AND coalesce(v_email, '') = '' THEN
    RAISE EXCEPTION 'configure_sender_and_replies';
  END IF;
  UPDATE public.communication_settings
     SET sender_name = v_name,
         sender_email = nullif(v_email, ''),
         reply_domain = nullif(v_domain, ''),
         followup_sender_email = v_followup,
         application_sender_email = v_application,
         delivery_enabled = v_enabled,
         test_recipients = v_test,
         default_owner_id = v_owner,
         next_contact_hours = v_hours,
         updated_at = clock_timestamp(),
         updated_by = auth.uid()
   WHERE id RETURNING * INTO s;
  RETURN to_jsonb(s);
END $$;

CREATE OR REPLACE FUNCTION public.lifecycle_action_state(p_enrollment uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  e public.lifecycle_enrollments%ROWTYPE;
  v_uid uuid; v_signup_intent text; v_project uuid;
  v_owner uuid; v_status text; v_intent text; v_token uuid; v_invite record;
  v_reason text := 'ready'; v_kind text := 'ready';
  v_qualified boolean := false; v_path text; v_seq text;
BEGIN
  SELECT * INTO e FROM public.lifecycle_enrollments WHERE id = p_enrollment;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind', 'suppress', 'reason', 'enrollment_missing'); END IF;
  v_seq := e.sequence_key;
  SELECT id, raw_user_meta_data->>'signup_intent'
    INTO v_uid, v_signup_intent
    FROM auth.users
   WHERE lower(btrim(email)) = lower(btrim(e.email))
   LIMIT 1;
  IF coalesce(e.context->>'project_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_project := (e.context->>'project_id')::uuid;
    SELECT user_id, status::text INTO v_owner, v_status FROM public.projects WHERE id = v_project;
    IF NOT FOUND THEN RETURN jsonb_build_object('kind', 'suppress', 'reason', 'project_unavailable', 'operational', true); END IF;
    IF v_status IN ('paused', 'on_hold') THEN RETURN jsonb_build_object('kind', 'hold', 'reason', 'project_paused'); END IF;
    IF v_status NOT IN ('active', 'draft') THEN RETURN jsonb_build_object('kind', 'suppress', 'reason', 'project_inactive'); END IF;
    v_qualified := true;
  END IF;
  v_qualified := v_qualified OR coalesce(e.context->>'entry_source', '') IN ('referral', 'direct_outreach');
  IF v_uid IS NULL AND v_seq IN ('cs_signup','cs_onboarded','cl_signup','cs_project','cl_project','ci_onboarding','ci_connected_existing','ci_connected_new','cl_connected','cs_connected','iv_connected','cl_contractor_pending','cs_client_pending') THEN
    RETURN jsonb_build_object('kind', 'suppress', 'reason', 'account_unavailable');
  END IF;
  -- Honor signup_intent='contractor' in addition to user_roles so a brand-new contractor
  -- signing up is never falsely suppressed as account_role_changed while /auth/callback
  -- finishes granting the role row.
  IF v_seq IN ('cs_signup', 'cs_onboarded')
     AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role::text = 'contractor')
     AND coalesce(v_signup_intent, '') <> 'contractor' THEN
    RETURN jsonb_build_object('kind', 'suppress', 'reason', 'account_role_changed');
  END IF;
  IF v_seq = 'cl_signup' AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role::text IN ('contractor', 'admin', 'verifier')) THEN
    RETURN jsonb_build_object('kind', 'suppress', 'reason', 'account_role_changed');
  END IF;
  IF v_uid IS NOT NULL THEN
    SELECT client_intent INTO v_intent FROM public.contractor_onboarding WHERE user_id = v_uid;
  END IF;
  IF v_seq IN ('cs_signup', 'ci_onboarding') THEN
    IF v_uid IS NULL THEN v_kind := 'suppress'; v_reason := 'account_unavailable';
    ELSIF v_intent IS NOT NULL THEN v_kind := 'complete'; v_reason := 'onboarding_completed'; END IF;
  ELSIF v_seq = 'cs_onboarded' THEN
    IF EXISTS(SELECT 1 FROM public.projects WHERE user_id = v_uid) THEN v_kind := 'complete'; v_reason := 'project_created';
    ELSIF v_intent = 'no_client' THEN v_kind := 'suppress'; v_reason := 'no_active_project_selected'; END IF;
  ELSIF v_seq = 'cl_signup' THEN
    IF e.emails_sent > 0 AND (
      EXISTS(SELECT 1 FROM public.projects WHERE user_id = v_uid)
      OR EXISTS(SELECT 1 FROM public.project_viewers WHERE user_id = v_uid AND accepted_at IS NOT NULL AND revoked_at IS NULL)
      OR EXISTS(SELECT 1 FROM public.contractor_invites WHERE contractor_user_id = v_uid AND status = 'accepted')
    ) THEN
      v_kind := 'complete'; v_reason := 'project_available';
    END IF;
  ELSIF v_seq IN ('cs_project', 'cl_project') THEN
    IF v_project IS NULL THEN v_kind := 'suppress'; v_reason := 'project_missing';
    ELSIF v_seq = 'cs_project' THEN
      IF NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id = v_project AND contractor_user_id = v_uid AND status = 'accepted' AND is_primary) THEN
        v_kind := 'suppress'; v_reason := 'project_role_changed';
      ELSIF EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id = v_project AND is_client AND revoked_at IS NULL) THEN
        v_kind := 'complete'; v_reason := 'client_invited';
      END IF;
    ELSE
      IF NOT ((v_owner = v_uid AND NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id = v_project AND contractor_user_id = v_uid AND status = 'accepted') AND NOT EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id = v_project AND is_client AND revoked_at IS NULL))
        OR EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id = v_project AND user_id = v_uid AND is_client AND accepted_at IS NOT NULL AND revoked_at IS NULL)) THEN
        v_kind := 'suppress'; v_reason := 'project_role_changed';
      ELSIF EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id = v_project AND (status = 'accepted' OR status = 'pending')) THEN
        v_kind := 'complete'; v_reason := 'contractor_invited';
      ELSIF EXISTS(SELECT 1 FROM public.lifecycle_enrollments WHERE sequence_key = 'cl_support' AND email = e.email AND ref = e.ref AND status NOT IN ('exited', 'suppressed')) THEN
        v_kind := 'complete'; v_reason := 'contractor_support_requested';
      END IF;
    END IF;
  END IF;

  IF v_seq IN ('ci_invited','cl_contractor_pending','iv_invited','cs_client_pending','ci_onboarding','ci_connected_existing','ci_connected_new','iv_connected','cl_connected','cs_connected') THEN
    v_path := coalesce(e.context->>'invite_path', '');
    IF v_path ~* '^/(invite|share)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_token := split_part(v_path, '/', 3)::uuid; END IF;
    IF v_project IS NULL THEN v_kind := 'suppress'; v_reason := 'project_missing';
    ELSIF v_seq IN ('ci_invited','cl_contractor_pending','ci_onboarding','ci_connected_existing','ci_connected_new','cl_connected') THEN
      SELECT status = 'accepted' AS accepted, status = 'rejected' AS revoked,
             email_status::text AS delivery,
             contractor_user_id AS member, invited_by AS inviter, token
        INTO v_invite FROM public.contractor_invites
       WHERE project_id = v_project AND ((v_token IS NOT NULL AND token = v_token) OR (v_token IS NULL AND lower(email) = lower(coalesce(e.subject_email, e.email))))
       ORDER BY created_at DESC LIMIT 1;
      IF NOT FOUND THEN v_kind := 'suppress'; v_reason := 'invitation_unavailable';
      ELSIF v_invite.revoked THEN v_kind := 'suppress'; v_reason := 'invitation_unavailable';
      ELSIF NOT v_invite.accepted AND v_invite.delivery IN ('failed', 'bounced', 'complained') THEN v_kind := 'suppress'; v_reason := 'invitation_delivery_failed';
      ELSIF v_seq IN ('ci_invited', 'cl_contractor_pending') AND v_invite.accepted THEN v_kind := 'complete'; v_reason := 'invitation_accepted';
      ELSIF v_seq = 'cl_connected' AND (NOT v_invite.accepted OR v_invite.inviter IS DISTINCT FROM v_uid) THEN v_kind := 'suppress'; v_reason := 'membership_unavailable';
      ELSIF v_seq NOT IN ('ci_invited', 'cl_contractor_pending', 'cl_connected') AND (NOT v_invite.accepted OR v_invite.member IS DISTINCT FROM v_uid) THEN v_kind := 'suppress'; v_reason := 'membership_unavailable';
      END IF;
    ELSE
      SELECT accepted_at IS NOT NULL AS accepted, revoked_at IS NOT NULL AS revoked,
             email_status::text AS delivery,
             user_id AS member, invited_by AS inviter, token
        INTO v_invite FROM public.project_viewers
       WHERE project_id = v_project AND is_client AND ((v_token IS NOT NULL AND token = v_token) OR (v_token IS NULL AND lower(email) = lower(coalesce(e.subject_email, e.email))))
       ORDER BY invited_at DESC LIMIT 1;
      IF NOT FOUND THEN v_kind := 'suppress'; v_reason := 'invitation_unavailable';
      ELSIF v_invite.revoked THEN v_kind := 'suppress'; v_reason := 'invitation_unavailable';
      ELSIF NOT v_invite.accepted AND v_invite.delivery IN ('failed', 'bounced', 'complained') THEN v_kind := 'suppress'; v_reason := 'invitation_delivery_failed';
      ELSIF v_seq IN ('iv_invited', 'cs_client_pending') AND v_invite.accepted THEN v_kind := 'complete'; v_reason := 'invitation_accepted';
      ELSIF v_seq = 'cs_connected' AND (NOT v_invite.accepted OR v_invite.inviter IS DISTINCT FROM v_uid) THEN v_kind := 'suppress'; v_reason := 'membership_unavailable';
      ELSIF v_seq NOT IN ('iv_invited', 'cs_client_pending', 'cs_connected') AND (NOT v_invite.accepted OR v_invite.member IS DISTINCT FROM v_uid) THEN v_kind := 'suppress'; v_reason := 'membership_unavailable';
      END IF;
    END IF;
  END IF;
  IF v_kind = 'ready' AND v_seq IN ('cl_contractor_pending', 'cl_connected') AND NOT (
    (v_owner = v_uid AND NOT EXISTS(SELECT 1 FROM public.contractor_invites WHERE project_id = v_project AND contractor_user_id = v_uid AND status = 'accepted')
      AND NOT EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id = v_project AND is_client AND revoked_at IS NULL))
    OR EXISTS(SELECT 1 FROM public.project_viewers WHERE project_id = v_project AND user_id = v_uid AND is_client AND accepted_at IS NOT NULL AND revoked_at IS NULL)
  ) THEN v_kind := 'suppress'; v_reason := 'project_role_changed'; END IF;
  IF v_kind = 'ready' AND v_seq IN ('cs_client_pending', 'cs_connected') AND NOT EXISTS(
    SELECT 1 FROM public.contractor_invites WHERE project_id = v_project AND contractor_user_id = v_uid AND is_primary AND status = 'accepted'
  ) THEN v_kind := 'suppress'; v_reason := 'project_role_changed'; END IF;
  RETURN jsonb_build_object('kind', v_kind, 'reason', v_reason, 'qualified', v_qualified,
    'operational', v_kind = 'suppress' AND v_reason IN ('invitation_unavailable', 'invitation_delivery_failed', 'membership_unavailable'));
END $$;

CREATE OR REPLACE FUNCTION public.reconcile_lifecycle_enrollment(p_enrollment uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_state jsonb; e public.lifecycle_enrollments%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.lifecycle_enrollments WHERE id = p_enrollment FOR UPDATE;
  v_state := public.lifecycle_enrollment_state(p_enrollment);
  IF v_state->>'kind' IN ('complete', 'suppress') THEN
    UPDATE public.lifecycle_enrollments
       SET status = CASE WHEN v_state->>'kind' = 'complete' THEN 'exited' ELSE 'suppressed' END,
           exit_reason = v_state->>'reason',
           next_send_at = NULL,
           processing_token = NULL,
           processing_until = NULL
     WHERE id = e.id;
    UPDATE public.followup_queue
       SET status = 'done', resolved_at = now(), note = 'Auto-closed: ' || (v_state->>'reason')
     WHERE enrollment_id = e.id AND status = 'open' AND kind = 'activation';
    IF coalesce((v_state->>'operational')::boolean, false) THEN
      INSERT INTO public.followup_queue(enrollment_id, sequence_key, email, full_name, phone, reason, priority, context, due_at)
        VALUES(e.id, e.sequence_key, e.email, e.full_name, e.phone, 'Delivery review: ' || (v_state->>'reason'), 'high', e.context, now())
        ON CONFLICT(enrollment_id) DO UPDATE SET status = 'open', resolved_at = NULL, reason = EXCLUDED.reason, due_at = EXCLUDED.due_at;
    END IF;
  ELSIF v_state->>'kind' = 'hold' THEN
    -- Operational holds (global pause or test-group filter) re-check on the next 5-minute cycle
    -- instead of incurring a 24-hour penalty when an admin enables delivery.
    UPDATE public.lifecycle_enrollments
       SET next_send_at = CASE
             WHEN v_state->>'reason' IN ('communications_paused', 'outside_test_group')
               THEN now() + interval '5 minutes'
             ELSE now() + interval '1 day'
           END,
           processing_token = NULL,
           processing_until = NULL
     WHERE id = e.id;
  END IF;
  RETURN v_state;
END $$;

CREATE OR REPLACE FUNCTION public.queue_communication_reply(p_thread uuid, p_body text, p_client_ref uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.communication_threads%ROWTYPE;
  e public.lifecycle_enrollments%ROWTYPE;
  s public.communication_settings%ROWTYPE;
  p public.communication_preferences%ROWTYPE;
  m public.communication_messages%ROWTYPE;
  v_parent public.communication_messages%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF p_client_ref IS NULL OR length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'invalid_message'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('communication_reply:' || p_client_ref::text, 0));
  SELECT * INTO m FROM public.communication_messages WHERE client_ref = p_client_ref;
  IF FOUND THEN
    IF m.thread_id <> p_thread OR m.body <> btrim(p_body) OR m.actor_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'message_reference_conflict'; END IF;
    RETURN m.id;
  END IF;
  SELECT e0.* INTO e FROM public.lifecycle_enrollments e0 JOIN public.communication_threads t0 ON t0.enrollment_id = e0.id WHERE t0.id = p_thread FOR UPDATE OF e0;
  SELECT * INTO t FROM public.communication_threads WHERE id = p_thread FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'thread_unavailable'; END IF;
  SELECT * INTO s FROM public.communication_settings WHERE id;
  IF NOT s.delivery_enabled OR s.sender_email IS NULL THEN RAISE EXCEPTION 'communications_paused'; END IF;
  IF cardinality(s.test_recipients) > 0 AND NOT t.email = ANY(s.test_recipients) THEN RAISE EXCEPTION 'outside_test_group'; END IF;
  SELECT * INTO p FROM public.communication_preferences WHERE email = t.email;
  SELECT * INTO v_parent FROM public.communication_messages WHERE thread_id = t.id AND direction = 'inbound' AND authenticated ORDER BY created_at DESC LIMIT 1;
  IF p.blocked_reason IS NOT NULL OR (p.activation_unsubscribed AND v_parent.id IS NULL) THEN RAISE EXCEPTION 'recipient_unavailable'; END IF;
  INSERT INTO public.communication_messages(thread_id, direction, subject, body, actor_id, client_ref, status, in_reply_to, payload)
  VALUES(
    t.id,
    'outbound',
    left(regexp_replace(
      CASE
        WHEN v_parent.subject IS NULL OR v_parent.subject = '' THEN 'Groundwork: ' || coalesce(e.context->>'project_name', 'your account')
        WHEN v_parent.subject ~* '^re:' THEN v_parent.subject
        ELSE 'Re: ' || v_parent.subject
      END, E'[\r\n]', ' ', 'g'), 300),
    btrim(p_body),
    auth.uid(),
    p_client_ref,
    'queued',
    v_parent.provider_message_id,
    jsonb_build_object(
      'to', t.email,
      'sender_name', s.sender_name,
      'sender_email', s.followup_sender_email,
      'reply_domain', s.reply_domain,
      'lang', e.lang,
      'preference_token', p.token
    )
  ) RETURNING id INTO v_id;
  UPDATE public.communication_threads
     SET automation_paused = true,
         reply_domains = CASE
           WHEN s.reply_domain IS NOT NULL AND NOT (s.reply_domain = ANY(reply_domains))
             THEN array_append(reply_domains, s.reply_domain)
           ELSE reply_domains
         END
   WHERE id = t.id;
  RETURN v_id;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
