-- =========================================================
-- 116  Contractor onboarding — one sequence, every contractor
--
-- WHY
--
-- Until now a contractor could hold the role and reach /work having given us a name, an
-- email and nothing else. The partner agreement Jalla asks them to sign assumes much
-- more than that: §3.1 requires identity, banking, licensing and diligence information
-- BEFORE activation, §3.2 lets Jalla withhold activation until the forms are complete,
-- and §17 requires evidence of professional standing. None of it was collected.
--
-- This is the post-approval dossier. It is deliberately NOT the application (026): an
-- application is what a stranger submits to be considered, and you do not ask a stranger
-- for their date of birth, their home address, their bank account or their next of kin.
-- You ask once they are in. 026 screens; this onboards.
--
-- ── One sequence for everybody ───────────────────────────────────────────────────────
-- There are two ways to become a contractor (an approved application, or the open door
-- at /contractor-signup) and there will later be tiers — Founding, Certified, Strategic,
-- per Schedule B. All of them complete the SAME steps. Tier changes what a contractor is
-- paid, never what Jalla holds on file about them.
--
-- ── What is NOT duplicated here ──────────────────────────────────────────────────────
-- Section 3 of the paper form is bank and mobile-money details. Those already exist, in
-- `payout_destinations` (099), which models them far better than a flat set of columns:
-- it separates mobile money from bank as distinct shapes, holds E.164, carries verified
-- and retired states, and is already what the payout code reads. Adding bank columns here
-- would create a second set of account numbers and a question about which one money
-- follows. So the payout STEP points at that table and is satisfied by a row in it.
--
-- Likewise `profiles.phone` stays the canonical phone number, and `profiles.full_name`
-- the canonical name. Nothing here shadows them.
--
-- ── The one definition ───────────────────────────────────────────────────────────────
-- `contractor_onboarding_status()` is the only thing that decides whether somebody is
-- finished. The dashboard banner, the checklist, the gate on taking work, and the admin
-- view all read it. The lesson is `holdsContractorAccess`: when two places each decide
-- what "a contractor" means, one of them is wrong and the person is stuck.
--
-- Run in: Supabase Dashboard > SQL Editor (after 115)
-- =========================================================

BEGIN;

-- ── Who is a contractor, in SQL ──────────────────────────
--
-- The browser has had one answer for this since 100 (`holdsContractorAccess`: the role OR
-- an accepted assignment). The database has never had it written down, so every policy
-- that needed it open-coded a slightly different query. This is that one answer, and the
-- RPCs below are the first callers.
--
-- Both arms matter. A partner who signed up at /contractor-signup holds `user_roles`; a
-- contractor invited onto a single project may hold no role row at all. Asking only
-- `user_roles` would lock the second kind out of their own onboarding.
CREATE OR REPLACE FUNCTION public.holds_contractor_access(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.user_roles
             WHERE user_id = p_user AND role = 'contractor')
    OR
    EXISTS (SELECT 1 FROM public.contractor_invites
             WHERE contractor_user_id = p_user AND status = 'accepted')
  );
$$;

REVOKE ALL ON FUNCTION public.holds_contractor_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.holds_contractor_access(uuid) TO authenticated;

COMMENT ON FUNCTION public.holds_contractor_access(uuid) IS
  'The role OR an accepted assignment (116). The SQL twin of holdsContractorAccess in '
  'src/lib/auth/roles.ts — if one changes the other must, or an invited contractor is '
  'locked out of a surface a partner can reach.';


-- ── Which version of each document is current ────────────
--
-- Acceptance is recorded against a version, so bumping a document re-asks everybody
-- rather than silently treating an old signature as covering new terms. Changing a
-- version is therefore a migration, on purpose: it is a legal act, not configuration.
--
-- `partner_agreement` is the PROFESSIONAL PARTNER REFERRAL AND NETWORK SERVICES
-- AGREEMENT. Date-stamped rather than numbered, because that is how the document itself
-- is identified when Ruth sends a revision.
CREATE OR REPLACE FUNCTION public.current_agreement_version(p_document text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_document
           WHEN 'terms_of_service'  THEN '2026-10-15'
           WHEN 'partner_agreement' THEN '2026-10-15'
         END;
$$;

REVOKE ALL ON FUNCTION public.current_agreement_version(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_agreement_version(text) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────
-- The dossier
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contractor_onboarding (
  -- Their own record, so it goes when they go. The same convention as 109's
  -- contractor_clients: a person's own data cascades; a record of something that
  -- HAPPENED (an audit row, a payment, a signature) does not.
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- ── Section 1: personal ──
  date_of_birth       date,
  residential_address text,

  -- ── Section 2: professional and business ──
  license_number      text,
  business_status     text CHECK (business_status IN ('registered', 'independent')),
  business_name       text,
  business_reg_number text,

  -- Section 3 is payout_destinations (099). Section 4 is the table below.

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- A date of birth that is not a plausible adult's is a typo, and a typo in a field used
  -- for identity checks is worse than a blank. Rejected at the boundary rather than
  -- stored and discovered later.
  CONSTRAINT contractor_onboarding_dob_plausible CHECK (
    date_of_birth IS NULL
    OR (date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')
    AND date_of_birth >= (CURRENT_DATE - INTERVAL '100 years'))
  ),

  -- "Registered business" is a claim that carries its name and number, or it is not that
  -- claim. The paper form marks both "if applicable"; applicable means exactly this.
  CONSTRAINT contractor_onboarding_registered_has_details CHECK (
    business_status IS DISTINCT FROM 'registered'
    OR (business_name       IS NOT NULL AND btrim(business_name)       <> ''
    AND business_reg_number IS NOT NULL AND btrim(business_reg_number) <> '')
  )
);

COMMENT ON TABLE public.contractor_onboarding IS
  'Post-approval dossier for a contractor (116). Not the application (026): this is what '
  'is collected once somebody is in, per §3.1 of the partner agreement. Bank details are '
  'NOT here — they are payout_destinations (099).';


-- ── Section 4: emergency contacts ────────────────────────
--
-- Three of them, each a row rather than a JSONB array, because each carries a phone
-- number that has to clear the same E.164 bar as every other number the product dials,
-- and a CHECK constraint does that per contact. An array would push the validation into
-- application code, where it would eventually be skipped.
CREATE TABLE IF NOT EXISTS public.contractor_emergency_contacts (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 1, 2, 3 — the form asks for three in order and the UI edits them in place.
  position  smallint NOT NULL CHECK (position BETWEEN 1 AND 3),

  full_name    text NOT NULL CHECK (btrim(full_name)    <> ''),
  relationship text NOT NULL CHECK (btrim(relationship) <> ''),
  phone        text NOT NULL CHECK (phone ~ '^\+[0-9]{7,15}$'),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, position)
);

CREATE INDEX IF NOT EXISTS contractor_emergency_contacts_user_idx
  ON public.contractor_emergency_contacts (user_id);


-- ── Required documents ───────────────────────────────────
--
-- Paths in the private `contractor-docs` bucket (026), never public URLs; the admin panel
-- signs a link on demand. Only the current copy of each kind is kept: re-uploading a
-- renewed licence replaces the expired one rather than leaving two and a question about
-- which is in force.
CREATE TABLE IF NOT EXISTS public.contractor_documents (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  kind     text NOT NULL CHECK (kind IN ('professional_license', 'business_registration')),

  path       text NOT NULL CHECK (btrim(path) <> ''),
  filename   text NOT NULL,
  size_bytes integer CHECK (size_bytes IS NULL OR size_bytes > 0),
  mime_type  text,

  uploaded_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, kind)
);

CREATE INDEX IF NOT EXISTS contractor_documents_user_idx
  ON public.contractor_documents (user_id);


-- ── Signed agreements ────────────────────────────────────
--
-- NO foreign key on user_id, and that is deliberate. This is the record of a signature,
-- and §8.7 of the agreement requires payment and attribution records be kept seven years
-- while §20.5 requires records be preserved on termination. A signature that vanished
-- when the account was deleted would defeat both. The same reasoning as 089's rule for
-- people and as project_audit_log.person_id.
--
-- It also means 115's purge can delete a contractor without this table blocking it, and
-- without erasing what they agreed to.
--
-- Append-only: no UPDATE or DELETE is granted to anybody, and acceptance is unique per
-- (person, document, version). Re-accepting the same version is a no-op, not a second row.
CREATE TABLE IF NOT EXISTS public.agreement_acceptances (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  uuid NOT NULL,

  document text NOT NULL CHECK (document IN ('terms_of_service', 'partner_agreement')),
  version  text NOT NULL CHECK (btrim(version) <> ''),

  -- §24.9 permits electronic signature. What makes it one is that the person typed their
  -- own name, so it is stored as typed rather than copied from the profile.
  signed_name text NOT NULL CHECK (btrim(signed_name) <> ''),

  accepted_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, document, version)
);

CREATE INDEX IF NOT EXISTS agreement_acceptances_user_idx
  ON public.agreement_acceptances (user_id);

COMMENT ON TABLE public.agreement_acceptances IS
  'Append-only record of accepted agreements, by version (116). No FK on user_id: a '
  'signature must outlive the account, per §8.7 and §20.5. Nothing grants UPDATE or '
  'DELETE.';


-- ─────────────────────────────────────────────────────────
-- Reading
-- ─────────────────────────────────────────────────────────

ALTER TABLE public.contractor_onboarding            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_emergency_contacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_documents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreement_acceptances            ENABLE ROW LEVEL SECURITY;

-- Every policy here is FOR SELECT. Writes go through the SECURITY DEFINER functions
-- below and nowhere else, so no browser can set `business_status` on somebody else or
-- backdate a signature.
DROP POLICY IF EXISTS contractor_onboarding_read ON public.contractor_onboarding;
CREATE POLICY contractor_onboarding_read ON public.contractor_onboarding
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS contractor_emergency_contacts_read ON public.contractor_emergency_contacts;
CREATE POLICY contractor_emergency_contacts_read ON public.contractor_emergency_contacts
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS contractor_documents_read ON public.contractor_documents;
CREATE POLICY contractor_documents_read ON public.contractor_documents
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS agreement_acceptances_read ON public.agreement_acceptances;
CREATE POLICY agreement_acceptances_read ON public.agreement_acceptances
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

GRANT SELECT ON public.contractor_onboarding         TO authenticated;
GRANT SELECT ON public.contractor_emergency_contacts TO authenticated;
GRANT SELECT ON public.contractor_documents          TO authenticated;
GRANT SELECT ON public.agreement_acceptances         TO authenticated;


-- ─────────────────────────────────────────────────────────
-- The one definition of "finished"
-- ─────────────────────────────────────────────────────────
--
-- Returns a step-by-step answer rather than a bare boolean, because the dashboard has to
-- tell somebody WHICH step is outstanding. `complete` is derived from the steps in the
-- same breath, so the summary can never disagree with the detail.
CREATE OR REPLACE FUNCTION public.contractor_onboarding_status(p_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := coalesce(p_user, auth.uid());
  r      public.contractor_onboarding%ROWTYPE;
  v_identity     boolean;
  v_professional boolean;
  v_payout       boolean;
  v_emergency    boolean;
  v_documents    boolean;
  v_agreements   boolean;
  v_registered   boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_signed_in: no account to report on';
  END IF;
  -- Your own, or anybody's if you are staff. Without this a contractor could read
  -- another's progress, which is a slow leak of who has and has not given us a licence.
  IF v_user <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_allowed: that is not your onboarding';
  END IF;

  SELECT * INTO r FROM public.contractor_onboarding WHERE user_id = v_user;

  v_identity := r.date_of_birth IS NOT NULL
            AND coalesce(btrim(r.residential_address), '') <> '';

  v_registered := r.business_status = 'registered';

  -- The registered/independent answer itself is required; the CHECK constraint already
  -- guarantees a registered business carries its name and number, so testing the answer
  -- is enough here.
  v_professional := coalesce(btrim(r.license_number), '') <> ''
                AND r.business_status IS NOT NULL;

  -- Satisfied by 099, not by a column here. A retired destination does not count: money
  -- cannot follow it.
  v_payout := EXISTS (
    SELECT 1 FROM public.payout_destinations
     WHERE owner_id = v_user AND status <> 'retired'
  );

  v_emergency := (
    SELECT count(*) FROM public.contractor_emergency_contacts WHERE user_id = v_user
  ) = 3;

  -- A professional licence from everybody; a business registration only from somebody who
  -- said they are a registered business. Asking an independent contractor for a company
  -- document they cannot have would make the checklist impossible to finish.
  v_documents := EXISTS (
      SELECT 1 FROM public.contractor_documents
       WHERE user_id = v_user AND kind = 'professional_license')
    AND (NOT coalesce(v_registered, false) OR EXISTS (
      SELECT 1 FROM public.contractor_documents
       WHERE user_id = v_user AND kind = 'business_registration'));

  -- Both documents, at their CURRENT versions. An old signature does not carry forward.
  v_agreements := (
    SELECT count(*) FROM public.agreement_acceptances a
     WHERE a.user_id = v_user
       AND a.version = public.current_agreement_version(a.document)
       AND a.document IN ('terms_of_service', 'partner_agreement')
  ) = 2;

  RETURN jsonb_build_object(
    'user_id', v_user,
    'steps', jsonb_build_object(
      'identity',     v_identity,
      'professional', v_professional,
      'payout',       v_payout,
      'emergency',    v_emergency,
      'documents',    v_documents,
      'agreements',   v_agreements
    ),
    -- What the UI needs to render the forms without a second round trip.
    'business_status',     r.business_status,
    'needs_business_doc',  coalesce(v_registered, false),
    'emergency_count',     (SELECT count(*) FROM public.contractor_emergency_contacts
                             WHERE user_id = v_user),
    'complete', v_identity AND v_professional AND v_payout
            AND v_emergency AND v_documents AND v_agreements
  );
END $$;

REVOKE ALL ON FUNCTION public.contractor_onboarding_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contractor_onboarding_status(uuid) TO authenticated;

COMMENT ON FUNCTION public.contractor_onboarding_status(uuid) IS
  'The only definition of a finished contractor onboarding (116). The dashboard banner, '
  'the checklist, the gate and the admin view all read this one function.';


-- ─────────────────────────────────────────────────────────
-- Writing — self only, through these and nothing else
-- ─────────────────────────────────────────────────────────

-- Every writer starts here: a signed-in contractor acting on their own record.
CREATE OR REPLACE FUNCTION public.assert_own_onboarding()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_signed_in: sign in to continue';
  END IF;
  IF NOT public.holds_contractor_access(v_user) THEN
    RAISE EXCEPTION 'not_contractor: this is the contractor onboarding';
  END IF;
  RETURN v_user;
END $$;

REVOKE ALL ON FUNCTION public.assert_own_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_own_onboarding() TO authenticated;


-- ── Section 1 ──
CREATE OR REPLACE FUNCTION public.save_contractor_identity(
  p_date_of_birth date,
  p_address       text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := public.assert_own_onboarding();
BEGIN
  IF p_date_of_birth IS NULL THEN
    RAISE EXCEPTION 'dob_required: a date of birth is required';
  END IF;
  IF coalesce(btrim(p_address), '') = '' THEN
    RAISE EXCEPTION 'address_required: a residential address is required';
  END IF;
  -- The CHECK constraint below catches these too, but its message is Postgres's own and
  -- does not begin with a code — the form would fall through to "that did not save" and
  -- leave somebody re-typing a date without being told what is wrong with it.
  IF p_date_of_birth > (CURRENT_DATE - INTERVAL '18 years') THEN
    RAISE EXCEPTION 'dob_too_young: a contractor must be at least 18';
  END IF;
  IF p_date_of_birth < (CURRENT_DATE - INTERVAL '100 years') THEN
    RAISE EXCEPTION 'dob_implausible: check the year on that date of birth';
  END IF;

  INSERT INTO public.contractor_onboarding (user_id, date_of_birth, residential_address)
  VALUES (v_user, p_date_of_birth, btrim(p_address))
  ON CONFLICT (user_id) DO UPDATE
    SET date_of_birth       = EXCLUDED.date_of_birth,
        residential_address = EXCLUDED.residential_address,
        updated_at          = now();

  RETURN public.contractor_onboarding_status(v_user);
END $$;


-- ── Section 2 ──
CREATE OR REPLACE FUNCTION public.save_contractor_business(
  p_license_number text,
  p_business_status text,
  p_business_name   text DEFAULT NULL,
  p_business_reg_number text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.assert_own_onboarding();
  v_name text := NULLIF(btrim(coalesce(p_business_name, '')), '');
  v_reg  text := NULLIF(btrim(coalesce(p_business_reg_number, '')), '');
BEGIN
  IF coalesce(btrim(p_license_number), '') = '' THEN
    RAISE EXCEPTION 'license_required: a professional licence number is required';
  END IF;
  IF p_business_status NOT IN ('registered', 'independent') THEN
    RAISE EXCEPTION 'business_status_required: say whether you are a registered business or independent';
  END IF;
  IF p_business_status = 'registered' AND (v_name IS NULL OR v_reg IS NULL) THEN
    RAISE EXCEPTION 'business_details_required: a registered business needs its name and registration number';
  END IF;

  -- An independent contractor keeps no company name: switching from registered clears
  -- both, rather than leaving a stale company attached to a sole trader.
  IF p_business_status = 'independent' THEN
    v_name := NULL; v_reg := NULL;
  END IF;

  INSERT INTO public.contractor_onboarding
    (user_id, license_number, business_status, business_name, business_reg_number)
  VALUES (v_user, btrim(p_license_number), p_business_status, v_name, v_reg)
  ON CONFLICT (user_id) DO UPDATE
    SET license_number      = EXCLUDED.license_number,
        business_status     = EXCLUDED.business_status,
        business_name       = EXCLUDED.business_name,
        business_reg_number = EXCLUDED.business_reg_number,
        updated_at          = now();

  -- Dropping to independent makes any business-registration document irrelevant. Left in
  -- place it would be an unexplained company document on a sole trader's file.
  IF p_business_status = 'independent' THEN
    DELETE FROM public.contractor_documents
     WHERE user_id = v_user AND kind = 'business_registration';
  END IF;

  RETURN public.contractor_onboarding_status(v_user);
END $$;


-- ── Section 4 ──
--
-- All three at once, replacing what was there. Saving them one at a time would allow a
-- half-filled set to sit there looking finished.
CREATE OR REPLACE FUNCTION public.save_contractor_emergency_contacts(p_contacts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.assert_own_onboarding();
  v_n    integer;
BEGIN
  IF jsonb_typeof(p_contacts) <> 'array' THEN
    RAISE EXCEPTION 'contacts_shape: expected a list of three contacts';
  END IF;
  v_n := jsonb_array_length(p_contacts);
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'contacts_count: three emergency contacts are required, got %', v_n;
  END IF;

  DELETE FROM public.contractor_emergency_contacts WHERE user_id = v_user;

  -- The column CHECKs do the validating — a blank name or a number that is not E.164
  -- aborts the whole statement, so a bad third contact cannot leave the first two saved.
  INSERT INTO public.contractor_emergency_contacts
    (user_id, position, full_name, relationship, phone)
  SELECT v_user,
         (ord)::smallint,
         btrim(c->>'full_name'),
         btrim(c->>'relationship'),
         btrim(c->>'phone')
    FROM jsonb_array_elements(p_contacts) WITH ORDINALITY AS t(c, ord);

  RETURN public.contractor_onboarding_status(v_user);
END $$;


-- ── Documents ──
--
-- The file itself is uploaded to the private bucket by the browser; this records where it
-- went. Nothing here trusts the path beyond its shape: storage policy is what actually
-- confines a contractor to their own folder.
CREATE OR REPLACE FUNCTION public.record_contractor_document(
  p_kind      text,
  p_path      text,
  p_filename  text,
  p_size      integer DEFAULT NULL,
  p_mime      text    DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := public.assert_own_onboarding();
BEGIN
  IF p_kind NOT IN ('professional_license', 'business_registration') THEN
    RAISE EXCEPTION 'bad_kind: unknown document kind %', p_kind;
  END IF;
  IF coalesce(btrim(p_path), '') = '' THEN
    RAISE EXCEPTION 'path_required: nothing was uploaded';
  END IF;
  -- The path must be inside this contractor's own folder. The storage policy enforces it
  -- too; disagreeing with it here would record a row pointing at a file we cannot read.
  IF p_path NOT LIKE ('onboarding/' || v_user::text || '/%') THEN
    RAISE EXCEPTION 'bad_path: that file is not in your folder';
  END IF;

  INSERT INTO public.contractor_documents
    (user_id, kind, path, filename, size_bytes, mime_type)
  VALUES (v_user, p_kind, btrim(p_path), coalesce(btrim(p_filename), 'document'), p_size, p_mime)
  ON CONFLICT (user_id, kind) DO UPDATE
    SET path        = EXCLUDED.path,
        filename    = EXCLUDED.filename,
        size_bytes  = EXCLUDED.size_bytes,
        mime_type   = EXCLUDED.mime_type,
        uploaded_at = now();

  RETURN public.contractor_onboarding_status(v_user);
END $$;


-- ── Agreements ──
--
-- The version is NOT taken from the caller. A browser that could name the version it was
-- agreeing to could claim to have signed a document it never saw.
CREATE OR REPLACE FUNCTION public.accept_agreement(
  p_document    text,
  p_signed_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user    uuid := public.assert_own_onboarding();
  v_version text := public.current_agreement_version(p_document);
  v_name    text := NULLIF(btrim(coalesce(p_signed_name, '')), '');
  v_new     boolean;
BEGIN
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'unknown_document: there is no agreement called %', p_document;
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'signature_required: type your full name to sign';
  END IF;

  INSERT INTO public.agreement_acceptances (user_id, document, version, signed_name)
  VALUES (v_user, p_document, v_version, v_name)
  ON CONFLICT (user_id, document, version) DO NOTHING;
  v_new := FOUND;

  -- One audit row per signature, not one per page refresh — the same reason 106 reads
  -- FOUND. `p_person` is the signer: 089 refuses an activity with neither a project nor
  -- a person, and this has no project.
  IF v_new THEN
    PERFORM public.log_activity(NULL, 'contractor.agreement_accepted', NULL, NULL, v_user,
      jsonb_build_object('document', p_document, 'version', v_version));
  END IF;

  RETURN public.contractor_onboarding_status(v_user);
END $$;


REVOKE ALL ON FUNCTION public.save_contractor_identity(date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_contractor_business(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_contractor_emergency_contacts(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_contractor_document(text, text, text, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_agreement(text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_contractor_identity(date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_contractor_business(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_contractor_emergency_contacts(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_contractor_document(text, text, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_agreement(text, text) TO authenticated;


-- ─────────────────────────────────────────────────────────
-- Storage: a contractor's own folder in contractor-docs
-- ─────────────────────────────────────────────────────────
--
-- The bucket already exists (026, private). Its policies cover the public application
-- form — anon insert, admin read. Onboarding needs a third shape: a signed-in contractor
-- writing and reading `onboarding/<their uuid>/...` and nothing else.
--
-- Wrapped, because on a hosted project `storage.objects` is owned by `supabase_storage_admin`
-- and a migration run as `postgres` may not be permitted to add a policy to it. If this
-- is skipped, add the two policies by hand in Storage > contractor-docs > Policies; the
-- notice below says so rather than letting the whole migration fail.
DO $$
BEGIN
  DROP POLICY IF EXISTS contractor_onboarding_docs_write ON storage.objects;
  CREATE POLICY contractor_onboarding_docs_write ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'contractor-docs'
      AND name LIKE ('onboarding/' || auth.uid()::text || '/%')
    );

  DROP POLICY IF EXISTS contractor_onboarding_docs_read ON storage.objects;
  CREATE POLICY contractor_onboarding_docs_read ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'contractor-docs'
      AND (name LIKE ('onboarding/' || auth.uid()::text || '/%') OR public.is_admin())
    );
EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
  RAISE NOTICE 'SKIPPED storage policies (%) — add them by hand in Storage > contractor-docs > Policies', SQLERRM;
END $$;


-- ─────────────────────────────────────────────────────────
-- Admin
-- ─────────────────────────────────────────────────────────
--
-- One row per contractor with their progress, for the admin contractor list. Reads the
-- same status function as the contractor's own dashboard, so the two cannot disagree
-- about who is outstanding.
CREATE OR REPLACE FUNCTION public.admin_contractor_onboarding()
RETURNS TABLE (
  user_id   uuid,
  email     text,
  full_name text,
  status    jsonb
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.email, p.full_name, public.contractor_onboarding_status(p.id)
    FROM public.profiles p
   WHERE public.is_admin()
     AND public.holds_contractor_access(p.id)
   ORDER BY p.full_name NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.admin_contractor_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_contractor_onboarding() TO authenticated;


-- 115's purge is unaffected: contractor_onboarding, contractor_emergency_contacts and
-- contractor_documents all cascade from auth.users, and agreement_acceptances carries no
-- foreign key by design. Nothing added here can block a delete.

COMMIT;
