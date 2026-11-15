# Account role correction and contractor onboarding — 15 November 2026

## Scope and decisions

The 14 November recording reported three gaps after an admin corrected a client
account to contractor: no notification email, a first-project prompt despite an
existing project, and client project controls after completing contractor setup.
The owner confirmed on 15 November that existing owned projects should also be
corrected, preserving money and completed work. Another contractor's accepted or
pending assignment requires review rather than replacement.

## Resulting flow

1. Admin changes the account role in Users or Team. The canonical role, display
   metadata and audit event are saved together. A transactional email and bell
   notification are queued in that same transaction.
2. For a contractor correction, owned projects with no other contractor gain an
   accepted primary assignment for their owner and use the contractor-created
   workflow. The owner's erroneous self-client membership is revoked with admin
   attribution. Real clients and observers keep their memberships.
3. Another contractor's existing or pending assignment remains in place. Admin
   receives a notification, and the role editor lists direct project review links.
   Those projects are not automatically converted.
4. The role email uses the saved English/French preference and neutral wording.
   An unfinished contractor gets a protected onboarding link; an already completed
   contractor gets the current project or workspace. All four account roles receive
   their corresponding destination. The link uses the existing account and login
   continuation; it does not create another account.
5. Contractor onboarding reads existing projects from the database. An owner or
   accepted participant completes the five required panels, then sees the completion
   message and **Access your project(s)**. A contractor with no existing project
   keeps the sixth destination choice.
6. The access button saves `existing_project` as a distinct completion answer,
   records onboarding completion and opens the existing project, or the project list
   for multiple projects. It never records the no-project opt-out. A pending or
   revoked invitation does not count as an existing project.
7. Old client-view links redirect to the work view only after a contractor assignment
   is confirmed. Tab names, receipt/stage action parameters and the anchor survive.
   Account role alone cannot grant evidence or receipt-confirmation access.

Owners, project IDs, budget values, stage allocations, zero-cost stages, pre-existing
and completed work, payment records and receipt history are retained. The origin
correction and new assignment are audited separately. The origin guard permits
this specific admin operation; ordinary project updates cannot change the origin.

## Earlier corrections

No migration automatically changes existing accounts. For a contractor corrected
before this release, open the role editor, keep **Contractor** selected and choose
**Repair contractor project access**. This repairs unambiguous owned projects and
reports conflicts. Repeating a completed repair does not duplicate assignments or
queue another notification email.

## Email delivery

`account_role_notifications` is a private durable queue with Admin read access and
service-only delivery RPCs. The existing five-minute Vercel Pro worker processes a
bounded batch; no extra cron, API entry point or environment variable is needed.
These account notices are transactional and independent of paused activation
reminders, activation opt-out and Meta WhatsApp approval.

Mail uses the configured welcome/system sender (`noreply@mail.tryjalla.com` by
default) and the configured follow-up address as Reply-To (`contact@tryjalla.com`).
The recipient comes from the account, not the browser. The provider payload and
idempotency key are retained across retries. Superseded role notices are skipped;
uncertain old attempts are held for review after the provider retry window.
`sent` records provider acceptance, not proof of inbox delivery.

## Apply and deploy

After the existing account-role, communication and November 14 project notification
migrations, apply these complete files in order:

1. `supabase/migrations/20261115000100_existing_project_contractor_onboarding.sql`
2. `supabase/migrations/20261115000200_account_role_change_notifications.sql`

Then deploy the matching application. Both migrations are transactional and
replay-safe. They do not send mail or change existing account roles on application.
The second migration replaces the role RPC and narrows the origin-guard exception.

## Local verification

Focused tests cover role synchronization and repair, both onboarding branches,
project/action redirects, observer permissions, email copy and delivery retries.
The 17-file run passed 315 tests; the final changed subset passed 48 tests,
including two additional cases for missing email credentials and closing a saved
role review. `pnpm typecheck` and the production `pnpm build` passed.

`pnpm test:account-roles-db` passed against an isolated PostgreSQL instance,
including replay after saved data, protected origins, money/history preservation,
conflict review, earlier-account repair, service-only email claims, immutable
payloads, stale workers, superseded roles, self-demotion and concurrent last-admin
protection. No production data or real message delivery was used by these checks.

## Controlled acceptance

- Correct a controlled client account that owns a project without a contractor.
  Verify the email recipient/language, login continuation, required contractor
  forms, completion message and contractor project controls.
- Compare the saved budget, stages, receipts and payments before and after the
  correction; include a mid-build project and a zero-cost stage.
- Repeat with another contractor already assigned, and with a pending contractor
  invitation. Verify the review links and preservation of those assignments.
- Repair an account corrected before deployment, then repeat the repair to verify
  it does not create another assignment or email.
- Verify a contractor with no project still has the ordinary project choice, and
  an accepted invited contractor returns to the invited project.
- Open an old client-view link with a payment/stage action and confirm the work
  view retains its target. An observer must retain read-only project access.
- Verify actual Resend acceptance and inbox delivery. Local regressions use mocked
  provider calls and an isolated PostgreSQL database; they do not prove live delivery.

The WhatsApp token remains dependent on the separate Meta team-member approval.
