# Welcome email troubleshooting — 16 November 2026

> **RESOLVED (20 Nov 2026 — Hybrid Direct Resend Delivery):** Day-0 **Welcome** (`user_signup`) and **Project Activation** (`project_created`) emails no longer depend on GoHighLevel, `synced_to_ghl`, `reply_domain`, or the `/admin/sequences` `delivery_enabled` pause switch.
> - `api/_lib/direct-lifecycle-email.ts` sends Day-0 Welcome (`CS01`/`CL01`) and Project Activation (`CS09`/`CL05`) **immediately via Resend** using `Idempotency-Key` + DB stamps (`profiles.welcome_email_sent_at`, `projects.activation_email_sent_at` in `20261120000100_direct_welcome_activation_and_lifecycle_fixes.sql`).
> - `enrollForEvent` (`api/_lib/lifecycle.ts`) logs Step 1 in `lifecycle_sends` and schedules `/admin/sequences` starting at Step 2 (24h+) with zero duplication.
> - `/admin/sequences` fixes also shipped: `reply_domain` is now optional for outbound reminders, the contractor `signup_intent` role race is fixed in `lifecycle_action_state`, paused/test-group holds retry in **5 minutes** instead of 24h, and suppressed/held enrollments are visible under *Needs attention*.

For Favour and Ruth, following the 16 November client-onboarding test: a test client
account received no welcome email and no automated sequence. This note gives the two
causes found in the code, what was changed, and a checklist to run the test again.

## Two different emails

| Email | Sent by | Where to look when it is missing |
| --- | --- | --- |
| "Confirm your email address" | Supabase Auth, through the SMTP configured in the Supabase dashboard. No Groundwork code sends it. | Supabase → Authentication → Logs; SMTP settings; templates per `docs/supabase-email-templates/README.md`. The "check your email" screen has a resend link with a 60 s cooldown. |
| "Welcome to Groundwork by Jalla" (CL01) and the Day 1 / 3 / 7 reminders (CL02–CL04) | The Groundwork lifecycle worker, through Resend, from `noreply@mail.tryjalla.com` | Admin → Communications: Settings, Sequences, Send log, Tracking. |

The rest of this note is about the second one.

## How the welcome email is triggered

1. The person confirms their address and a session exists in the browser.
2. The app (AuthContext) calls `recordCrmContact`, which POSTs `/api/events?action=crm-user`.
3. The server reads the profile and raises the `user_signup` event with
   `user_role = client` and `entry_source = independent_signup`.
4. The lifecycle engine enrolls the address in the `cl_signup` sequence. CL01 is due
   immediately; CL02, CL03 and CL04 are due 24 h, 72 h and 168 h after enrolment
   (Day 1, Day 3, Day 7, cumulative).
5. The worker runs straight away and every five minutes (Vercel cron
   `/api/lifecycle-run`). It sends only when the global delivery switch is on and, when
   a test-recipient list is set, only to addresses on that list.

If any link in that chain is missing, nothing arrives and nothing errors on screen.

## Cause A — delivery is switched off (by design, until the cohort is chosen)

The 15 November read-back of production settings
(`docs/communication-provider-checks-2026-11-16.json`) shows `deliveryEnabled: false`,
zero test recipients and no default staff owner. The worker returns before sending
anything, so every enrolment sits as "active, due" and no email goes out. This is the
intended state until the team chooses a controlled cohort; it is not a fault.

## Cause B — the browser never raised the signup event (bug, fixed in this change)

The "already synced" flag in the browser was one key for the whole browser
(`gw:crmSynced`) and was never cleared on sign-out. So the second account ever to sign
in on a given browser returned early and never called the server. A test client created
on the same laptop as the admin who created it is exactly that case: no `user_signup`
event, no enrolment, and no welcome email even after delivery is enabled.

The same flag pattern stamped the signup country once per browser, so later accounts on
that browser kept a NULL country.

Fix (needs a deploy): both flags are now keyed by account id
(`gw:crmSynced:<user id>`, `gw:geoStamped:<user id>`). The server side was already
idempotent, so an account that missed the event is announced on its next sign-in after
the deploy, and its enrolment starts from that moment rather than from signup.

Files: `src/lib/auth/record-crm-contact.ts`, `src/lib/auth/record-signup-country.ts`,
tests in `src/lib/auth/record-crm-contact.test.ts`.

## Checklist for the next test

Use a brand-new address on the test-recipient list. Do the steps in order.

1. **Account exists and is confirmed.** Admin → Users, or Supabase → Authentication →
   Users. If the confirmation mail itself did not arrive, that is the Supabase SMTP side
   (first table above), not the sequence.
2. **Signup event raised.** Admin person preview shows "Synced" for CRM. If it shows
   "Not synced", sign in as the test account in a private window (or after the fix is
   deployed) and reload once.
3. **Enrolled.** Admin → Communications → Sequences → *Preview due messages* lists the
   address with `cl_signup` / `CL01` and a state. `hold` with a reason means the engine
   decided not to send yet (for example the action is already complete); `ready` means
   it will send once delivery is on.
4. **Cohort only.** Admin → Communications → Settings: put the test addresses in
   *Test recipients*, choose a default follow-up owner, save. Then enable only the
   `cl_signup` sequence in Sequences, then tick *delivery enabled* in Settings. An empty
   test-recipient list with delivery on sends to every eligible account.
5. **Send.** Wait up to five minutes or press *Run now*. Send log should show a
   provider-accepted send; Resend's dashboard should show the same id; then check the
   inbox and spam folder.
6. **If the Send log shows a failure instead:** "Sender and reply address are not
   configured" means the sender or reply domain is blank in Settings; a `resend_4xx`
   code means Resend rejected the request (check `RESEND_API_KEY` in Vercel and that
   `mail.tryjalla.com` is still verified); `PUBLIC_SITE_URL` must be set for links.
7. **Reminders.** Leave the account without a project. CL02 is due 24 h after
   enrolment; creating a project ends the sequence. The Journeys preview shows the
   exact due times.

Do not turn delivery on with an empty recipient list, and do not replay real customer
mail to shortcut the waiting periods.

## 30-second read-back in the Supabase SQL editor

All read-only. Run them together and read top to bottom; the first row that is not what
you expect is the reason nothing arrives.

```sql
-- 1. Is delivery on, and who is allowed to receive?
select delivery_enabled, test_recipients, default_owner_id, sender_email, reply_domain, updated_at
from communication_settings where id;

-- 2. Which sequences are switched on? (cl_signup is the client welcome, cs_signup the contractor one)
select key, enabled, trigger_event, audience from lifecycle_sequences order by key;

-- 3. Was the test account ever announced? (synced_to_ghl false = the signup event never fired)
select email, created_at, synced_to_ghl, synced_to_ghl_at from profiles order by created_at desc limit 10;

-- 4. Was it enrolled, and when is the next message due?
select sequence_key, email, status, next_position, next_send_at, emails_sent, last_sent_at, enrolled_at, exit_reason
from lifecycle_enrollments order by enrolled_at desc limit 15;

-- 5. Is the five-minute cron actually running? (no rows in the last 10 minutes = the cron is not reaching the app)
select status, started_at, finished_at, counts, error from communication_runs order by started_at desc limit 6;

-- 6. What did the worker do with the due messages?
select enrollment_id, position, status, error, provider_id, created_at
from lifecycle_deliveries order by created_at desc limit 10;
```

How to read it:

| What you see | Meaning | Fix |
| --- | --- | --- |
| 1: `delivery_enabled = false` | Worker returns before sending. | Settings tab: recipients, owner, save, then enable. |
| 1: `test_recipients` non-empty and your address not in it | Worker skips the address. | Add it, or clear the list deliberately. |
| 2: `cl_signup` / `cs_signup` `enabled = false` | Nobody is enrolled for that journey. | Sequences tab: switch it On. |
| 3: `synced_to_ghl = false` on the test account | Browser never raised the signup event (the per-browser flag bug). | Deploy the fix, or sign in once as that account in a private window. |
| 4: no row for the address | Not enrolled; see 2 and 3. | |
| 4: `status = active`, `next_send_at` in the past, `emails_sent = 0` | Due but never sent; see 1 and 5. | |
| 5: no recent rows | Cron is not calling `/api/lifecycle-run`, or `CRON_SECRET` does not match. | Vercel → Cron Jobs; press Run now in Sequences. |
| 6: `status = failed` with an error | Resend or sender config rejected it. | `resend_4xx` → key or domain; "Sender and reply address" → Settings. |
