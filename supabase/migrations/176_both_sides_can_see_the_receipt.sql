-- The two people in the receipt handshake can see what they are acting on.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────
--
-- 175 gave the client an upload and the contractor a confirmation. Neither can see the
-- row they are acting on, because `payments` has admitted exactly three readers since
-- 090: an administrator, the project OWNER, and the beneficiary of an outgoing release.
--
-- On a contractor-run build that is the wrong three people for this feature:
--
--   · the invited client is not the owner (the contractor is — see 166), so they cannot
--     see what is owed, cannot see that their receipt landed, and cannot tell a stage
--     waiting on them from one waiting on somebody else;
--   · the contractor is not the beneficiary of an INCOMING tranche, so the one row they
--     are being asked to confirm is invisible to them.
--
-- The functions would work and the screens would be blank. Worse, they would be blank
-- in the ordinary way an empty list is blank, with nothing to say a policy was the
-- reason.
--
-- ── SCOPED TO INCOMING, DELIBERATELY ───────────────────────────────────────────────
--
-- Both new arms are `direction = 'in'` only. That is the whole of what either party
-- needs: money the client owes and the contractor is confirming.
--
-- Outgoing rows are a different matter and stay where they were. A contractor already
-- sees their own releases through `beneficiary_read_payments`, and must not see another
-- contractor's. The invited client must not see the payout ledger of a build they do
-- not own — what Jalla pays whom is not theirs, and widening this to match the owner
-- policy would hand it to them on every shared project.
--
-- Read only. There is still no INSERT, UPDATE or DELETE policy on this table: every
-- write goes through an RPC, which is what makes the handshake in 175 enforceable.
--
-- Run in: Supabase Dashboard > SQL Editor (after 175)

BEGIN;

DROP POLICY IF EXISTS "client_read_incoming_payments"     ON public.payments;
CREATE POLICY "client_read_incoming_payments" ON public.payments
  FOR SELECT TO authenticated
  USING (direction = 'in' AND public.is_project_client(project_id));

DROP POLICY IF EXISTS "contractor_read_incoming_payments" ON public.payments;
CREATE POLICY "contractor_read_incoming_payments" ON public.payments
  FOR SELECT TO authenticated
  USING (direction = 'in' AND public.is_contractor_on(project_id, auth.uid()));

COMMENT ON TABLE public.payments IS
  'Groundwork''s financial ledger, both directions. in: expected → receipt_submitted → '
  'funded → reconciled (175). out: release_authorised → initiated → disbursed; '
  'initiated → failed → reconciling → disbursed | failed. Readable by staff, the '
  'project owner, an outgoing beneficiary, and — for incoming rows only — the client '
  'and the contractor on the project (176). Writes are RPC-only.';

COMMIT;

-- ── Verify ───────────────────────────────────────────────
--   SELECT polname FROM pg_policy WHERE polrelid = 'public.payments'::regclass ORDER BY 1;
--   -- expect: admin_read_payments, beneficiary_read_payments,
--   --         client_read_incoming_payments, contractor_read_incoming_payments,
--   --         owner_read_payments
