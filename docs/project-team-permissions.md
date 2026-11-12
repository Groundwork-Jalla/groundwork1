# Primary project roles and invitations

The later [project-link review](project-links-review.md) adds first-claim,
single-use links alongside the recipient-bound email invitations described here.

The third product-review fix gives invitation authority to the primary client
and primary contractor, including when they joined somebody else's project.
The previous UI and SQL relied on `projects.user_id`, which excluded invited
primary participants.

## Behaviour

| Project membership | Invite observers | Approve work | Change primary roles |
| --- | --- | --- | --- |
| Primary client | Yes | Yes | Groundwork admin only |
| Primary contractor | Yes | No | Groundwork admin only |
| Additional observer | No | No | No |

- A client can invite the initial contractor. Accepting that invitation with the
  verified recipient account establishes the primary contractor atomically.
- A contractor who created their project can invite its initial primary client.
  The contractor cannot approve their own work while waiting for that client.
- Additional invitations grant observer access. Re-inviting an observer cannot
  promote them to client. An accepted primary client cannot be removed through
  the ordinary sharing panel.
- Contractor accounts invited as observers use the read-only project view;
  their global account role does not expose contractor work/receipt controls.
- Initial invitation forms become membership/status cards once an invitation is
  pending or accepted. Pending contractor withdrawal still requires confirmation.
- Admin → Project → Team can promote an accepted observer to primary client,
  with confirmation. The existing primary-contractor control is admin-only.
- Permission and invitation read failures leave actions unavailable and offer
  retry. Session/project changes cannot reuse earlier permissions or invitation
  results. Realtime and window focus refresh role changes.
- Invitation previews and emails describe the actual client/observer role in
  English and French. Observers do not enter primary-client CRM reminder flows.
- Contractor list labels use the explicit client flag, rather than assuming that
  the first observer invitation identifies the client.

Existing staff-assigned secondary contractor work access is preserved. Those
assignments do not acquire invitation authority. BOQ totals, allocations,
historical stage values, receipt amounts and payment states are unchanged.

## Database boundaries and existing data

`project_team_access` supplies UI capabilities. Security-definer invitation RPCs
check the same roles again, select the actor from the session, and serialize
changes on the project before locking invitation rows. Direct contractor-invite
writes through the old owner policy are removed.

The migration repairs a sole accepted contractor with a linked account, and
marks a sole pending initial invitation for primary assignment on acceptance.
Projects with several accepted contractors and no primary are left for staff
review; no contractor is chosen arbitrarily. Existing primary choices remain.

## Applying and verifying

Apply `supabase/migrations/20261112000200_project_team_permissions.sql` before
deploying the updated frontend/API. Keep the prior receipt and stage migrations
in order if they have not been applied:

1. `20261112000000_receipt_payment_amounts.sql`
2. `20261112000100_ordered_stage_progression.sql`
3. `20261112000200_project_team_permissions.sql`

`pnpm test:team-db` uses an isolated temporary PostgreSQL database and a private
Unix socket, with no TCP listener or production credentials. It tests the actual
migration, RPCs and authenticated row-level policies. Standalone PostgreSQL
bypasses RLS, so this check intentionally uses a normal local backend.

UI/API regressions cover both primary invitation paths, observer restrictions,
accepted-state prompts, confirmation, stale requests, analytics, and email
language/role copy. Run `pnpm test`, `pnpm typecheck` and `pnpm build` as well.

Local verification passed: the database/RLS regression, 1,351 targeted tests,
the final focused work/admin role checks, and 64 read-only shell checks. The
broader suite still has ten older assertion failures across `partner-funnel`,
`payment-receipt`, `whatsapp-recipient`, `partner-qualification` and
`wizard-draft`. Its new audit-label failures were fixed; its sandbox-only shell
failures passed when rerun with local process access.

No production migration, deployment, email or CRM event has been sent as part of
the local verification. The following UI change moves client invitations into a
project Team tab; see [client-project-team.md](client-project-team.md).
