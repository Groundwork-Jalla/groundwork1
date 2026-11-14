# Project sharing role selection — 14 November 2026

The user highlighted the missing sender-side dropdown from the November 13
morning session. At 02:19:25 Philip says to ask the person generating the link who
the invitation is for; at 02:43:47 he clarifies that the recipient does not choose
their own project privileges. The Friday session also discusses inviting another
contractor after the primary contractor is established.

## Implemented

- Project sharing starts with an unselected role dropdown. Selecting a role opens
  that role's existing link/email invitation panel. Selection alone creates no
  invitation and sends no message.
- A primary client can select Contractor or Observer. The initial contractor
  invitation reserves the primary contractor assignment. After that assignment is
  accepted, new contractor invitations are additional assignments.
- A primary contractor can select Client where the client invitation is available,
  Contractor for an additional assignment, or Observer. An established client
  invitation can be inspected without creating a second primary client.
- The client Team tab, contractor People tab and contractor work sidebar use the
  same selector and the actual project permission response.
- Additional contractors can upload construction updates and collaborate; primary
  contractor payment confirmation and price-proposal responsibilities stay with
  the existing primary contractor. Additional contractors cannot invite people.
- Links retain their server-generated role, do not expire, and can be claimed by
  only one eligible account. Selecting another role does not rewrite an existing
  link's permissions. Existing project members cannot use an older email
  invitation to acquire a different project role.
- Changing project/account permissions hides unavailable choices; navigating to
  another project requires a fresh selection. English and French copy describe
  the access granted by each choice.

## Release

The user confirmed deployment and migration application for the preceding
currency/payment-plan changes. This additional change requires
[20261114000400_project_invitation_role_selection.sql](../supabase/migrations/20261114000400_project_invitation_role_selection.sql),
then the matching application deployment. It replaces invitation functions without
altering budgets, receipts, account roles or existing assignments. Database replay
is tested. This implementation did not apply the new production migration,
deploy, generate real invitations or send messages.

## Verification

- Full application suite: 4,906 tests passed across 276 files.
- Focused role-selector, invitation, project-role and legacy-entry regressions
  passed, including the explicit choice, changing roles, changed permissions,
  project navigation and additional-contractor link labeling.
- Local PostgreSQL team suite passed: migration replay, primary/additional roles,
  email and link claims, old-invitation privilege guards, observer limits,
  concurrent claims, preserved account corrections and unchanged project totals.
- Typecheck, production build and whitespace checks passed.

For deployed acceptance, generate each permitted role's link from both project
origins. Confirm a new recipient immediately sees the project in the selected
role, an additional contractor leaves the primary unchanged, and a second account
cannot claim an already used link.

## Next: direct Meta WhatsApp

The user's subsequent instruction is to work on WhatsApp next, using Meta directly.
That queues the next phase after the previously email-only release. Account setup
is not yet complete; no WhatsApp automation was enabled by the role-selection work.
See [the Meta setup checklist](meta-whatsapp-setup.md).
