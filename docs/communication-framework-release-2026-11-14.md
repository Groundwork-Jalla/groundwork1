# Communication framework — 14 November 2026

The current scope is Philip's complete activation communication framework inside
Groundwork Admin: automated email, next-action tracking, human follow-up and
measurement. It includes the four journeys below. WhatsApp is outside this
release under the user's latest explicit decision. GHL workflow retirement and
external provider setup remain launch work, rather than prerequisites for this
local implementation.

## Four journeys

| Entry | Required progression |
| --- | --- |
| Independent contractor | Complete onboarding → create a project → invite the client → client joins |
| Client invites contractor | Accept the existing-project invitation → complete onboarding if needed → join that project |
| Independent client | Create a project → invite a contractor or request connection help → contractor joins |
| Contractor invites client | Accept the existing-project invitation → join as the primary client with review/payment responsibilities |

Each unfinished step has its own entry time. Its immediate message and Day 1, 3
and 7 reminders use that time. Completing the actual saved action stops that
step's reminders. An existing primary invitation takes priority over generic
signup/project-creation prompts. Observer invitations are separate from these
activation pathways. Non-expiring project links remain single use.

Groundwork checks saved account role, membership, onboarding and invitation state
before sending. Cron processing runs every five minutes on the user's Vercel Pro
deployment. Saved payloads, worker leases and provider idempotency protect retries.
The editor and journey preview use the worker's actual English/French copy and
schedule. The preview does not send messages.

## Recipient choices and replies

Contractors who intend to create a project have the distinct `create_project`
answer. They can choose that they have no current project and pause those nudges,
or unsubscribe from activation reminders. A preference link presents a
confirmation page; merely opening it makes no change.

Welcome/milestone messages use `noreply@mail.tryjalla.com`; reminders and staff
follow-up use `contact@tryjalla.com`; partner applications use
`partner@tryjalla.com`. All are editable in Admin. Managed messages use a tracked
Reply-To on the configured receiving domain. Verified recipient replies enter
the saved conversation and pause automation for staff attention. Unverified
incoming messages remain marked for review. Signed webhooks update delivery,
open/click and incoming-message records.

## Human follow-up

Eligible users whose action is still unfinished after Day 7 enter the staff
queue. Qualification includes project/referral context, recorded engagement,
verified replies or sufficient onboarding progress; an email open alone never
counts as activation. Staff assignment and due-date notifications keep the queue
actionable.

Staff can assign an owner, send a tracked reply, record a call/conversation with
its actual time, add notes and choose the next contact date. The default interval
is editable in Settings. Overdue tasks return to attention. Contacting a person
does not close their unfinished activation task. Saving the required user action
closes activation follow-up automatically; delivery/support issues retain their
own workflow.

Tracking exposes both open and completed contact histories. A call entered after
the user has completed the action keeps the task completed and retains the actual
conversation time for recovery reporting. Administrators cannot resolve an
unfinished activation merely by recording contact. Staff conduct the actual call
or conversation; the system automates routing, reminders and tracking.

## Tracking and filters

Admin → Communications → Tracking includes database-calculated cohorts and a
paginated person/action table with the last actual email, delivery status, next
message, project, staff owner, contact attempts, conversation and history.

| Measurement | Recorded evidence |
| --- | --- |
| Signup → onboarding | Independent contractor signup followed by completed onboarding |
| Onboarding → project | Completed independent onboarding followed by an owned contractor-origin project |
| First project → invitation | A first project's email accepted by the sending service, or an accepted shared link |
| Email invitation acceptance | Accepted primary-role invitations divided by email invitations with recorded delivery |
| Project-link claims | Accepted shared links divided by links created |
| Time to connection | Median elapsed time from recorded signup/invitation to a project with both primary parties connected |
| Recovery after messages | Actual required-action completion after the latest confirmed message before that completion |
| Human recovery | Actual required-action completion after a recorded staff contact or sent staff reply |
| Duplicate-project rate | Staff-reviewed duplicate flags divided by projects created |

Date ranges define the measurement cohort; later action completions are included
as of the report time. Person search/journey/status filters narrow the table,
leaving the date-cohort cards intact. A completed email sequence awaiting action
remains visible. Sending-service acceptance and actual delivery are distinct;
shared links have their own denominator.

Milestones continue recording when sequences are disabled. Older observations are
imported when present, but unknown historical connection times are not invented.
The median excludes unknown times, missing denominators show an em dash, and
coverage is visible. Recovery records temporal association, not causation.

Projects can be filtered by creation date, saved origin, owner and existing
status/qualification controls. Contractor records can be filtered by actual join
date, owned/assigned project status and onboarding phase. Creation origin stays
fixed when an administrator changes a user's account role. Project details allow
reasoned, reversible duplicate flags without removing the project.

## Database and deployment

After the existing communication migrations through schema repair 011, apply
[20261113001300_communication_tracking.sql](../supabase/migrations/20261113001300_communication_tracking.sql).
It installs tracking facts, Admin-only report/contact/flag RPCs and the contractor
filter index, preserves delivery/sequence switches and sends no email. Deploy the
matching application code. The optional tracking upgrade cannot block signup if
it has not yet been installed; Admin reports explain the missing migration.

The separate project-creation hotfix 012 remains necessary wherever that incident
has not been repaired. This work has not applied production migrations, deployed
code, changed provider/DNS/GHL configuration or enabled live reminders.

## Comprehensive acceptance

Local checks cover migration replay, access control, qualification, invitation
priority, due times, consent, immutable retries, verified replies, action-based
closure, late contact records, metrics and Admin interface behavior. They use
isolated data and send no messages.

Verification for this build: 234 focused tests pass. The complete unit suite ran
4,784 tests: 4,779 passed in the restricted environment; five shell-based source
checks were blocked by `spawnSync /bin/sh EPERM`. Rerunning their three test files
with local shell permission passed all 64 tests, including those five checks.
Typecheck and the production build pass. The isolated PostgreSQL lifecycle suite
also passes after the final tracking changes, including replay of migration 013.
No product behavior was changed to bypass a failing check.

For the single comprehensive deployed review, use controlled accounts across all
four journeys, with both new and already-onboarded invitees. Check each actual
CTA/project, English/French copy, no duplicate-project instruction, invitation
acceptance, receipt/payment responsibilities and matching project figures. Then
exercise a controlled immediate email, Day 1/3/7 due calculation, unsubscribe,
no-project pause, real delivery callback, inbound reply, paused automation, staff
reply, Day-7 qualification, ownership, overdue attention and real-action closure.
Confirm the resulting tracking rows, conversion/recovery counts and contact
history. Test duplicate callbacks/queue requests and single-use links.

External sending/receiving domains, signed webhook delivery, GHL retirement and
real managed-email/reply acceptance are launch checks still to finish. The full
seven-day sequence has not been observed live merely because local time-based
tests pass.
