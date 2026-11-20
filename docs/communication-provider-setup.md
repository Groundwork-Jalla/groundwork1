# Communication provider setup

> **Update (20 Nov 2026):** `reply_domain` is now **optional** for enabling delivery and sending outbound reminders (it falls back to `sender_email` as `Reply-To`; `replies.tryjalla.com` is still used when configured for inbound reply routing). Additionally, Day-0 Welcome (`CS01`/`CL01`) and Project Activation (`CS09`/`CL05`) emails now deliver directly via Resend (`api/_lib/direct-lifecycle-email.ts`) without waiting on `/admin/sequences` `delivery_enabled`.

Provider setup and retirement of overlapping GHL activation reminders are part of
the **November 16–20 release checklist**. See
[the current weekly readiness record](weekly-readiness-2026-11-16.md).

## Current verified status — 16 November 2026

DNS checks at **00:03 Malaysia time on 16 November** (15 November, 16:03 UTC),
followed by the owner's explicit approval of webhook/settings writes and a saved
configuration check at **00:09 Malaysia time**, established:

| Area | Observed status |
| --- | --- |
| `tryjalla.com` | Verified for sending; receiving disabled. Its DKIM TXT and two sending CNAME records are verified. |
| `mail.tryjalla.com` | Verified for sending; receiving disabled. Existing records remain verified. |
| `replies.tryjalla.com` | Verified for receiving; sending disabled. Its DKIM TXT and receiving MX are verified. The MX priority is 10. |
| Existing business inboxes | Public root MX records still point to Google's five mail servers. |
| Resend webhook | Created and enabled at the canonical Groundwork endpoint, with all eight required events. Read back successfully. |
| Saved Groundwork reply domain | `replies.tryjalla.com`. |
| Saved follow-up sender | `contact@tryjalla.com`, as selected by the owner. |
| Webhook secret in Supabase | Saved privately under `app_config.resend_webhook_secret`; exact match with the provider's secret confirmed without exposing it. |
| Deployed callback authentication | Synthetic unhandled event: unsigned request rejected with 400, invalid signature rejected with 401, valid signature accepted and ignored with 200. |
| Resend incoming-email read permission | Confirmed with a reserved nonexistent email ID; no actual email content read. |
| Communication delivery | Paused. No controlled recipients or default staff owner saved. |
| Communication schema probes | `communication_messages.sent_at`, `followup_queue.last_reviewed_at` and `communication_issues.key` are accessible. |

The approved writes created the webhook, stored its signing secret, and saved the
reply domain and follow-up sender. Delivery remained paused. No emails were sent,
and the synthetic callback checks contained no email, enrollment or business-event
IDs. They establish the deployed signature checks, not a real Resend event or actual
message delivery/reply handling. The sanitized
[configuration check record](communication-provider-checks-2026-11-16.json) records
the completed setup without credentials. Controlled recipients, a staff owner, actual
arrival, incoming reply and staff follow-up remain to be tested before wider delivery.

## DNS provider identified

A public DNS lookup on **15 November 2026** returned
`ns23.domaincontrol.com` and `ns24.domaincontrol.com`, pointing to GoDaddy DNS.
The root domain's five MX records point to Google's mail servers. No MX answer
was returned for `replies.tryjalla.com` at that earlier check. The receiving MX is
now present and verified as recorded above.

Open GoDaddy's Domain Portfolio, select `tryjalla.com`, then **DNS**. If the domain
uses GoDaddy DNS hosting without being registered there, look under **DNS Hosting**.
The nameserver lookup identifies the DNS service, not which team member owns its
login. Keep the existing nameservers, website records and Google root MX records.

For manual Resend setup:

1. Add `tryjalla.com` in Resend Domains with sending enabled and receiving disabled.
2. Add its generated sending records to GoDaddy. Copy each record's type, content
   and any MX priority exactly from Resend. In GoDaddy's Name field, omit the final
   `.tryjalla.com`; use the host prefix shown by Resend. This root domain's issued
   records are TXT `resend._domainkey`, CNAME `rsend` and CNAME `send`. Other domains
   can use a different format; do not substitute generic MX/SPF examples or add a
   second root SPF policy.
3. Add `replies.tryjalla.com` in Resend with receiving enabled and sending disabled.
   Add its generated DKIM record and receiving MX record to GoDaddy. The receiving
   MX Name is `replies`; use the exact target and priority issued by Resend.
4. Request verification in Resend and wait for the corresponding records to verify.
   Keep the already verified `mail.tryjalla.com` sending configuration.
5. Complete the webhook and private Admin reply/staff settings below, then test
   actual delivery and replies with the controlled accounts.

The domains must be added in Resend before their exact DNS values can be copied.
No values are invented from documentation examples. Provider instructions:
[GoDaddy DNS setup](https://resend.com/docs/guides/dns/godaddy) and
[custom receiving domains](https://resend.com/docs/dashboard/receiving/custom-domains).

## Provider configuration

The configured provider setup is:

| Service | Action | Configuration |
| --- | --- | --- |
| Resend | Verified sending domain | `tryjalla.com`, sending enabled, receiving disabled; supports `contact@tryjalla.com` and `partner@tryjalla.com`. |
| Resend | Verified receiving subdomain | `replies.tryjalla.com`, receiving enabled, sending disabled. |
| Resend | Enabled webhook | `https://www.tryjalla.com/api/events?action=email-receipt`, subscribed to `email.received`, `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.failed`, `email.opened` and `email.clicked`. |
| Supabase | Saved webhook signing secret | `app_config.resend_webhook_secret`, stored privately and verified against Resend's value. |

The webhook/settings writes did not change DNS or enable Groundwork reminders.
Existing Google MX records for `tryjalla.com` remain; Resend receives replies on
the dedicated subdomain. Never paste service keys or the signing secret into chat.

The reply domain and selected follow-up sender are now saved. Configure the two
supplied real test recipients and a staff owner in Admin communications, then
verify actual email delivery and incoming replies on the deployed application.
Retire the identified GHL activation workflows and remove pending enrollments
before enabling the selected Groundwork test journeys. Keep unrelated partner,
sales, waitlist and billing workflows active.

The Admin email setup check reads saved settings and provider configuration. It
does not substitute for an actual delivered email, a verified signed event, an
incoming reply, staff follow-up and confirmation that GHL duplicates have stopped.

## GHL inventory supplied by the user

This classifies the supplied Home list for the activation migration. Workflow
contents have not been inspected through the API; the saved token is rejected.

| Workflow | Action for this migration |
| --- | --- |
| Ai Scaling Partner - Advisory Application | Leave unchanged; separate advisory application workflow. |
| Build Assessment Lead Capture Workflow | Leave unchanged; lead capture. |
| Construction Cost Guide By Country - Form | Leave unchanged; guide/form acquisition. |
| Contractor Application | Leave unchanged; partner application processing is separate from contractor account activation. |
| Founding Member Exit Popup Form | Leave unchanged; popup/form acquisition. |
| Groundwork Lifecycle Events | Inspect its event branches and retire the activation reminders only. |
| Jalla Campaign - Immigration and Travel Agents | Leave unchanged; separate campaign. |

The supplied lifecycle row is Published, with 20 total and 0 active enrolments.
No active enrolments are shown to remove; retain historical records. This is an
inventory snapshot, not confirmation that the workflow has been retired.

The legacy setup in `GHL-SETUP.md` routes `user_signup`, `project_created`,
`application_decision` and `subscription_changed` through the same inbound
webhook. The current forwarder still preserves application and subscription
routing, while Groundwork owns signup, onboarding, project and invitation nudges.
Consequently, the workflow name alone is insufficient to retire the whole graph.

Open **Groundwork Lifecycle Events** and inspect its trigger and If/Else event
branches. If it contains only activation messages, set it to Draft and save. If
it also handles `application_decision` or `subscription_changed`, retain those
paths and retire only the activation message/wait branches. Inspection and
retirement are deferred until the user resumes launch configuration.

Provider references:

- [Resend custom receiving domains](https://resend.com/docs/dashboard/receiving/custom-domains)
- [Resend webhook setup](https://resend.com/docs/webhooks/introduction)
