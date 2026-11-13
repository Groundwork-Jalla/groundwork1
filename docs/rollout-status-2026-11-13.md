# Groundwork rollout status — 13 November 2026

This reconciles the conversation's implemented fixes, the communication release
and the remaining product work. Implementation and local tests are distinct from
production acceptance. The user's decisions govern; meeting notes are evidence.

## Urgent project-creation incident

The final creation step reported `record "old" has no field "project_id" (42703)`.
A shared trigger can produce this exact error when one SQL expression references
`projects.id` and child-table `project_id`: PostgreSQL resolves record fields in
the expression even when the incompatible branch will not be taken.

`20261113001200_project_creation_trigger_records.sql` repairs the installed
trigger definitions attached to projects, stages and fees using safe JSON record
lookups. It retains the installed validation logic, function permissions and
trigger attachments, including approved stage-price changes. It changes no
project rows and is independent of the communication-schema repair.

Local PostgreSQL checks reproduce the exact error before the repair and verify
creation afterward, exact BOQ totals, zero fees, repeated application, ordered
stages, partial/multicurrency payments and client-approved stage-price changes.
Production application and the person's successful retry are still pending.
Run the complete hotfix in Supabase SQL Editor, then retry the existing wizard's
confirmation button without refreshing or starting another project.

## Live checks completed in this review

| Check | Observed result |
| --- | --- |
| Vercel account/project access | CLI authenticated; `groundwork1` belongs to the Groundwork account. Project uses Vite and Node 24. |
| Current production deployment | `vercel inspect tryjalla.com` reports Production / READY, created 13 November at 19:16 MYT. This does not establish which database migrations are applied. |
| Canonical application address | `https://tryjalla.com` redirects to `https://www.tryjalla.com`. Use the `www` URL directly for Resend's webhook. |
| New communication reply route | Public GET returns 405 Method not allowed, consistent with the deployed POST handler. No message was queued. |
| Email webhook route | Public GET returns 405 Method not allowed. Signature validation and actual event delivery still need a live test. |
| Scheduler authentication | Unauthenticated GET returns 401 Unauthorized. |
| Production variable presence | Supabase, Resend, Anthropic and GHL variable names are present. The user-approved `CRON_SECRET` was generated privately, saved as a Production Secret and verified present. A newer deployment and successful communication background runs are now observed. |
| Existing company mail | Public MX records for `tryjalla.com` point to Google. Preserve these when configuring application replies. |
| Receiving subdomain | Neither `reply.tryjalla.com` nor `replies.tryjalla.com` currently resolves publicly. A dedicated receiving subdomain is still to be configured. |
| Sending DNS evidence | The public `resend._domainkey.mail.tryjalla.com` record exists. This is partial DNS evidence, not confirmation of Resend's account-side verification status. |

The user approved the private read-only audit and adding `CRON_SECRET`, superseding
the earlier automatic-review rejection. The secret was added without printing it.
The agent has not changed DNS, retired workflows, applied production migrations or
deployed the application. Subsequent read-only checks confirm the communication
schema repair is now installed and a newer deployment exists. The supplied test
accounts were authenticated over non-echoing stdin; passwords and session tokens
were not added to the repository or included in reports. Two explicitly approved
transport test emails were sent to the real test inboxes; both have a Resend
`delivered` result. Reminder journeys remain disabled.

## Results after the approved private checks

| Check | Actual result |
| --- | --- |
| Database delivery state | Delivery is off; all 16 activation journeys are disabled. |
| Production communication schema | All previously missing fields and the issues table are now present. The three saved sender addresses match the user's choices. |
| Incremental schema repair | Production now has the repaired table shape. `20261113001100_communication_schema_repair.sql` separately passed local upgrade/replay checks preserving settings, consent, messages and contact history. |
| Resend access | The replacement local environment key reads domains and webhooks successfully. The reserved nonexistent incoming-message permission probe returns 404, rather than a permission refusal. The user reports updating the Vercel Production key too; its stored value was not exported. |
| Resend domains | Only `mail.tryjalla.com` is registered and verified for sending; its receiving capability is disabled. `tryjalla.com` and the dedicated receiving subdomain still need setup. |
| Resend signing setup | No webhook is registered and `app_config.resend_webhook_secret` is unset. The proposed domain/webhook/secret configuration writes are awaiting approval, separately from the earlier read-only audit permission. |
| Background processing | Successful `communication_runs` are recorded, including the scheduled five-minute intervals. Delivery is off and all 16 journeys are disabled; successful runs do not establish actual reminder delivery. |
| GHL access | The configured database PIT is rejected with HTTP 401 by the documented legacy workflow list and current workflow search. A location can be inferred from the configured webhook, but no location ID is saved in database/local configuration. The separately configured Vercel value was not exported. No workflows were changed. |
| Controlled account authentication | Both supplied test accounts sign in. The contractor has the contractor account role and completed required onboarding; the client's legacy account resolves to the client dashboard. |
| Project access/figures | Both accounts can read the same project through their own authenticated permissions. Saved budget fields and all ten stage rows match. The primary client and assigned contractor roles resolve correctly, with no cross-role construction assignment to the client. |
| BOQ acceptance coverage | The existing shared test project is estimate-based. Its matching views do not establish live BOQ extraction or BOQ allocation acceptance. |
| Client UI | The production client dashboard and stage page load. The stage page has zero construction-evidence upload buttons and the appropriate receipt action is present. |
| Contractor UI | The production contractor dashboard and shared project's Work page finish loading. Seven construction-evidence upload controls appear for its active stage; the client page has none. This checks both the deployed generic Upload label and Upload Evidence label. |
| Real inbox account checks | `favour@tryjalla.com` authenticates as a client; `nwachukwufac@gmail.com` authenticates as a contractor. Both use English, have no projects yet and can read their project lists through their own permissions. No account roles were changed. |
| Controlled transport delivery | One clearly labelled test from `noreply@mail.tryjalla.com` reached each approved real test inbox's receiving mail server, according to Resend's `delivered` result retrieved for those exact message IDs. This is transport coverage, not a managed reminder/reply acceptance test. |
| Admin setup checks | Implemented: an admin-only, read-only check for schema, sender domains, receiving MX verification, incoming-message permission, webhook URL/events and signing-secret presence. Restricted credentials and incomplete provider responses are distinct from missing configuration. It sends no messages and changes no delivery settings. |
| Public setup endpoint | The production `communication-status` route is present and returns 401 to an anonymous request with `Cache-Control: private, no-store`. This establishes its access boundary, not a signed-in provider-check pass. |

The supplied real inboxes resolve the earlier Mailinator receive-only limitation.
Their credentials were used only to sign in to Groundwork. No mailbox-provider
login was performed. Actual inbound reply testing still requires the receiving
domain, signed webhook and a managed conversation thread.

## Release work still to complete

1. The communication repair's required fields are now confirmed in Production.
   For reference, the upgrade order is these
   **full filenames**:
   - `20261113000800_groundwork_communications.sql`
   - `20261113000900_communication_delivery_and_replies.sql`
   - `20261113001000_activation_invitation_priority.sql`
   - `20261113001100_communication_schema_repair.sql`
   For the early deployed 008–010 copy already observed here, run the single 011
   repair rather than restarting the old migrations.
   The old `009_admin.sql` is a separate legacy bootstrap. Its replay fix was
   verified locally, including preservation of newer permission rules.
2. `CRON_SECRET` is saved privately in Vercel Production and successful background
   runs are observed. Deploy reviewed code updates through the usual release path
   and confirm the runtime uses the replacement Resend key.
3. The replacement local key is accepted and the user reports the Vercel key has
   been updated. Add and verify the missing `tryjalla.com` sending domain for the
   chosen addresses in Resend:
   `partner@tryjalla.com`, `noreply@mail.tryjalla.com`, `contact@tryjalla.com`.
4. Set up a dedicated reply domain, recommended `replies.tryjalla.com`, using the
   exact receiving MX/DKIM records displayed in Resend. Keep the apex's Google MX
   records. Set the same reply domain in Admin → Communications → Settings.
5. Set up or verify the enabled signed webhook at
   `https://www.tryjalla.com/api/events?action=email-receipt`, with
   `email.received`, `email.sent`, `email.delivered`, `email.bounced`,
   `email.complained`, `email.failed`, `email.opened` and `email.clicked`.
   Store the corresponding signing secret in
   `app_config.resend_webhook_secret` or the supported server-only environment
   setting. Never paste secrets into chat. Check the Resend key's receiving access.
6. Inspect and retire only the GHL workflows for Groundwork signup/onboarding,
   project creation, invitations and Day 1/3/7 activation nudges. Set them to Draft,
   remove active enrollments from those workflows, and retain contact records and
   unrelated partner/sales/billing workflows. Confirm they remain retired before
   enabling Groundwork delivery. The current API token cannot inspect them; use a
   valid scoped token or complete this in the GHL dashboard. No retirement has
   been recorded as complete.
7. Select the default follow-up owner, cadence and controlled test recipient list.
   Review English/French copy and use read-only preview before test delivery.
8. Run the four journeys and full project acceptance checks below. Expand delivery
   only after those pass.

## Controlled acceptance still outstanding

- Contractor self-signup → required onboarding → project → client invite/claim.
- Client self-signup → project → contractor invite/claim and required onboarding.
- Existing-account invitations, first eligible claimant, second-claim refusal,
  revocation, non-expiring links and visibility after a later login.
- English/French recipient selection; welcome, due reminder, actual delivered
  event, inbound reply, paused nudges, staff reply, unsubscribe and Day-7 task.
- Contractor-only construction evidence, client approvals, correct first payment
  for each project origin, receipt confirmation and partial-payment/top-up gates.
- Actual receipt reading, non-receipt rejection, amount/currency mismatches and
  clear provider failure messages in Production.
- Exact BOQ total/allocation in both participant views; zero fees, historical and
  zero-cost stages; client-approved pricing increases/decreases and total refresh.
- Admin changes across Client/Contractor/Verifier/Admin; current dashboard and
  preserved project responsibilities; observer labels and permissions.

Use a project explicitly created for testing. Do not alter an existing customer's
payments, project progress or invitation records to manufacture a test result.

## Implemented and locally verified

- Confirmed BOQ extraction and exact, fee-free stage allocation, including mid-build
  history and zero stages; shared saved figures across participant views.
- Contractor evidence/client review; creator-specific payment cycle, partial
  receipts/top-ups, currency selection, receipt checks and clear error outcomes.
- Stage-price proposals with client approval and preserved original BOQ history.
- Invitation continuation/read access, single-use non-expiring project links,
  observer labeling/access and live account-role correction across all four roles.
- Project UI cleanup, in-app document/evidence previews and onboarding walkthroughs.
- Groundwork activation journeys, preferences, durable email delivery, admin inbox,
  owner/contact history, overdue attention and purpose-specific sender settings.
- Admin deletion/contact previews and existing status/qualification filters are
  present. The missing filter combinations below remain separate work.

The communication full-suite run passed 4,730 tests, followed by final targeted
checks. Typecheck, build and isolated database regressions passed. The legacy-admin
replay correction separately passed fresh/replay/upgrade database tests, payment
database regressions and 23 targeted tests. These are not live acceptance results.
The new schema repair separately passed upgrade/replay tests against the exact
missing-column layout, preserved delivery flags and historical staff contact
counts, project-team database regressions and 48 communication unit/UI tests.
Typecheck and Production build also passed after the repair and clearer receiving
key-permission diagnostic. Live browser sessions were closed after the read-only
account checks; no existing project data was edited.

The Admin email setup checks additionally passed 45 focused tests, typecheck and
the production build. Tests cover administrator authorization, secret redaction,
fixed provider targets, pagination, unverified receiving MX records, incomplete
webhook subscriptions, explicit-only checks and stale-result handling. These
configuration checks do not replace the managed journey/reply acceptance tests.

## Product backlog from the supplied history

| Item | Current scope/status |
| --- | --- |
| Broader project and contractor filters | Remaining combinations include project creation date, recorded client/contractor origin and owner, plus contractor joining date and associated project status. Existing search/status/qualification/onboarding cards remain available. |
| Full activation measurements | Still to build: signup/onboarding/project/invitation conversion, time to a connected project, recovery by reminder, assisted recovery and reliable duplicate-project tracking. Do not infer these from email completion alone. |
| Custom substages | Deferred by the user's prior instruction. Needs scope editing, stable IDs/order, preserved evidence/history and client approval rules. |
| Full prepaid/payment-history onboarding | Deferred in the working-session decisions. Current stored receipts remain authoritative. |
| Automated WhatsApp follow-up | Paused; existing user-initiated chat is separate. |
| Device-level duplicate-account detection | Future requirement from the review; no device-level prevention is established by the current email-uniqueness rule. |
| Verification revenue and contractor bidding | Follow-on review after successful full-workflow testing; readiness of those broader flows has not been established by this communication release. |
| Team decisions/sign-off | Confirm follow-up staffing/cadence and conduct the live review. Exact brand shade and a representative real receipt were team follow-ups in the notes. |

The admin contractor dossier's display for the newly distinct `create_project`
choice was also corrected in this review, so it no longer reads as waiting for an
assignment. This is a local UI correction, not evidence of a new deployment.

## Provider instructions checked

- [Resend receiving domains](https://resend.com/docs/dashboard/receiving/custom-domains)
- [Resend webhooks](https://resend.com/docs/webhooks/introduction)
- [Vercel environment variables and redeployment](https://vercel.com/docs/environment-variables/managing-environment-variables)
- [HighLevel workflow publish/draft behavior](https://help.gohighlevel.com/support/solutions/articles/155000001254)

## Dashboard steps if the account owner completes setup

### Vercel

Open `groundwork1` → Settings → Environment Variables. Add `CRON_SECRET` for
Production as a Secret. Generate a random value privately, for example with
`openssl rand -hex 32` on your own computer. Save it in Vercel, without sharing it
in chat. After the database and test recipients are ready, redeploy Production so
the function and scheduled job receive the new setting. Then check the recent
background-run time in Admin → Communications and the Vercel cron logs.

### Resend domains and replies

1. Open Resend → Domains. Confirm **Sending verified** for `tryjalla.com` and
   `mail.tryjalla.com`; the chosen application/follow-up and welcome addresses use
   those different domains.
2. Add `replies.tryjalla.com` as the dedicated receiving domain and enable Receiving.
3. Open the domain's DNS instructions. In the DNS provider, add the exact records
   displayed by Resend for that subdomain, including its receiving MX record.
   Do not substitute an example MX hostname: it can vary by domain and region.
4. Return to Resend, verify the records and wait for receiving to show verified.
   The existing Google MX records for `tryjalla.com` stay in place.
5. Set `replies.tryjalla.com` as the reply domain in Groundwork's communication
   settings. Sender addresses remain the three addresses selected by the user.

### Resend webhook

1. Open Resend → Webhooks. Find or create the endpoint
   `https://www.tryjalla.com/api/events?action=email-receipt`.
2. Enable the eight events listed in the release checklist above.
3. Copy that endpoint's signing secret privately. In the Supabase SQL Editor,
   store it using the statement below, replacing the placeholder only in your
   private editor:

   ```sql
   INSERT INTO public.app_config (key, value)
   VALUES ('resend_webhook_secret', 'PASTE_THE_RESEND_SIGNING_SECRET_HERE')
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
   ```

4. Confirm the webhook is enabled and the server's Resend API key has permission
   to retrieve received messages. Check actual delivery and inbound events with
   the selected test inboxes; a successful public GET is not a signature test.

### GHL retirement

Open the correct Groundwork sub-account → Automation → Workflows. Identify the
old platform activation automations by their trigger and message purpose, not just
their display name. Relevant old tags include `groundwork:signup`,
`groundwork:onboarded`, `groundwork:building`, `groundwork:client-invited`,
`groundwork:contractor-invited` and `groundwork:connected`.

Set only those old Groundwork activation workflows to Draft and save. Inspect
their active enrollments and use the workflow's remove-enrollment action, retaining
the underlying CRM contact records. Draft workflows can retain waiting contacts;
removing old enrollments prevents a later republish from resuming their reminders.
Keep partner application/sales, waitlist and billing workflows available. If a
workflow mixes activation and sales actions, review its definition before changing
its status. Record the names and active-enrollment counts for the release review.

### Controlled acceptance

Supply one client inbox and one contractor inbox. In Groundwork communication
settings, add those addresses to Test recipients and choose the staff follow-up
owner. Keep wider delivery paused until the sending/receiving setup, database
migrations and GHL retirement are confirmed. Use Preview due messages, then enable
only the selected test journeys. Exercise the four paths and receipt checks above
using clearly named test projects. Check the actual test inbox, the Resend event,
Groundwork's send log, the inbound reply and the staff task before recording a pass.
