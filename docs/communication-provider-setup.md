# Communication provider setup

The user has deferred provider setup and GHL retirement to focus on building the
lifecycle communication flow. The plan below is retained for later activation;
no further GHL branch details are required for the current implementation work.

Read-only checks on 13 November 2026 confirm the replacement Resend key can read
domains, webhooks and receiving permissions. The account currently has only
`mail.tryjalla.com`, verified for sending. No webhooks are registered.

The proposed configuration writes are:

| Service | Action | Configuration |
| --- | --- | --- |
| Resend | Add sending domain | `tryjalla.com`, sending enabled, receiving disabled; supports `contact@tryjalla.com` and `partner@tryjalla.com`. |
| Resend | Add receiving subdomain | `replies.tryjalla.com`, receiving enabled, sending disabled. |
| Resend | Add enabled webhook | `https://www.tryjalla.com/api/events?action=email-receipt`, subscribed to `email.received`, `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.failed`, `email.opened` and `email.clicked`. |
| Supabase | Store generated webhook signing secret | `app_config.resend_webhook_secret`, privately from Resend's create response. |

These writes do not change DNS or enable Groundwork reminders. The exact DNS
records returned by Resend will be supplied for the domain owner to add. Existing
Google MX records for `tryjalla.com` must remain; Resend receives replies on the
dedicated subdomain. Never paste service keys or the signing secret into chat.

After DNS verification, save `replies.tryjalla.com` in Admin communications,
configure the two supplied real test recipients and a staff owner, and redeploy
the reviewed code so Production uses the replacement Resend environment key.
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
