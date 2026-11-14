# Direct Meta WhatsApp setup

The confirmed first connection is **Meta’s test number**. Groundwork owns the
communication framework; Meta carries WhatsApp messages. Sending remains off by
default. This guide describes the new implementation, not proof of a live connection.

## Groundwork's registered business number

The account owner confirmed **+1 469 991 3055** (`+14699913055`) as Groundwork's
registered WhatsApp Business number. Keep it as the intended business number for
the company connection after the test. Its current registration method and Cloud
API connection still need confirmation.

For the first test connection, enter the actual **Meta-provided test number** in
Groundwork's business/test phone field, together with that test number's Meta
phone-number ID. The company number is not the Meta phone-number ID. Recording it
here does not change the active connection or enable sending.

### Connecting the company number after the test

Confirm where `+14699913055` is currently registered before choosing its onboarding
path. An existing Cloud API registration supplies its own phone-number and
account IDs. A number used in the WhatsApp Business mobile app has a different
onboarding path. Meta documents coexistence through eligible partner onboarding;
our direct test connection does not establish that coexistence is available for
this account. See [Meta's existing-number guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/migrate-existing-whatsapp-number-to-a-business-account/)
and [coexistence requirements](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/).

The test-number setup below can proceed without changing the company number's
current registration.

## Release first

1. For a fresh installation, apply
   `supabase/migrations/20261114000600_meta_whatsapp_communications.sql`, then
   `20261114000700_meta_whatsapp_schema_upgrade.sql` in Supabase SQL Editor after
   the communication migrations through `20261113001300_communication_tracking.sql`.
   If the earlier 006 is already applied, run **007 only**. Open a new SQL query,
   paste the entire file, including `BEGIN` and `COMMIT`, and run it. The repair
   preserves saved configuration, credentials, consent and message history.
2. Deploy the matching application. Keep the existing Vercel Pro five-minute cron
   and `CRON_SECRET`. This change adds a webhook alias, not another Vercel function.
3. Open **Admin → Communications → WhatsApp** (`/admin/sequences?tab=whatsapp`).
   Sending starts off and the audience starts as test recipients only.

### Live readiness check — 14 November 2026

Read-only checks found the deployed Admin endpoint responding `401 not_signed_in`
and the webhook responding `503 WhatsApp webhook not configured`. Zero-row
Supabase probes confirmed the early WhatsApp tables, with exactly five newer
fields missing: settings `template_checked_at`, contacts `last_lifecycle_check_at`,
and message `reviewed_at`, `reviewed_by`, `review_note`. Control requests confirmed
that these were missing columns, not successful reads of private settings.

Apply **007** to this deployment, then deploy the matching application and continue
the Meta setup below. The application now recognizes the earlier settings schema
as requiring migration. No live configuration was changed or message sent during
these checks.

The canonical callback is **https://www.tryjalla.com/api/whatsapp-webhook**.
Use `www`: the apex redirects, and webhook delivery must avoid that redirect.
Set the existing `PUBLIC_SITE_URL` to the canonical host for other communication
links too. No new environment variables are required for this connection.

## Create the Meta connection

In [Meta Apps](https://developers.facebook.com/apps), create the Groundwork app
with the WhatsApp use case and company portfolio. Open its **API Setup**, choose
the test number, and add/verify a team-controlled recipient. Save the phone-number
ID, WhatsApp Business Account ID and temporary access token privately.

The account owner completes login, portfolio selection and any verification Meta
requests. Follow [Meta’s current setup guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started/)
if the dashboard labels differ. The temporary token is for testing; replace it with
a suitable system-user token before production.

In Groundwork’s connection settings:

- Enter the phone-number ID, Business Account ID and the actual test phone with its
  international country code. The phone-number ID is different from the phone number.
- Keep **Test recipients only** and enter the verified team phone, one per line.
- Enter the access token and the **App Secret** from the Meta app settings.
- Save. Leave sending off. Secret fields never return their saved values.
- Click **Generate verify token**, copy the one-time displayed value into Meta’s
  webhook configuration, and use the callback URL shown above.
- Verify/save the callback and subscribe to the **messages** webhook field.

Saving a different business identity or signing secret pauses sending and clears
old webhook verification. An ordinary refresh never reveals a saved secret. Do
not paste access tokens, App Secrets or verify tokens into chat, source or screenshots.

## Prove receiving and consent

Use Meta’s API Setup test message to the team phone, then reply from that phone.
Groundwork should show the message in the WhatsApp inbox and mark **Signed event:
Received**. Verification and delivery reports follow
[Meta’s webhook model](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/).

Now sign in to the controlled client or contractor account:

1. Client: **Profile → Notifications → WhatsApp reminders**. Contractor: **Profile →
   WhatsApp reminders**. Verifiers have the same control in Settings.
2. Enter the verified team phone and agree to reminders/team replies.
3. Click **Connect WhatsApp**, then **Open WhatsApp** and send the prepared `START`
   message from that same phone. The connection code expires after ten minutes.
4. Return to the profile: it should show **Connected**. A phone on a profile alone
   does not count as WhatsApp consent.

Back in Admin, run **Check connection and templates**, then **Enable sending** with
its test audience. Select the connected contact, confirm the controlled test and
click **Send Meta hello_world test**. This is an explicit connection test and does
not advance a lifecycle journey. Check acceptance, delivery, read reporting and a
reply in Admin. An expired temporary token is reported clearly.

## Enable real reminder copy

Export the English/French template pack from the WhatsApp tab. Its `templates`
array contains individual Meta template definitions; its `issues` array identifies
copy that cannot yet be submitted. In WhatsApp Manager, create the templates using
the exact names, language, body, footer and URL button. Groundwork does not submit
or approve them automatically. Meta decides approval and category.

Run **Check connection and templates** after approval. Groundwork sends only an
approved exact match, and rechecks the catalog daily. Changed text, missing
translations, invalid buttons or a missing approval hold that reminder. The
`hello_world` test is never substituted for a reminder.

Staff free-text replies require the recipient’s latest message to be within the
24-hour service window. Scheduled reminders use approved templates. See
[Meta’s service-message rules](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages).

## Controlled acceptance

Verify each of the four journeys with the agreed controlled accounts: self-signup
and invitation for each role. Check the action URL, English/French copy, completed
actions stopping reminders, Day 1/3/7 timing, human follow-up, replies, STOP and
reconnection. Local tests simulate the deadlines; they do not prove live Meta
delivery. Only expand to live recipients after this acceptance.

Detailed implementation, boundaries and test evidence:
[WhatsApp release notes](meta-whatsapp-release-2026-11-14.md).
