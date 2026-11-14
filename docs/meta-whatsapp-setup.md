# Direct Meta WhatsApp setup

The user selected direct Meta integration on 14 November 2026 and requested help
creating the Meta connection. Groundwork Admin continues to own scheduling,
tracking, replies and human follow-up. The user confirmed that the preceding
application release and payment/currency migrations are deployed.

A scoped read-only check found no configured Meta phone-number ID, token or
template in the existing server environment or `app_config`. WhatsApp automation
is off. No external messages or provider configuration changes were made.

## Account-owner setup

1. In [Meta Apps](https://developers.facebook.com/apps), create **Groundwork by Jalla**
   with **Connect with customers through WhatsApp** and the company portfolio.
2. Open **Quickstart → Start using the API → API Setup** and connect the company's
   WhatsApp Business/Messaging account.
3. Select Meta's test number, add and verify a team-controlled recipient, send the
   dashboard test message and reply from that phone.
4. Keep the phone-number/account IDs and token privately. Production requires a
   system-user token and assigned app/WhatsApp assets rather than the temporary
   test token.

These steps follow [Meta's current Cloud API Get Started guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started/).
The business account owner completes login, any requested business verification
and phone verification inside Meta.

## Groundwork connection work following account setup

The current transport has an existing Meta sender, but the complete lifecycle
WhatsApp framework is not established by adding its token:

- Approved reminder templates must carry the correct action, recipient language
  and project link. The existing generic template fallback does not preserve that
  full content.
- The lifecycle worker currently composes an email payload before its WhatsApp
  branch and passes no GHL contact ID to its fallback. Direct Meta delivery needs
  independent, frozen recipient/template snapshots and delivery tracking.
- Email and WhatsApp reminders need coordinated Day 1/3/7 timing without moving
  the other channel's position, duplicating reminders or repeating completed
  actions.
- Incoming Meta messages and delivery/read/failure events need a verified webhook,
  deduplication, correct business-number matching and saved Admin conversations.
- A verified reply must pause the relevant automation and surface human follow-up.
  Staff replies, contact history, STOP/opt-out and user WhatsApp preferences must
  be connected to the same framework.
- Meta send timeouts need reconciliation before retrying; email-provider
  idempotency guarantees must not be assumed for a Meta message request.
- Start with controlled recipients, prove the complete send/reply cycle, then
  enable selected journeys and expand the audience through the Admin controls.

Meta requires recipient opt-in and approved templates for business-initiated
messages. Non-template responses are permitted during the 24-hour customer-service
window. These are concrete integration requirements from
[WhatsApp's messaging policy](https://business.whatsapp.com/policy), not a reason to
enable the existing paused branch prematurely.

No direct Meta webhook, approved reminder templates, live lifecycle send or
end-to-end WhatsApp acceptance is claimed by this setup checklist.
