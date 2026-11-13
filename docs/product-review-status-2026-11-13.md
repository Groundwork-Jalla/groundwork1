# Product review status — November 13, 2026

The pasted meeting summary is review material. The user's direct decisions govern:
contractors upload construction evidence, clients review it, stage-price changes
need client approval, “Zaf” means XAF, and the first eligible signed-in account
claims a shareable invitation.

“Implemented” below means code is present and tested locally. It does not mean an
authenticated Production acceptance test is complete.

## Every action in the notes

| Review item | Status |
| --- | --- |
| Client evidence upload problem | Implemented previously: only contractors upload construction evidence. Clients review that evidence and upload payment receipts. |
| Contractor preview where evidence was uploaded | Fixed here: file/photo tiles open the shared in-app viewer under each substage. Completed stages offer read-only evidence when actual files exist. The inert View label was removed. |
| Workflow depends on who created the project | Implemented previously: client-created projects start with funding; contractor-created projects start with evidence, client review and payment for that reviewed first stage. |
| Currency selection and reading | Implemented: native receipt amounts, USD/XAF and other supported currencies, exact matching and server-attested saved conversion. The newly configured local Anthropic key passed live synthetic receipt/non-receipt checks; Production upload verification remains open. |
| Invalid receipt and processing error messages | Implemented previously: distinct document, mismatch, configuration and temporary-service messages, with support references. |
| Partial payments and stage deductions | Implemented previously: confirmed receipts reduce the stage balance; pending receipts stay separate. Contractors choose whether to request a top-up or proceed. |
| Payment UI, premature upload button and confirmation CTA | Implemented previously: role-specific wording, file/camera selection, gated submission controls and contractor receipt-confirmation actions. |
| Editable stage costs and budget override | Implemented previously: contractor proposals and client approval can change the project total. The original BOQ and amendment history remain recorded. |
| Matching client/contractor project views | Implemented previously: both read saved budget/allocations and refresh approved pricing changes. |
| BOQ fees, totals and historical stages | Implemented previously: no extra Groundwork fees for uploaded BOQs, exact allocation totals, zero-weight stages stay zero and historical stages retain their allocation and completed status. |
| Admin account role conversion | Extended to Client, Contractor, Verifier and Admin under Users and Team, with live dashboard updates, preserved project memberships and last-admin protection. See [current behavior](account-roles-and-links.md). |
| Invitation delivery and access roadblocks | Implemented previously: recipient-bound email invitations and acceptance through login/signup, with continuation retained until the project is readable through RLS. |
| Primary invitation method and role-segmented links | Implemented for primary clients, primary contractors and observers. Links are single-use and revocable, and now have no expiration. Email remains a separate option. |
| Role segmentation in onboarding communications | Hardened here: actual project membership wins over global account type. Observers and legacy secondary assignments stay out of primary-role activation journeys. |
| Observer label instead of Jalla | Previously added to the roster; hardened here for chat already open when someone joins. Labels refresh on messages, membership changes and window focus. An unresolved incoming member is not labelled staff. |
| Observer chat and image permissions | Existing support retained: accepted observers can discuss the project and attach chat images. They cannot upload construction evidence, approve work, record project receipts or edit stage prices. |
| Seven-day communication sequence | Existing 16-journey framework hardened here: fixed deadlines, current-state checks, project scope, durable delivery, qualified follow-up and read-only preview. French drafts supplied for 44 coded messages. Release/configuration/activation remain operational work. |
| Custom substage editing | Intentionally deferred for the future release specified in the notes. No custom-substage editor was added here. |
| WhatsApp outreach | Intentionally paused. Automated lifecycle WhatsApp sends default to off. Existing user-initiated project chat is separate. |
| DE project updates | The notes report Ruth completed the uploads during testing. No replacement evidence was uploaded by this task. |
| Follow-up testing/review | Remains the team's live testing action. No meeting or external message was sent. |

## New communication fixes

Day 1, Day 3 and Day 7 are measured from entry into the incomplete activation stage.
A delayed worker selects the latest due reminder instead of sending a backlog.
Interrupted requests are resolved with their original payload before later steps.

An atomic five-minute lease prevents overlapping workers from processing the same
enrollment. Actual onboarding, project, role and invitation records are checked
before claiming and before preparing delivery. Completed actions, accepted or
revoked invitations, account-role changes and inactive projects stop inappropriate
reminders. Paused projects defer them.

Email snapshots retain their recipient, subject and body across retries. Requests
use stable provider idempotency keys. Resend retains these keys for 24 hours; an
unconfirmed delivery older than 23 hours is held for operator review before that
protection lapses. See [Resend's documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).
Successful history and the next position are committed together. A provider success
that arrives after cancellation remains in history without reopening the journey.

The invitation endpoints already send the initial email. Enrollment now records
that actual send and starts with the next reminder, avoiding duplicate CI01/IV01
emails. Reissuing an invitation retires the earlier token’s reminders and starts a
fresh clock. Exits and follow-ups stay scoped to the affected project. Day-7 handoff
creates a staff task for qualified contacts rather than automatically contacting
every inactive signup.

Admin → Sequences → **Preview due messages** inspects due messages and suppression
reasons without claiming work, changing enrollments or contacting a provider.
Language drafts preserve staff-authored copy. No new migration enables a journey.

## Connected database check

A read-only check on November 13 found receipt-reading, receipt-currency,
stage-pricing, invitation-link and reminder-delivery schema fields available.
The existing lifecycle RPCs are exposed, but the final `worker_token` recovery
column is absent. The incremental recovery migration below supplies that field and
the final function versions without requiring an earlier migration to be replayed.

There were **16 journeys, all disabled**, and **50 message steps**, with **44 coded
steps missing French wording**. The new copy migration addresses those defaults.
No credentials, contact lists, files or receipt amounts were printed, and no
Production records were modified.

## Remaining release work

1. Apply only unapplied prerequisites and then
   [20261113000300_lifecycle_delivery.sql](../supabase/migrations/20261113000300_lifecycle_delivery.sql)
   and
   [20261113000400_lifecycle_language_copy.sql](../supabase/migrations/20261113000400_lifecycle_language_copy.sql),
   then [20261113000500_lifecycle_delivery_recovery.sql](../supabase/migrations/20261113000500_lifecycle_delivery_recovery.sql).
   Follow with `20261113000600_project_links_no_expiry.sql` and
   `20261113000700_admin_user_roles.sql` before releasing the current frontend.
2. Deploy and verify Production `PUBLIC_SITE_URL`, `RESEND_API_KEY` and `CRON_SECRET`.
   Leave `LIFECYCLE_WHATSAPP_ENABLED=false` while outreach is paused. Confirm that
   GHL workflows are not independently sending the same reminders.
3. The local Anthropic key and synthetic document extraction now pass live checks.
   Check Production receipt-reader credentials/model settings and test a real
   receipt, an unrelated image, a mismatch and a partial payment. Schema readiness
   does not establish that provider configuration is working. See
   [receipt diagnostics](receipt-verification-errors.md).
4. Preview and review the chosen journeys with controlled test accounts, then
   enable only the journeys selected for the test/release. They remain disabled
   until that action.
5. Complete authenticated client/contractor testing: evidence preview, both initial
   workflows, receipt confirmation, matching approved prices and two-account
   single-use invitation claims.

Vercel was found but installation/authorization was not confirmed. It is needed to
inspect the Production deployment environment through connected tools. This task
did not deploy, enable journeys or send real emails.

## Verification

`npm run test:lifecycle-db` exercises actual PostgreSQL migrations twice, service
permissions, concurrent claims, immutable payloads, stale leases, action checks,
revocation, deadlines, saved recipient language, staff-copy preservation and
separate project follow-ups. It also simulates the earlier schema without worker
ownership and verifies that incremental recovery preserves existing snapshots. Unit tests cover provider orchestration, preview
authorization, project-role routing, invitation deduplication and observer labels.
Final local checks passed: **4,632 tests across 263 files**, typecheck, Production
build, PostgreSQL delivery/upgrade regressions and whitespace validation. Live
acceptance and Production activation remain the release checks above.
