# Direct Meta WhatsApp communication release — 14 November 2026

## Decisions and release state

- The account owner chose direct Meta Cloud API and **Meta’s test number first**.
- The intended company WhatsApp number is **+1 469 991 3055** (`+14699913055`),
  confirmed by the account owner. This does not replace Meta's test number in the
  first test connection or establish that the company number is Cloud API ready.
- This phase adds WhatsApp to the Groundwork-owned lifecycle framework and human
  communications. Email remains on Resend. No GHL automation is required.
- Migration and application changes are implemented locally. Provider setup,
  deployment, approval of reminder templates and actual delivery/reply acceptance
  remain account/deployment work. No live message was sent during implementation.
- Sending defaults off, with a separate test-recipient audience. Saving credentials
  alone does not enable sending or put contacts into reminder sequences.

## Apply and deploy

Apply `20261114000600_meta_whatsapp_communications.sql` after communication schema
repair/tracking migrations, followed by
`20261114000700_meta_whatsapp_schema_upgrade.sql`, then deploy this application.
Existing installations with the early 006 need **007 only**. The SQL is
transactional and replay-safe. It creates five Admin-readable/service-writable
WhatsApp tables, service-only RPCs and a channel marker on shared history.

Read-only production probes on 14 November confirmed an early deployed copy
missing five later columns. Repair 007 adds them and installs the current consent,
review and cross-channel RPCs. It preserves settings, credentials, consent and
message payloads; it does not enable sending. The configuration reader explicitly
checks its required settings columns and reports a migration requirement for
an older schema. Local regressions recreate that deployed shape and apply the
repair twice while checking saved data and access controls.

Three actions are added to `api/events.ts`: `whatsapp-admin`, `whatsapp-profile`,
and `whatsapp-webhook`. The clean callback rewrite is
`https://www.tryjalla.com/api/whatsapp-webhook`. The function count is unchanged.
Secrets are stored server-side in `app_config` under `meta_whatsapp_*` keys, separate
from the legacy sender. Admin GET responses expose presence booleans only.

The user's README rewrite is preserved. This change adds two migrations, three
dispatcher actions, one Supabase client module and two test files to its earlier
inventory. Its historical full-suite result is not replaced by focused test results.

## Automated behavior

Enabled journeys use their current step copy, action, recipient language and
entry-based timing. The channel has its own immutable message ledger and claims;
it never advances the email delivery position. A late connection selects the
latest due reminder rather than sending a backlog of older messages.

The five-minute Vercel Pro job processes email and WhatsApp within separate budgets.
Email sender/reply-domain setup, an email bounce, or email's enable switch cannot
prevent an otherwise eligible WhatsApp run. Global activation preferences,
project-creation opt-out, invitation priority, actual project/action state and
account roles still govern eligibility. Completed or unavailable actions are
rechecked before sending. A bounded rotating contact batch avoids starving users
after the first page.

Each reminder requires the exact approved template for its language, including
its Groundwork action URL. Copy changes invalidate the matching approval. Email
reply wording is adapted to the message channel. There is no generic-template
fallback. `hello_world` is limited to an explicitly requested controlled test and
does not count as a lifecycle send.

## Consent and receiving

Connecting from a signed-in profile creates a random, short-lived one-time code.
A signed Meta message from the requested phone must present it before the contact
is linked to that account and reminder consent is recorded. An unrelated phone
cannot claim the code. New phones retire an account's old connection. Disconnect
revokes pending codes and queued messages atomically.

The callback validates the raw-body HMAC with the App Secret and checks both the
configured Business Account and business phone-number ID. Incoming message IDs
deduplicate redelivery. BSUID-only senders can reach the inbox without a guessed
phone/email/account. Conflicting existing identities fail closed.

The sender's actual event time controls the 24-hour staff-reply window. Replies
pause reminders, surface an Admin bell notification opening the correct contact,
and put linked unfinished actions into the shared follow-up queue. Reviewing a
WhatsApp reply clears its own holds; a newer unreviewed email remains held.
STOP prevents further WhatsApp sends until the user reconnects. An ordinary later
message, an old START message or a staff resume action cannot reverse STOP.

## Human follow-up and delivery records

The Admin WhatsApp tab contains connection controls, template export/checks,
contact conversations, replies, status counts and uncertain-send review. Linked
incoming messages and successful staff replies also appear in shared contact
history with a WhatsApp marker. They are never picked up by the email sender.
Qualified stalled users get one shared Day-7 task even when email is off; contact
does not mark the user's unfinished action complete.

An HTTP send response records API acceptance. Signed callbacks separately update
delivery/read/failure. Reordered callbacks cannot downgrade a read/delivered
message. Each request includes a durable callback reference so a signed callback
can reconcile a lost HTTP result. Duplicate workers cannot claim the same message.

Timeouts, ambiguous provider errors and expired sending leases are uncertain,
never automatically resent. They hold later reminders for that enrollment. An
Admin can inspect WhatsApp Manager/recipient evidence and record acceptance with
its Meta message ID, or confirm absence of sending. This keeps the actor, note and
timestamp and does not resend the original. A later signed delivery callback can
still supply stronger evidence. Definitively failed staff/test sends can be
requested again explicitly after correction.

## Boundaries

- This release covers lifecycle reminders and Admin text conversations. Existing
  legacy project/GHL WhatsApp delivery is held when this direct connection is
  configured, so it cannot bypass consent, templates or the new ledger.
- The inbox identifies incoming attachments/captions; downloading or previewing
  WhatsApp media is outside this phase. Construction evidence and receipts retain
  their existing Groundwork upload/review flow.
- Human free-text replies need an open Meta service window. The system does not
  invent a template for arbitrary staff text when that window is closed.
- People without a connected account/verified WhatsApp consent retain the existing
  email invitation and reminder path. A phone supplied by an inviter is never
  treated as the recipient's consent to automated WhatsApp messages.
- Provider setup and actual acceptance are separate from local regression success.
  Use [the test-number setup guide](meta-whatsapp-setup.md).

## Verification

- 239 focused tests in 16 files passed: WhatsApp rules, handlers, raw signatures,
  provider outcomes, lifecycle behavior/UI, notifications and API ESM imports.
- Isolated PostgreSQL regressions passed, including migration replay, RLS,
  proof of phone ownership, Day-7 tasks independent of email, callback ordering,
  stale leases, audit history, STOP, code revocation, concurrent worker claims and
  upgrading an early schema while preserving saved settings and messages.
- Type checking and the production build passed.
- The README's known broader-suite failures remain separately recorded; this work
  does not claim a clean full-suite run or a successful live Meta send.
