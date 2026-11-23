-- Wave 2 fixes (Nov 20 working session):
--   1. Fix `set_staff_role` audit insert to satisfy `project_audit_log_entity_pair`
--      (`entity_id = p_user` paired with `entity_type = 'staff_role'`).
--   2. Fix `list_unified_audit_log` column references for `admin_deleted_projects`
--      (`project_id`, `name`, `counts`, `owner_email`, `tier`, `status`) and
--      `security_notify_log` (`event`, `step`, `detail`).
--   3. Trigger admin/ops notification bell alerts when Live Chat messages or inbound
--      project/WhatsApp messages arrive.
--   4. Re-assert `on_auth_user_password_changed` trigger so `must_change_password`
--      always clears when a user updates their password.
--   5. Realign existing untouched Stage 4 (`backfill` after `foundationPillarsBeams`)
--      and Stage 5 → Stage 8 (`internalExternalPlastering`, `mortarFlooringTiles`,
--      `wallTilesDecorativePlaster`) substages on projects created before the updated
--      `stage-seeds.ts` sequence.
BEGIN;

-- =========================================================
-- 1. Fix `set_staff_role` (satisfy project_audit_log_entity_pair)
-- =========================================================
CREATE OR REPLACE FUNCTION public.set_staff_role(
  p_user uuid,
  p_role text,
  p_grant boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_admin_count int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_admin: only a super admin may change staff roles';
  END IF;
  IF p_role NOT IN ('admin', 'ops', 'finance', 'growth', 'verifier') THEN
    RAISE EXCEPTION 'invalid_role: unsupported staff role';
  END IF;

  IF p_grant THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user, p_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    IF p_role = 'admin' THEN
      SELECT count(*) INTO v_admin_count FROM public.user_roles WHERE role = 'admin';
      IF v_admin_count <= 1 THEN
        RAISE EXCEPTION 'last_admin: keep at least one admin account';
      END IF;
    END IF;
    DELETE FROM public.user_roles WHERE user_id = p_user AND role = p_role;
  END IF;

  INSERT INTO public.project_audit_log (actor_id, person_id, action, entity_type, entity_id, details)
  VALUES (
    auth.uid(),
    p_user,
    CASE WHEN p_grant THEN 'staff_role_granted' ELSE 'staff_role_revoked' END,
    'staff_role',
    p_user,
    jsonb_build_object('role', p_role, 'granted', p_grant)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_staff_role(uuid, text, boolean) TO authenticated;

-- =========================================================
-- 2. Fix `list_unified_audit_log` (match real 069 & 070 columns)
-- =========================================================
CREATE OR REPLACE FUNCTION public.list_unified_audit_log(
  p_limit int DEFAULT 60,
  p_before timestamptz DEFAULT NULL,
  p_category text DEFAULT NULL
)
RETURNS TABLE (
  id text,
  source text,
  category text,
  action text,
  actor_id uuid,
  person_id uuid,
  project_id uuid,
  project_name text,
  details jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_limit int := greatest(1, least(coalesce(p_limit, 60), 200));
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'not_staff: staff access required';
  END IF;

  RETURN QUERY
  WITH merged AS (
    SELECT
      'pal:' || l.id::text AS id,
      'project_audit_log'::text AS source,
      CASE
        WHEN l.action ~* '(payment|payout|receipt|release|fund|disburs|budget|milestone|price|reconcil)' THEN 'finance'
        WHEN l.action ~* '(role|mfa|2fa|password|device|security|login|auth|token|session)' THEN 'security'
        WHEN l.action ~* '(delete|remove|purge|archive)' THEN 'deletion'
        ELSE 'project'
      END AS category,
      l.action::text AS action,
      l.actor_id,
      l.person_id,
      l.project_id,
      coalesce(p.name, '')::text AS project_name,
      coalesce(l.details, '{}'::jsonb) AS details,
      l.created_at
    FROM public.project_audit_log l
    LEFT JOIN public.projects p ON p.id = l.project_id

    UNION ALL

    SELECT
      'del:' || d.project_id::text AS id,
      'admin_deleted_projects'::text AS source,
      'deletion'::text AS category,
      'project_deleted'::text AS action,
      d.deleted_by AS actor_id,
      d.owner_id AS person_id,
      NULL::uuid AS project_id,
      coalesce(d.name, '')::text AS project_name,
      jsonb_strip_nulls(jsonb_build_object(
        'project_id', d.project_id,
        'project_name', d.name,
        'owner_email', d.owner_email,
        'tier', d.tier,
        'status', d.status,
        'counts', d.counts
      )) AS details,
      d.deleted_at AS created_at
    FROM public.admin_deleted_projects d

    UNION ALL

    SELECT
      'sec:' || s.id::text AS id,
      'security_notify_log'::text AS source,
      'security'::text AS category,
      coalesce(NULLIF(s.event, ''), 'security_event')::text AS action,
      s.user_id AS actor_id,
      s.user_id AS person_id,
      NULL::uuid AS project_id,
      ''::text AS project_name,
      jsonb_strip_nulls(jsonb_build_object(
        'event', s.event,
        'step', s.step,
        'detail', s.detail
      )) AS details,
      s.created_at
    FROM public.security_notify_log s
  )
  SELECT m.id, m.source, m.category, m.action, m.actor_id, m.person_id, m.project_id, m.project_name, m.details, m.created_at
  FROM merged m
  WHERE (p_before IS NULL OR m.created_at < p_before)
    AND (p_category IS NULL OR p_category = '' OR p_category = 'all' OR m.category = p_category)
  ORDER BY m.created_at DESC
  LIMIT v_limit + 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_unified_audit_log(int, timestamptz, text) TO authenticated;

-- =========================================================
-- 3. Admin Notification Bell alerts for Live Chat & inbound messages
-- =========================================================
CREATE OR REPLACE FUNCTION public.live_chat_on_message_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_session public.live_chat_sessions%ROWTYPE;
  v_staff   RECORD;
  v_sender  text;
BEGIN
  IF NEW.sender_type = 'internal' THEN
    RETURN NEW;
  END IF;

  UPDATE public.live_chat_sessions
  SET
    last_message_at = NEW.created_at,
    last_message_preview = left(btrim(NEW.body), 240),
    status = CASE
      WHEN NEW.sender_type = 'user' THEN 'waiting_on_us'
      ELSE 'waiting_on_user'
    END,
    resolved_at = CASE WHEN NEW.sender_type = 'user' THEN NULL ELSE resolved_at END,
    unread_for_staff = CASE WHEN NEW.sender_type = 'user' THEN unread_for_staff + 1 ELSE 0 END,
    unread_for_user = CASE WHEN NEW.sender_type = 'staff' THEN unread_for_user + 1 ELSE 0 END
  WHERE id = NEW.session_id
  RETURNING * INTO v_session;

  IF NEW.sender_type = 'user' THEN
    v_sender := coalesce(NULLIF(btrim(NEW.sender_name), ''), NULLIF(btrim(v_session.visitor_name), ''), NULLIF(btrim(v_session.visitor_email), ''), 'Visitor');
    FOR v_staff IN
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      WHERE ur.role IN ('admin', 'ops')
        AND (NEW.sender_id IS NULL OR ur.user_id <> NEW.sender_id)
    LOOP
      BEGIN
        INSERT INTO public.notifications (user_id, type, title, body, data)
        VALUES (
          v_staff.user_id,
          'live_chat_message',
          'Live chat · ' || left(v_sender, 60),
          left(btrim(NEW.body), 160),
          jsonb_build_object(
            'live_chat_session_id', NEW.session_id,
            'channel', 'live_chat'
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'live_chat % : bell failed for %: %', NEW.id, v_staff.user_id, SQLERRM;
      END;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_staff_on_inbound_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_conv    public.conversations%ROWTYPE;
  v_project text;
  v_sender  text;
  v_staff   RECORD;
BEGIN
  IF NEW.direction <> 'inbound' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_conv FROM public.conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_conv.project_id IS NOT NULL THEN
    SELECT NULLIF(btrim(name), '') INTO v_project FROM public.projects WHERE id = v_conv.project_id;
  END IF;

  v_sender := coalesce(
    NULLIF(btrim(NEW.sender_name), ''),
    (SELECT NULLIF(btrim(full_name), '') FROM public.profiles WHERE id = NEW.sender_id),
    'Client'
  );

  FOR v_staff IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role IN ('admin', 'ops')
      AND (NEW.sender_id IS NULL OR ur.user_id <> NEW.sender_id)
  LOOP
    -- Skip if already notified as a direct project participant on this exact message.
    IF v_conv.project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.project_participants(v_conv.project_id) pp WHERE pp.user_id = v_staff.user_id
    ) THEN
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (
        v_staff.user_id,
        'message_received',
        CASE
          WHEN v_project IS NOT NULL THEN 'New message · ' || left(v_project, 60)
          ELSE 'New message from ' || left(v_sender, 60)
        END,
        left(coalesce(NEW.content, ''), 160),
        jsonb_strip_nulls(jsonb_build_object(
          'project_id', v_conv.project_id,
          'conversation_id', NEW.conversation_id,
          'message_id', NEW.id,
          'channel', NEW.channel
        ))
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'staff bell for message % failed for %: %', NEW.id, v_staff.user_id, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_staff_on_inbound_message ON public.project_messages;
CREATE TRIGGER trg_notify_staff_on_inbound_message
  AFTER INSERT ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_staff_on_inbound_message();

-- =========================================================
-- 4. Re-assert `on_auth_user_password_changed` trigger (083)
-- =========================================================
DROP TRIGGER IF EXISTS on_auth_user_password_changed ON auth.users;
CREATE TRIGGER on_auth_user_password_changed
  AFTER UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW
  WHEN (OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password)
  EXECUTE FUNCTION public.sync_password_changed();

-- =========================================================
-- 5. Align existing untouched projects with Vanessa's stage sequence:
--    (a) Stage 4 (Foundation): Backfill after Foundation pillars and beams
--    (b) Stage 5 (Structure & Walls) -> Stage 8 (Finishing):
--        Move pending untouched plastering & tiles substages
-- =========================================================
DO $$
DECLARE
  v_stage4   RECORD;
  v_proj     RECORD;
  v_s5       uuid;
  v_s8       uuid;
  v_sub      RECORD;
  v_idx      int;
  v_s4_count int := 0;
  v_s5_count int := 0;
BEGIN
  -- (a) Stage 4 Foundation: place backfill immediately after foundationPillarsBeams
  --     whenever neither substage is complete and neither has evidence.
  --     Matches by both canonical substage_key and case-insensitive name, and covers
  --     locked, pending, and in_progress untouched rows.
  FOR v_stage4 IN
    SELECT DISTINCT s.id AS stage_id
    FROM public.project_stages s
    JOIN public.project_substages b
      ON b.stage_id = s.id
     AND (b.substage_key = 'backfill' OR lower(btrim(b.name)) = 'backfill')
    JOIN public.project_substages p
      ON p.stage_id = s.id
     AND (
       p.substage_key = 'foundationPillarsBeams'
       OR lower(btrim(p.name)) IN ('foundation pillars and beams', 'foundation columns and beams')
     )
    WHERE s.stage_number = 4
      AND b.substage_number < p.substage_number
      AND b.status <> 'complete'
      AND p.status <> 'complete'
      AND (CASE WHEN jsonb_typeof(b.evidence_urls) = 'array' THEN jsonb_array_length(b.evidence_urls) ELSE 0 END) = 0
      AND (CASE WHEN jsonb_typeof(p.evidence_urls) = 'array' THEN jsonb_array_length(p.evidence_urls) ELSE 0 END) = 0
  LOOP
    -- Backfill missing canonical keys on this stage's substages where unambiguous
    UPDATE public.project_substages
    SET substage_key = CASE lower(btrim(name))
      WHEN 'excavation (pits and trenches)'               THEN 'excavationPitsTrenches'
      WHEN 'lean concrete'                                THEN 'leanConcrete'
      WHEN 'reinforced concrete footings'                 THEN 'reinforcedConcreteFootings'
      WHEN 'foundation pillars and beams'                 THEN 'foundationPillarsBeams'
      WHEN 'foundation columns and beams'                 THEN 'foundationPillarsBeams'
      WHEN 'backfill'                                     THEN 'backfill'
      WHEN 'floor slab'                                   THEN 'foundationFloorSlab'
      WHEN 'foundation blocks + polystyrene + sand layer' THEN 'foundationBlocksPolystyreneSand'
      ELSE substage_key
    END
    WHERE stage_id = v_stage4.stage_id AND substage_key IS NULL;

    -- Renumber all substages in this Stage 4 in canonical order
    v_idx := 0;
    FOR v_sub IN
      SELECT id
      FROM public.project_substages
      WHERE stage_id = v_stage4.stage_id
      ORDER BY
        CASE
          WHEN substage_key = 'excavationPitsTrenches'          OR lower(btrim(name)) = 'excavation (pits and trenches)'               THEN 1
          WHEN substage_key = 'leanConcrete'                    OR lower(btrim(name)) = 'lean concrete'                                THEN 2
          WHEN substage_key = 'reinforcedConcreteFootings'      OR lower(btrim(name)) = 'reinforced concrete footings'                 THEN 3
          WHEN substage_key = 'foundationPillarsBeams'          OR lower(btrim(name)) IN ('foundation pillars and beams', 'foundation columns and beams') THEN 4
          WHEN substage_key = 'backfill'                        OR lower(btrim(name)) = 'backfill'                                     THEN 5
          WHEN substage_key = 'foundationFloorSlab'             OR lower(btrim(name)) = 'floor slab'                                   THEN 6
          WHEN substage_key = 'foundationBlocksPolystyreneSand' OR lower(btrim(name)) = 'foundation blocks + polystyrene + sand layer' THEN 7
          ELSE 100 + substage_number
        END,
        substage_number
    LOOP
      v_idx := v_idx + 1;
      UPDATE public.project_substages
      SET substage_number = 1000 + v_idx
      WHERE id = v_sub.id;
    END LOOP;

    UPDATE public.project_substages
    SET substage_number = substage_number - 1000
    WHERE stage_id = v_stage4.stage_id AND substage_number > 1000;

    v_s4_count := v_s4_count + 1;
  END LOOP;

  -- (b) Stage 5 -> Stage 8: move untouched plastering & tiles substages
  --     Matches by both substage_key and name, and covers locked/pending/in_progress rows.
  FOR v_proj IN
    SELECT DISTINCT sub.project_id
    FROM public.project_substages sub
    JOIN public.project_stages s ON s.id = sub.stage_id
    WHERE s.stage_number = 5
      AND (
        sub.substage_key IN ('internalExternalPlastering', 'mortarFlooringTiles', 'wallTilesDecorativePlaster')
        OR lower(btrim(sub.name)) IN (
          'internal and external plastering',
          'mortar flooring and tiles',
          'wall tiles and decorative plaster',
          'internal wall plastering',
          'external wall plastering',
          'floor tiling',
          'wall tiling (kitchen/bath)',
          'wall tiling'
        )
      )
      AND sub.status <> 'complete'
      AND (CASE WHEN jsonb_typeof(sub.evidence_urls) = 'array' THEN jsonb_array_length(sub.evidence_urls) ELSE 0 END) = 0
      AND NOT EXISTS (SELECT 1 FROM public.stage_payment_receipts r WHERE r.substage_id = sub.id)
      AND NOT EXISTS (SELECT 1 FROM public.substage_payment_requests req WHERE req.substage_id = sub.id)
  LOOP
    SELECT id INTO v_s5 FROM public.project_stages WHERE project_id = v_proj.project_id AND stage_number = 5 LIMIT 1;
    SELECT id INTO v_s8 FROM public.project_stages WHERE project_id = v_proj.project_id AND stage_number = 8 LIMIT 1;
    CONTINUE WHEN v_s5 IS NULL OR v_s8 IS NULL;

    -- Shift existing Stage 8 substages up so moved items sit cleanly at positions 1..3
    UPDATE public.project_substages
    SET substage_number = substage_number + 100
    WHERE stage_id = v_s8;

    -- Move any untouched plastering/tiles substage not already in Stage 8
    UPDATE public.project_substages sub
    SET stage_id = v_s8,
        substage_key = coalesce(
          sub.substage_key,
          CASE lower(btrim(sub.name))
            WHEN 'internal and external plastering'  THEN 'internalExternalPlastering'
            WHEN 'mortar flooring and tiles'         THEN 'mortarFlooringTiles'
            WHEN 'wall tiles and decorative plaster' THEN 'wallTilesDecorativePlaster'
            ELSE NULL
          END
        ),
        substage_number = CASE
          WHEN sub.substage_key = 'internalExternalPlastering' OR lower(btrim(sub.name)) IN ('internal and external plastering', 'internal wall plastering', 'external wall plastering') THEN 1
          WHEN sub.substage_key = 'mortarFlooringTiles'        OR lower(btrim(sub.name)) IN ('mortar flooring and tiles', 'floor tiling') THEN 2
          ELSE 3
        END
    WHERE sub.stage_id = v_s5
      AND (
        sub.substage_key IN ('internalExternalPlastering', 'mortarFlooringTiles', 'wallTilesDecorativePlaster')
        OR lower(btrim(sub.name)) IN (
          'internal and external plastering',
          'mortar flooring and tiles',
          'wall tiles and decorative plaster',
          'internal wall plastering',
          'external wall plastering',
          'floor tiling',
          'wall tiling (kitchen/bath)',
          'wall tiling'
        )
      )
      AND sub.status <> 'complete'
      AND (CASE WHEN jsonb_typeof(sub.evidence_urls) = 'array' THEN jsonb_array_length(sub.evidence_urls) ELSE 0 END) = 0
      AND NOT EXISTS (SELECT 1 FROM public.stage_payment_receipts r WHERE r.substage_id = sub.id)
      AND NOT EXISTS (SELECT 1 FROM public.substage_payment_requests req WHERE req.substage_id = sub.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.project_substages existing
        WHERE existing.stage_id = v_s8
          AND (
            (sub.substage_key IS NOT NULL AND existing.substage_key = sub.substage_key)
            OR lower(btrim(existing.name)) = lower(btrim(sub.name))
          )
      );

    -- Renumber Stage 5 cleanly 1..N
    v_idx := 0;
    FOR v_sub IN
      SELECT id FROM public.project_substages WHERE stage_id = v_s5 ORDER BY substage_number
    LOOP
      v_idx := v_idx + 1;
      UPDATE public.project_substages SET substage_number = 1000 + v_idx WHERE id = v_sub.id;
    END LOOP;
    UPDATE public.project_substages
    SET substage_number = substage_number - 1000
    WHERE stage_id = v_s5 AND substage_number > 1000;

    -- Renumber Stage 8 cleanly 1..N
    v_idx := 0;
    FOR v_sub IN
      SELECT id FROM public.project_substages WHERE stage_id = v_s8 ORDER BY substage_number
    LOOP
      v_idx := v_idx + 1;
      UPDATE public.project_substages SET substage_number = 1000 + v_idx WHERE id = v_sub.id;
    END LOOP;
    UPDATE public.project_substages
    SET substage_number = substage_number - 1000
    WHERE stage_id = v_s8 AND substage_number > 1000;

    v_s5_count := v_s5_count + 1;
  END LOOP;

  RAISE NOTICE 'Wave 2 stage repair complete: % Stage 4 projects reordered, % Stage 5->8 projects updated', v_s4_count, v_s5_count;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
