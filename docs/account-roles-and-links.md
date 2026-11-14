# Account roles and non-expiring project links

The user's current decisions supersede the earlier seven-day project link policy
and the two-type account correction editor. Admins can select **Client,
Contractor, Verifier or Admin**, and the user's dashboard follows that saved role.

## Admin role changes

Use **Admin → Users → Change user role**, or the same action in **Admin → Team**.
Saving replaces the account's role assignment with the selected role. Admin access
allows platform administration; verifier access uses the verifier dashboard.
Project budgets, receipts, ownership and accepted memberships remain recorded.
The last remaining admin cannot be demoted. Concurrent changes and a form based on
stale roles are checked by the server, and successful changes are audited.

An open session reads an atomic role snapshot from the database. It listens for
role/profile changes, refreshes on focus, and checks every 15 seconds while visible
as a fallback. A changed role redirects to its corresponding dashboard without
requiring sign-out. An unknown or failed role read is retried, rather than being
interpreted as a client role. Supabase realtime must deliver the configured table
events for immediate updates; the focus/poll fallback covers missed events.

The database stores an explicit client role as `homeowner`, the existing schema
value. This prevents a retained contractor assignment from determining the account
dashboard after an admin changes it to Client. Accounts without any role rows
retain the legacy accepted-contractor-assignment fallback.

Account roles and project responsibilities are separate. A contractor who becomes
a client retains their accepted project assignments and their specific project
work view, shown inside their current account navigation. A former client keeps
their client responsibilities on existing projects. Changing account role grants
no new project membership. Existing contractor onboarding requirements still apply
to accounts changed to Contractor.

## Project links

Project invitation links have no expiration date. Existing active links retain
their tokens and become non-expiring; removed or rejected invitations stay
withdrawn. Links remain single-use and revocable. The first eligible signed-in
account with a confirmed email can claim one; a different account cannot reuse it.
Same-account acceptance retries remain safe after a lost response.

Pending primary-role links continue to reserve that role until accepted or
removed. Invitation reminder eligibility also ignores the former expiration date;
the Day 1/3/7 reminder cadence is unchanged. Authentication and signed-file token
expiry is independent of project invitations.

## Release and verification

### November 14 invitation and permission follow-up

The follow-up fixes preserve share/invite tokens and full project destinations
through signup, login, MFA and blocked browser storage. Temporary preview failures
offer a retry and retain the link. Late acceptance responses cannot navigate away
after the invitation screen has closed. Each account role returns to its own
project list and retained project responsibilities use its current navigation.

Project permissions refresh on focus/realtime and every 15 seconds while visible.
Revocation and account-role changes immediately discard cached action controls.
Secondary assigned contractors retain evidence uploads; receipt confirmation
belongs to the primary contractor. Observers retain read-only access.

Apply the new
[20261114000100_invitation_role_consistency.sql](../supabase/migrations/20261114000100_invitation_role_consistency.sql)
before deploying the matching application. Existing account roles survive a first
contractor-link claim; new untyped accounts receive the contractor role. Retrying
an accepted link never undoes an admin correction or marks onboarding complete.
Claims and admin changes share a transaction lock. Tokens remain non-expiring,
revocable and single-use. No production account was changed for this verification.

The expanded local check passed **526 tests across 29 files** plus the actual
PostgreSQL team suite, including concurrent claims and role correction/retry races.
The original live Back failure was not reproduced in a production browser; local
tests cover missing active stages, locked stages after payment, role-aware Back
destinations, unmounts and permission refresh. Controlled browser acceptance remains
a release check.

Apply preceding unapplied migrations in order through
`20261113000500_lifecycle_delivery_recovery.sql`, then:

1. [20261113000600_project_links_no_expiry.sql](../supabase/migrations/20261113000600_project_links_no_expiry.sql)
2. [20261113000700_admin_user_roles.sql](../supabase/migrations/20261113000700_admin_user_roles.sql)

Deploy the matching application after these migrations. The new auth provider
requires `my_account_access`; deploy the database change first. Both migrations
are transactional and replay-safe. No live account is converted by applying them.

`npm run test:team-db` tests actual migration upgrades and concurrent link
claims, including legacy dates in the past, unchanged budgets and revocation.
`npm run test:account-roles-db` tests all four role edits, real RLS, audit identity,
metadata cleanup, stale writes, preserved assignments and concurrent last-admin
protection. Application tests exercise live role refresh, missed events, failed
and stale reads, all dashboard destinations and retained project access.

Final local validation passed: **4,668 tests across 265 files**, TypeScript,
production build, both PostgreSQL suites and whitespace checks.

After release, keep a second account signed in while an admin changes it through
the four roles. Verify its dashboard/navigation changes, existing project totals
stay the same and its project responsibilities still apply. Test a new account
with the verifier and admin destinations, then change it back. Verify one project
link with two accounts and remove another link before acceptance. No production
migration, deployment or real-account role change was performed by this code task.
