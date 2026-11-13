# Communication provider setup

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

Provider references:

- [Resend custom receiving domains](https://resend.com/docs/dashboard/receiving/custom-domains)
- [Resend webhook setup](https://resend.com/docs/webhooks/introduction)
