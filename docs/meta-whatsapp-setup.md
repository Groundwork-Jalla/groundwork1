# Direct Meta WhatsApp setup

Groundwork owns the communication framework; Meta carries WhatsApp messages.
The configured production number is **+1 469 991 3055**, with a **test-recipient-only**
audience. Sending remains off. The records below distinguish provider setup,
local application changes and actual message-delivery proof.

## Current connection status — 16 November 2026, 06:15 Malaysia time

After explicit owner approval, Meta acknowledged the Groundwork app subscription
with HTTP 200 / `success: true`. Its real callback challenge reached Groundwork at
**06:04 Malaysia time** and the saved verification timestamp is now set. The owner’s
Production setup screen also marks Configure Webhooks complete.

All **86 Groundwork template variants (43 English, 43 French)** now exist in the
production account and match the local runtime definitions. At the final read,
**86 were PENDING, zero APPROVED and zero REJECTED**. Meta assigned **62 UTILITY
and 24 MARKETING** variants. Their actual IDs, statuses and categories are in the
[submission receipt](whatsapp/2026-11-16-template-review/submission-receipt.json).
Template submission and category assignment do not enable delivery or change billing.

Meta rejected six original bodies that ended with a parameter followed only by
punctuation. The shared channel compiler adds a fixed closing sentence to those
variants. The [format corrections](whatsapp/2026-11-16-template-review/format-corrections.json)
preserve the before/after copy. Export, approval comparison and the send log use
that same compiler; saved email wording, variables and action destinations stay
unchanged. Where Meta had assigned MARKETING to an existing English name, its
French translation was submitted using that same category. Existing templates
were not overwritten or deleted, and the four generic templates were retained.

**Sending is still off**, the audience remains test-only, all 16 lifecycle sequences
remain disabled, and there are no linked WhatsApp contacts. No WhatsApp messages
were sent by these setup operations. A real signed incoming message has **not**
been observed; the callback challenge proves endpoint verification only.

The WhatsApp code/tests and these setup records are being staged separately from
client UI and email-provider work. **Commit, push and deploy the matching application**
before checking the new definitions in the live Admin page. Staging alone does not
deploy the changes. The provider credentials, subscription and submitted templates
are saved separately and do not require a push. **No migration is introduced.**
Local validation: **126 focused tests across eight files**, type checking and the
production build passed.

Next checks:

- After deployment, use **Check connection and templates** to refresh Admin’s exact
  approval cache. PENDING is not approval; wait for Meta’s recorded decision.
- On the controlled account, use **Profile → WhatsApp reminders**, give consent and
  choose Connect WhatsApp. Send the generated START message from the controlled
  phone to **+14699913055**. Keep the private START code out of screenshots and chat.
- Confirm Groundwork receives the real signed inbound event and links that phone.
  Test an explicitly requested staff reply while the 24-hour window is open, then
  confirm the actual arrival and delivery callback. The setup approval did not
  authorize outbound messages or turning sending on.
- Review the retained **LeadConnector LLC credit line**, staff ownership, journey
  switches and test audience before any paid or wider outreach. No billing change
  or additional finance permission was made.

## Earlier connection status — 16 November 2026, after account assignment

At **01:57 Malaysia time**, after the owner assigned production Messaging-account
access to the selected system user, the saved token successfully read the production
account's templates and phone list. That list confirms the configured pair:
**Messaging account `1087160260359893` → phone `1268412669693909`, `+14699913055`**.
No replacement token is needed for those reads. The earlier 100 / 33 error is no
longer returned. Sending remains off with one controlled recipient and all 16
lifecycle sequences disabled.

The complete template catalog contains four approved templates, with no Groundwork
reminder definitions. The prepared reminder pack contains **43 distinct names in
English and French: 86 variants**, with zero exact approved matches. See the
[review copy and proposed requests](whatsapp/2026-11-16-template-review/README.md).
Nothing from this pack has been submitted to Meta or sent to recipients.

Local fixes make the pack valid: the original long English buttons use WhatsApp
equivalents **Complete onboarding** and **Accept invitation**, and six exact uncoded
seed drafts are excluded from WhatsApp export/due-step selection. Custom labels
remain unchanged and invalid custom labels still require review. Actual saved
email copy, database rows, histories and switches were not changed. The underlying
seed drafts remain to be reviewed before enabling the separate email journeys.
The regenerated pack has no copy errors or conflicting definitions. Latest local
validation: **124 focused tests across eight files**, type checking and production
build passed. Deploy the matching application before using these local fixes in
the live export or automated sender. No migration is introduced by these fixes.

Remaining provider steps:

- Reverify the callback in Meta with the existing saved verify token. Groundwork's
  callback-challenge and real signed-event timestamps are still unset.
- Confirm the Groundwork app's account subscription and receive a real signed team
  message. The subscription GET timed out twice; its result is **unknown**, not a
  missing-subscription finding. Ensuring the intended app subscription is a separate
  provider write; no such write was performed during the checks.
- Submit the reviewed template pack and check Meta's approval of the exact copy.
  Proposed creation bodies allow Meta to choose the appropriate category. Approval
  and template creation do not enable Groundwork sending.
- Review the existing funding relationship before paid delivery. The owner's Meta
  screenshot shows a **LeadConnector LLC credit line**. The funding-field API read
  returned permission error 10, so the token did not establish funding details. No
  billing changes or extra finance permissions were requested.
- Link a controlled phone through Profile's consent/START flow, then test receipt
  of an actual inbound message and an explicitly requested reply while its service
  window is open. Review audience, journeys and staff ownership before wider sending.

## Earlier connection status — 16 November 2026, after publication

After the owner reported publishing the app, read-only checks at **01:10–01:16
Malaysia time** established:

| Check | Observed result |
| --- | --- |
| Token | Valid system-user token for Groundwork app `4530617580485753`. |
| Granted scopes | `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging` and `public_profile`. |
| Production phone | `1268412669693909` reads successfully and returns `+1 469-991-3055`. |
| Saved account `1087160260359893` | Template and phone-list reads fail with code **100**, subcode **33**: the object cannot be loaded or does not support the operation. |
| Token's system user | **Conversions API System User**, ID `122141001993236907`. |
| Assigned WhatsApp accounts | The scoped system-user account list is empty. |
| Business account visibility | The owned list exposes only **Test Messaging Account**, `4541464722761846`; its template catalog is readable. The shared/client list is empty. |
| Phone webhook | Meta's phone configuration points to `https://www.tryjalla.com/api/whatsapp-webhook`. This checks the configured URL, not actual delivery. |
| Groundwork switches/proofs | Sending off, test-only audience, one controlled recipient; callback challenge, signed-event and template-check timestamps still unset. |

The earlier API block is no longer returned. The remaining saved-account failure
does not by itself establish whether the ID is wrong, access is missing, or that
object lacks the requested edge. Inspect **Meta Business Settings → Users → System
users → Conversions API System User (`122141001993236907`) → Assigned assets**.
Confirm access to the production Groundwork Messaging account and validate that
its account ID is `1087160260359893`. The phone's accessibility alone does not prove
Messaging-account access. Meta distinguishes those account permissions in its
[Messaging account guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/messaging/).
Do not replace the production connection with the readable test account.

Once the production account's ID/access is established, rerun the template check,
reverify the callback in Meta, receive a real signed team message and test a single
controlled outbound message. These diagnostic calls sent no WhatsApp messages and
changed no account assignments or Groundwork settings. The updated local wording
now distinguishes **100 / 33** account/phone availability failures too; deploying
the application is needed for that wording to appear.

Latest local validation: **118 focused tests across eight files passed**, including
the inaccessible-resource phone/template paths and sanitized Admin responses.
Type checking and the production build passed. This validates the wording/error
handling change; production Messaging-account access still needs resolution.

### Duplicate system-user names — 16 November, 01:47–01:51 Malaysia time

The owner's screenshots show two dashboard entries named **Conversions API System
User**: `61587107211343` (top) and `61586625734647` (bottom). The assignment dialog
shows names but no visible IDs. The saved token's `/me` result is instead
`122141001993236907`; direct identity reads and its `business_users` edge did not
establish a mapping to either dashboard entry. Do not claim that the token belongs
to the top/bottom entry, or that differing IDs prove a different underlying owner.

Use the assignment dialog's **Search by name, ID or email** field to select a
specific intended system user. The top user, `61587107211343`, is the one whose
Groundwork app/phone assets the owner has been inspecting. After assigning the
production Messaging account to the explicitly chosen user, test the existing
token's access. If it still lacks access, generate the Groundwork app token from
that same identified user and save it privately. Naming alone cannot establish
ownership, and extra access should not be granted to both identical names to
avoid resolving the ambiguity. The identity checks changed no permissions or tokens.

## Earlier connection check — 16 November 2026, before publication

After the owner saved an access token, read-only checks at **00:12–00:15 Malaysia
time** reproduced the visible `meta_200` error. Meta's response was HTTP 400,
OAuth error **200**, subcode **5258005**, with the message **“API access blocked.”**
The phone, template catalog, permissions and token-debugging endpoints all returned
that block. The checks therefore do not establish token validity, granted scopes,
linked phone/account ownership or a successful connection. This is not evidence
that changing the saved IDs or regenerating the token alone would resolve it.

Open the **Groundwork by Jalla** app in Meta Developers and inspect **Required
actions**. Check Meta Business Settings for pending requests/admin reviews and
Business Support Home for any displayed account restrictions. Complete or resolve
any items Meta actually lists. Confirm that the system user has access to both the
Groundwork app and the Groundwork WhatsApp account, and that the token includes
`whatsapp_business_management` for connection/template reads and
`whatsapp_business_messaging` for sending. The API block prevented us from checking
those grants directly; do not assume a particular grant or restriction is missing.
Meta's references describe [permission failures](https://developers.facebook.com/docs/graph-api/guides/error-handling)
and the [template-read permission](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/message_templates/).

The saved connection is off, limited to test recipients, with one controlled phone.
Both callback verification timestamps and the template check timestamp are unset.
After Meta permits the connection check, verify the callback again using Groundwork's
saved verify token and receive a real signed incoming message before enabling a
controlled send. No credentials, IDs, provider settings or sending switches were
changed during these checks, and no WhatsApp messages were sent. See the
[sanitized diagnosis record](meta-whatsapp-checks-2026-11-16.json).

The application now distinguishes this API block from other permission failures
and expired tokens, with English/French guidance and no raw provider response or
credentials exposed. This wording change requires deployment; it does not remove
Meta's block or reset the saved connection. Earlier `meta_200` records also have
permission guidance instead of the generic fallback.

Local validation for this change: **115 focused tests across eight files passed**,
including phone/template error paths, Admin response privacy, send outcomes and API
import checks. Type checking and the production build passed. Those local results
do not establish that Meta has lifted the live access block.

### Owner screenshots — 16 November, 01:00–01:01 Malaysia time

The owner opened Required actions with both filters set to All; Meta reported no
required actions. The app is still **Unpublished**. Its Publish screen lists a
**Privacy Policy URL** item linking to app settings, and the Publish button is
disabled. The Testing screen marks `whatsapp_business_messaging` completed, while
`whatsapp_business_management` and `business_management` each show **0 of 1**
required API calls. These are test-call counters, not a report of granted token
permissions, and these screens do not identify the cause of the API access block.

The existing public policy route is `https://www.tryjalla.com/privacy`; an isolated
signed-out browser check rendered its Privacy Policy heading, policy body and
contact address. Terms are at `https://www.tryjalla.com/terms`. Add the privacy URL
under **App settings → Basic** (and the terms URL if that field is requested), save,
then return to Publish to review the remaining use-case requirements. This records
page availability, not legal review or confirmation that Meta accepts the URL.
Finish the listed management API tests and publishing requirements, then retry
Groundwork's connection check. Keep Groundwork sending off during setup. A clear
Required actions page and eventual publishing do not themselves establish that the
specific API error is resolved; the provider call must succeed before that is claimed.

## Production business number

On **15 November 2026**, the account owner confirmed that Groundwork will retain
**+1 469 991 3055** (`+14699913055`) as its planned production WhatsApp number,
after considering a replacement. The owner identifies it as a GHL-generated
number. Meta's account settings show the number as **Connected**. App access and
actual Groundwork delivery still need checking before enabling the production sender.

The production setup screenshot shows `+14699913055` selected as the sender. The
owner supplied its generated request URL on 15 November, identifying the production
**Phone Number ID as `1268412669693909`**. A subsequent Meta Business Settings
screenshot identifies the **Groundwork by Jalla Messaging account ID as
`1087160260359893`**, owned by **Jalla the firm**. Confirm that account's
**WhatsApp accounts** tab contains `+14699913055` before saving the production pair.
The recipient in the sample request is not proof of ownership or confirmed
delivery. No access token was included in that supplied request.

In the current Meta Business Settings UI, open **Accounts → Messaging accounts →
Groundwork by Jalla** to find the account ID beneath its name. Meta's evolved
account model returns the Messaging account ID in the existing WABA ID field; see
[Meta's onboarding changes](https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/onboarding/).
Groundwork's required **WhatsApp Business Account ID** field uses that ID.

After confirming the linked phone, the production connection values are:

| Groundwork field | Value |
| --- | --- |
| Meta phone-number ID | `1268412669693909` |
| WhatsApp Business Account ID | `1087160260359893` |
| Business/test phone with country code | `+14699913055` |
| Messaging account ID | `1087160260359893` |
| Audience | **Test recipients only** during acceptance |

The explicit Messaging account ID selects this account when Meta could otherwise
resolve more than one account for the sender. Use its production access token in
the private token field. Keep sending off while checking the connection. Saving
different phone/account IDs clears the old callback and signed-event verification;
verify the Meta callback again and prove a signed incoming message before enabling.
These documented values do not change the live configuration.

For the first test connection, enter the actual **Meta-provided test number** in
Groundwork's business/test phone field, together with that test number's Meta
phone-number ID. The company number is not the Meta phone-number ID. Recording it
here does not change the active connection or enable sending.

### Connecting the company number after the test

Inspect the existing registration of `+14699913055` before choosing its onboarding
path. Check the number's current Meta account and phone-number ID when available;
the test number's IDs must not be reused as the company's production IDs.
Use a company-controlled number that can receive
Meta's verification by SMS or voice call, following
[Meta's number requirements](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers).
An existing Cloud API registration supplies its own phone-number and
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
