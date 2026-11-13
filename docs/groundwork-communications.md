# Groundwork communications

Groundwork owns activation reminders, recipient preferences, replies and staff
follow-up. Resend transports email. GoHighLevel can keep sales and partner
application workflows and an optional copy of contact facts; it no longer receives
activation workflow triggers from Groundwork.

This implements the user's decision after reviewing the November communication
documents. The user's later decisions take precedence: **Vercel Pro**, invitation
links without expiration, and **WhatsApp outside this release** (confirmed on
14 November).

The user's current scope is to finish building the Groundwork lifecycle flow.
GHL workflow retirement and provider/domain activation are deferred launch work;
they do not block implementation or local acceptance of the flow.

## Implemented behavior

- **Admin → Communications → Journeys** shows the four separate paths, their
  message codes and their actual schedule from each stage's entry. Alternative
  contractor onboarding and client support paths are labelled. Message previews
  use example details, English/French selection and the same copy and timing
  helpers used by the worker. Preview destinations are shown without opening a
  real invitation or sending email. The editor can be filtered to one journey.
- Message editing preserves unsaved fields through the periodic refresh. Saving
  updates only edited fields, retains newer edits typed during an earlier save,
  prevents repeated in-flight saves and keeps failed saves available for retry.
  A stale background read cannot restore the text from before a successful save.
- Missing names and project wording use the message language. If a French field
  falls back to English, its fallback wording also remains English.
- The existing four activation journeys retain their own messages and project
  context. Reminder deadlines remain measured from entry into the unfinished step
  at Day 1, Day 3 and Day 7. Saved actions, project roles and invitation status are
  checked before delivery. Independent signups yield to actual primary-role
  invitations, even when the corresponding browser event was interrupted.
- `create_project` is now a distinct contractor onboarding choice. Previously that
  choice was saved as `no_client`, which suppressed the very reminder it needed.
  A recipient can pause project-creation nudges or unsubscribe from all activation
  nudges through a separate confirmation page. Opening that page makes no changes.
  Resuming allows future journeys; it does not replay previous messages. Essential
  account-security messages are separate.
- The independent onboarding email trigger from migration 161 is retired. Its log
  remains available; the managed CS05 sequence owns the acknowledgement.
- A shareable project link has no known recipient until claimed. Only the known
  inviter receives pending-link reminders. Creating a link never records an email
  as sent to an unknown person. Actual acceptance retires the pending reminders.
  Observer membership does not enter primary-client activation.
- Email retries use saved payloads, stable provider idempotency keys and atomic
  worker leases. An uncertain request older than 23 hours is held for review.
  Signed delivery callbacks can arrive before the HTTP response without losing
  the delivery verdict or recording a staff contact twice.
- Replies to managed messages go to a thread-specific address on the configured
  receiving domain. The saved recipient must match the sender. Provider-verified
  DMARC alignment is required for a reply to pause reminders automatically.
  Unverified content remains visibly marked for review. Message HTML is presented
  as text. Attachments are counted; this release does not download their contents.
- **Admin → Communications** includes the inbox, editable sequence copy, send log,
  background-run status and settings. Staff can queue replies to the saved
  recipient, assign follow-up owners, record contact notes, schedule the next
  attempt and review history. A contact attempt leaves an unfinished activation
  task open. Delivery and support issues are not silently closed by project events.
  Assigned staff receive dashboard notifications when follow-up needs attention.
- Qualified/engaged stalled users enter the Day-7 staff queue. The default next
  contact interval is 48 hours and is editable. Overdue tasks return to attention;
  staff still conduct the actual conversation or call.
- **Admin → Communications → Tracking** measures signup → onboarding → first
  project → invitation, acceptance of delivered invitations, project-link claims,
  time to a connected project, recovery after each message, human recovery and
  reviewed duplicate projects. Date cohorts are calculated in the database.
  Search, journey and recorded-status filters paginate the people table without
  truncating the measurement totals. Finishing an email sequence remains distinct
  from completing its required action.
- Staff can open a person's saved conversation or contact history from Tracking.
  Calls have an actual contact time separate from their logging time, and can be
  recorded after activation automatically closes the task. Adding that history
  keeps the completed task closed. Open tasks require a future next-contact date.
- Project records support reversible, reasoned duplicate flags. Project filters
  combine creation dates, saved client/contractor origin, owner and existing
  status/qualification/search controls. Contractor filters combine actual account
  joining dates, owned or assigned project status and onboarding progress.
  Changing an account role does not change a project's saved creation origin.

## Sending addresses

The user's selected defaults are saved in communication settings, without adding
environment variables:

| Purpose | Sender |
| --- | --- |
| Partner applications, decisions and acknowledgement recovery | `partner@tryjalla.com` |
| Immediate welcome and milestone messages | `noreply@mail.tryjalla.com` |
| Day 1/3/7 reminders and staff follow-up replies | `contact@tryjalla.com` |

All are editable in Admin. Partner-application delivery is independent of the
activation delivery switch. The sending domains must be verified in Resend.
The receiving domain is intentionally unset until its DNS and webhook are ready.
The chosen From address and the thread-specific Reply-To address serve different
purposes. General mail sent directly to the company's contact mailbox is not
automatically imported by the thread-reply handler.

## Apply and configure

Use the **full timestamped filenames** below. The older `009_admin.sql` is the
legacy admin bootstrap, not this communication release's delivery migration. It
may already be installed. Keep its existing notification policies; replacing them
is not a prerequisite for the communication upgrade.

1. Apply only missing prerequisites through
   `20261113000700_admin_user_roles.sql`, including the lifecycle delivery/recovery
   and non-expiring project-link migrations. Then apply these new migrations in
   order:
   - [20261113000800_groundwork_communications.sql](../supabase/migrations/20261113000800_groundwork_communications.sql)
   - [20261113000900_communication_delivery_and_replies.sql](../supabase/migrations/20261113000900_communication_delivery_and_replies.sql)
   - [20261113001000_activation_invitation_priority.sql](../supabase/migrations/20261113001000_activation_invitation_priority.sql)
   Then apply
   [20261113001100_communication_schema_repair.sql](../supabase/migrations/20261113001100_communication_schema_repair.sql).
   For databases that already installed an early copy of 008–010, the repair is the
   single incremental query to use. It adds the separate sender fields, staff
   send timestamp, follow-up review timestamp and issue table, and reinstalls the
   final communication RPCs. Existing consent, messages, delivery and journey
   enablement remain recorded. Replaying the old CREATE TABLE statements alone
   does not add columns to an existing table.
   Then apply
   [20261113001300_communication_tracking.sql](../supabase/migrations/20261113001300_communication_tracking.sql)
   for the measurement tables, Admin reports/contractor filter metadata, actual
   contact times and reversible duplicate flags. It preserves delivery and journey
   enablement, and sends no email. The separate project-creation trigger hotfix
   `20261113001200_project_creation_trigger_records.sql` is still required wherever
   the reported creation-trigger error has not been repaired.
2. In GHL, retire the old activation welcome/reminder workflows **and remove
   existing contacts from their pending timers** before enabling Groundwork.
   Removing event triggers in code cannot cancel messages already scheduled inside
   GHL. Retain the separate sales/partner-application workflows as needed.
3. Deploy the code to Vercel **Pro**. The existing payment poll remains unchanged.
   `/api/lifecycle-run` runs every five minutes and the shared events function has
   a 300-second maximum duration. Confirm Production has `CRON_SECRET`, the
   Supabase service credentials, `RESEND_API_KEY` and the canonical HTTPS
   `PUBLIC_SITE_URL`. The Resend key must permit reading received email as well as
   sending it. Do not expose those credentials to browser configuration.
   The Node function duration is declared by path in `vercel.json`, following
   [Vercel's function configuration](https://vercel.com/docs/functions/configuring-functions/duration).
4. Configure the reply receiving domain in Resend and add the supplied MX/DNS
   records. Set the same domain in Admin → Communications → Settings.
   It must receive `reply+<thread-id>@<domain>` addresses. Keep previous receiving
   domains operational when rotating them so replies to older emails still work.
5. Configure a signed Resend webhook to
   `https://<PUBLIC_SITE_URL host>/api/events?action=email-receipt`, subscribing to
   `email.received`, `email.sent`, `email.delivered`, `email.bounced`,
   `email.complained`, `email.failed`, `email.opened` and `email.clicked`.
   Store its signing secret in the existing
   `app_config.resend_webhook_secret` setting (or the supported
   `RESEND_WEBHOOK_SECRET` environment override). The inbox never accepts unsigned
   webhook messages.
6. Choose a default admin follow-up owner and next-contact interval. Add controlled
   test recipients before enabling delivery. The recipient list limits activation
   reminders and staff replies. An empty list allows all eligible recipients; it
   is not a pause switch.
7. Review the English/French message drafts and use **Preview due messages**.
   Enable only the journeys selected for testing, then enable communication
   delivery. New migrations leave the global delivery switch off and never enable
   a journey. `LIFECYCLE_WHATSAPP_ENABLED` remains false; WhatsApp is outside this
   release.

## Acceptance test before wider delivery

Use the four independent/invited client/contractor paths, with both new and existing
accounts. Verify the exact CTA, account/project role and English/French wording.
An invited account must see the existing project and receive no duplicate-project
instructions. Test both email invitations and shareable links.

For a test recipient, check one immediate email, a due reminder, a reply appearing
in the inbox, paused automation, an admin reply and its delivery callback. Repeat
the same provider callback and queue request to verify deduplication. Check
unsubscribe and no-project preferences, actual milestone cancellation, a Day-7
qualified task and an overdue follow-up. Confirm recording contact does not mark
the missing user action complete. Check that the background-run time advances
without pressing Run now and that GHL sends no duplicate activation mail.

Preview is read-only. **Run now** can deliver eligible messages when delivery is
enabled. Production migrations, DNS changes, deployment, real-recipient sends and
journey activation were not performed by this local implementation.

## Local verification

`npm run test:lifecycle-db` installs and replays the real migrations in an isolated
PostgreSQL database and tests consent, roles, assignment, inbound deduplication,
immutable staff replies, stale leases, early callbacks, delivery suppression and
uncertain-send review. It also installs/replays the tracking migration, checks
conversion/delivery denominators, actual contact-time recovery, connected-project
timestamps, assigned-project filters and ordinary-user access refusals.
`npm run test:team-db` installs the communication upgrade
over the project-team schema, then exercises real primary-client/contractor claims
and concurrent single-use link claims. Unit/UI tests cover webhook signatures,
provider request boundaries, sender selection, queue authorization, preference
confirmation and retry behavior. Tracking UI tests cover unknown data, paging,
stale responses, late call records and reversible duplicate flags. None sends real
email.

## Measurement boundaries and remaining product scope

Tracking records real milestone and action facts even while email journeys are
disabled. A sending-service acceptance counts as a sent invitation; acceptance
rates use confirmed delivery as their denominator. Share links are measured
separately. Recovery is a temporal association with the last confirmed message
before action completion, not proof of causation. A logged call, an email open or
an exhausted sequence never counts as completing the action by itself.

Historical connections without known timestamps are labelled unknown and excluded
from the time median. Missing denominators display an em dash. Duplicate counts
use explicit staff review, not guesses from similar names. Coverage is shown in
Admin so incomplete older tracking is visible. See
[the release review](communication-framework-release-2026-11-14.md) for the full
framework and comprehensive acceptance checklist.

Custom substages and full payment-history onboarding remain deferred as previously
agreed. Verification revenue and contractor bidding follow the completed platform
acceptance test. WhatsApp is outside this release.
