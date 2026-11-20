# Weekly readiness — November 16–20, 2026

> **Progress Update (20 Nov 2026):** Since this 15 Nov snapshot, the following code has shipped locally/on `main` (`20261116000000`–`20261120000100`): contractor-before-payment gate, two-installment retirement + substage breakdowns/payments, automatic overpayment carryover + admin overpayment alerts, contractor-recorded offline payments & Homeowner disputes, Partner Activation 100% flow, city & currency wizard steps, Admin Finance per-project split, grouped Recent Activity, Direct Resend Day-0 Welcome & Project Activation emails (GHL-independent) + `/admin/sequences` fixes, and the full EN/FR Project Screen Wording Review cleanup. **Still pending:** applying Nov 15–20 migrations in Production, GHL workflow retirement & PIT rotation, Meta WhatsApp template approval & billing review, and running live acceptance (`weekly-acceptance-2026-11-16.csv` W01–W20).

Prepared on **15 November 2026**, using the supplied weekly memo, the implementation
records and scoped read-only provider/schema checks. This records readiness and
work to perform; it does not claim real-user activation or live acceptance.

## Targets and ownership

| Owner | Weekly target |
| --- | --- |
| Vanessa | 25 outreach contacts |
| Periscal | 25 outreach contacts |
| Favour, with Ruth testing | 10 real projects activated without human intervention |
| Ruth | 2 verified projects |

The memo reports 42 signups and 8 activated projects for the preceding week. Those
figures were supplied by the team and were not recounted through privileged data.
Test accounts and controlled test projects must be excluded from the real-user targets.

## Current implementation and acceptance status

| Area | Implemented / locally checked | Release or live work remaining |
| --- | --- | --- |
| BOQ, saved totals and stages | Grand-total selection, native precision, fee-free BOQ allocation, zero-weight stages, mid-build history and shared financial values. | Upload the real supplied BOQ and compare total/stages in both participant views. |
| Signup and account correction | Four account roles, live role refresh, role email queue, repair of unambiguous owned projects and five-step completion for existing project members. | Confirm the matching application release, actual email delivery and converted-account behavior live. Conflicting contractor assignments require review. |
| Project links and permissions | Role selection, new/existing account continuation, first verified claimant, single use, no expiration and observer/family restrictions. | Confirm migration 004 and the matching UI through controlled live joins. |
| Project notifications and Back | Participant events, exact action targets, current-role routing and shared document-navigation Back links. | Confirm migration 005's triggers and test actual mobile/desktop clicks across all dashboards. A responding app shell does not prove the original Back problem is resolved. |
| Payments and receipt reading | Both project origins, currency input, file/camera controls, receipt decisions, full/two-installment plans, multiple proofs, balances and progression authorization. | Controlled live acceptance with actual receipts, including a non-receipt image and provider failures. |
| Stage pricing | Contractor proposal, client approval, all-stage revisions and preserved payment/proposal history. | Live before/after comparisons in client and contractor views, including paid/completed/zero-cost stages. |
| Communication framework | Four journeys, per-step Day 1/3/7 scheduling, preferences, reply handling, staff follow-up, ownership/cadence controls and tracking. Sending/receiving domains, webhook and saved reply settings are configured; deployed signature checks pass with synthetic events. | Configure controlled recipients and staff owner; test actual delivery, provider callbacks, replies and staff follow-up. Verify GHL overlap is retired. |
| Direct Meta WhatsApp | Independent scheduling, consent/STOP, signed callbacks, delivery ledger and Admin conversations. Production account/phone access and callback challenge pass; the app subscription is acknowledged and all 86 reminder variants are submitted. | Deploy matching fixes; wait for template approval (86 pending at final read), refresh the Admin cache, review funding and complete controlled consent/inbound/reply/delivery tests. Sending remains off. |
| Project files and walkthroughs | Openable file previews, actual issued/uploaded material and completion-aware guidance. | Review representative production documents and check that completed actions suppress the corresponding guides. Record any specific failures. |
| Verified-project reporting | New correction described below, exercised against real PostgreSQL. | Apply the new reporting migration and deploy the matching app, then compare live classifications with actual primary memberships. |

## Fresh read-only findings

Checks ran at **14:22 Malaysia time on 15 November** (06:22 UTC). No configuration
was changed, no account/project was created, and no message was sent.
The sanitized [check record](weekly-readiness-checks-2026-11-15.json) retains the
response codes and the scope of what was established.

- Supabase recognizes the role-notification queue and existing-project onboarding
  RPC, with anonymous requests denied. The notification event identity and stage
  payment-plan schema are also present. These probes establish schema availability,
  not an authenticated walkthrough or proof of every installed function version.
- The public communications/Admin routes respond with authentication requirements.
  The WhatsApp callback rejects an unverified request. Those are boundary checks;
  a valid signed inbound message still needs to be demonstrated.
- The accessible Resend account lists only `mail.tryjalla.com`, verified for sending.
  Receiving is disabled. No Groundwork webhook is registered in its complete list.
  `tryjalla.com` sending verification is needed for the agreed root-domain follow-up
  and partner senders; a dedicated receiving subdomain is still needed.
- Current private Production staff settings and sender/reply configuration were not
  read with an Admin session. Local environment-variable absence is not evidence
  that Vercel Production lacks those settings.
- The last shared WhatsApp screen rejected the token, and the owner reports that
  generating the replacement awaits another Meta team member's approval.
- GHL retirement remains unconfirmed. The historical supplied inventory names
  **Groundwork Lifecycle Events**; unrelated application/acquisition/subscription
  workflows must retain their intended behavior.

Email setup instructions and the proposed exact endpoints are in
[communication-provider-setup.md](communication-provider-setup.md). Keep existing
Google MX records for `tryjalla.com`; receiving belongs on `replies.tryjalla.com`.

### Email setup follow-up — 16 November, 00:03 Malaysia time

After the owner completed GoDaddy setup, read-only Resend and public DNS checks
confirmed verified sending for `tryjalla.com` and `mail.tryjalla.com`, verified
receiving for `replies.tryjalla.com` (MX priority 10), and unchanged Google root MX
records. DNS setup is complete. The complete webhook list still contains no
Groundwork endpoint. Selected Supabase settings show no reply domain, no database
webhook signing secret, `support@tryjalla.com` instead of the selected follow-up
sender `contact@tryjalla.com`, zero controlled recipients and no default staff owner.
Delivery remains paused. The Vercel secret fallback was not inspected. These are
configuration checks; no email, reply, signed callback or staff workflow was tested.

After explicit owner approval, the Groundwork webhook was created at **00:07
Malaysia time** with all eight required event subscriptions. Its signing secret
was stored privately in Supabase and verified against the provider value. The reply
domain is now `replies.tryjalla.com` and the follow-up sender is `contact@tryjalla.com`.
Delivery remains paused. At **00:08**, synthetic callback checks against the deployed
endpoint returned 400 for an unsigned request, 401 for an invalid signature and
200/ignored for a valid signature. These unhandled test events contained no email
or business-event IDs and sent no emails. Incoming-email read permission was also
confirmed without reading actual mail. The
[sanitized setup record](communication-provider-checks-2026-11-16.json) captures
the result. Controlled recipients, staff ownership, actual provider events and
end-to-end email/reply testing remain.

### WhatsApp follow-up — 16 November, 00:12–00:15 Malaysia time

The owner saved an access token. Read-only checks of the phone, account templates,
permissions and token debugger all returned **“API access blocked”**, code **200**,
subcode **5258005** (HTTP 400). Token validity and actual scopes could not be
established. The saved account and phone IDs were not changed. Sending remains off
with a test-only audience, and both callback markers and the template check are
pending. Meta Required actions, pending admin reviews and any displayed business
restrictions need inspection before another provider check. The application now
has specific English/French guidance for this block and ordinary permission errors;
that wording change remains local until deployment. No WhatsApp messages were sent.
See [the setup guide](meta-whatsapp-setup.md) and
[sanitized diagnostic record](meta-whatsapp-checks-2026-11-16.json).

At **01:10–01:16 Malaysia time**, after the owner reported publishing the app,
the earlier block was no longer returned. The saved system-user token is valid
for Groundwork's app and has all four recorded scopes; the production phone reads
successfully. The saved Messaging account ID still rejects template/phone-list
reads with **100 / 33**. The token's system user is `122141001993236907`, and its
scoped assigned-account list is empty. Only the test account is visible in the
owned list; its templates are readable. Meta's phone callback configuration already
matches Groundwork. Production account access/ID validation is the next action,
followed by callback and actual-message testing. Sending remains off; these checks
made no configuration changes and sent no messages.

At **01:57**, the saved token successfully read both the production template catalog
and the account's phone list after the owner added the missing account access. The
configured account/phone pair is now established, with no replacement token needed
for those reads. The catalog contains four approved templates and no Groundwork
reminder definitions. Local fixes shorten the two original long English button labels
and ignore six exact seed drafts for WhatsApp; saved email copy and rows remain intact.
There are now 86 valid English/French reminder variants, with zero exact approvals,
in the [review pack](whatsapp/2026-11-16-template-review/README.md). They have not
been submitted. All 16 lifecycle sequences and WhatsApp sending remain off.
Callback timestamps remain pending. The subscription-list GET timed out, leaving
that check unknown; the funding-field read returned code 10. The owner's screenshot
shows a LeadConnector credit line, which needs review before paid delivery. Local
validation passed 124 focused tests, type checking and the production build.

At **06:04–06:15 Malaysia time**, after explicit owner approval, Meta acknowledged
the app subscription and completed the real callback challenge. All **86 Groundwork
variants** were then created and read back against the exact runtime definitions:
**86 PENDING, zero APPROVED, zero REJECTED**. Meta assigned 62 UTILITY and 24
MARKETING variants. Six terminal-variable bodies needed a fixed closing sentence;
the shared compiler and [correction record](whatsapp/2026-11-16-template-review/format-corrections.json)
keep runtime/export copy aligned. French translations reuse Meta’s category for
their existing name. See the [submission receipt](whatsapp/2026-11-16-template-review/submission-receipt.json).
Sending remains off, the audience stays test-only, all 16 sequences are disabled
and no linked contacts or real signed incoming events have been observed. These
provider operations sent no messages and changed no billing. Deploy the staged
WhatsApp application fixes, wait for approval, refresh the live Admin check, then
complete controlled consent/inbound/reply/delivery testing. Latest local validation:
126 focused tests across eight files, type checking and production build passed.

## Reporting correction and confirmed definition

Migration 182 already required qualification. Its remaining issue is that an accepted
viewer could satisfy `client_joined`, and it did not require an accepted contractor.
That could count an observer/family member as the financing client. It could also
miss a client who created their own project and never received a viewer invitation.

The owner confirmed on **15 November** that **primary client joining is enough**.
An additional client approval, payment receipt or message is not required.

The new definition preserves the existing BOQ/start-date qualification and ground
update requirements, and requires an accepted primary contractor plus a joined
primary client. Pending/revoked invitations, observers and a contractor acting as
their own client do not satisfy it. Self-created client projects recognize their
owner. Provisioned clients can establish their join by simply opening the project.

The bulk view and individual function now share one definition with caller RLS.
The client visit recorder is authenticated, primary-client-only and idempotent.
It does not approve work, confirm money, send messages or change project finances.
Today's evidence uploader already writes `site_updates`, so the existing ground
update signal remains compatible with the current workflow.

Release the matching application with:

`supabase/migrations/20261115000300_verified_project_participants.sql`

Apply only unapplied prerequisites. The database probes already recognize the
November 15 role/onboarding objects; do not rerun unrelated historical migrations.
Exact migration 004/005 behavior still belongs in the authenticated live review.

## Remaining work, in execution order

1. Confirm the deployment and applied migration inventory. Release the reporting
   correction and any still-unreleased invitation/notification/role fixes together.
2. Smoke-test the critical self-service path on the deployed app: signup, required
   contractor forms, BOQ/project creation, correct existing-project access, invitations
   and Back. Fix any failure before treating a demo as ready.
3. With DNS, webhook authentication and reply/sender settings configured, set the
   controlled recipients and staff owner, and confirm the follow-up cadence.
   Test actual arrival, authenticated reply and staff follow-up using controlled inboxes.
4. Complete Meta token approval, connection/webhook proof, controlled messaging and
   template approvals. Keep the test-recipient audience through acceptance.
5. Inspect and retire overlapping GHL activation branches/enrollments. Confirm that
   completing an action or switching channels does not produce duplicate reminders.
6. Run the full matrix in [weekly-acceptance-2026-11-16.csv](weekly-acceptance-2026-11-16.csv).
   Save the project IDs, deployment, observed result and evidence for each case.
7. Track real-user activation and client joins throughout the week. Record staff-created
   projects, support calls and hands-on help so the self-service target can be substantiated.

## Measuring ten self-service projects

The recorded product definition is a real project brought onto Groundwork. The
software records creator, creation/tracking timestamps, onboarding and funnel
milestones, duplicate flags and logged staff follow-up. It cannot infer every
off-platform support call or whether an unflagged test entry is a real build.

Use a project-level tracker with real/test classification, project ID, activation
time, creator, onboarding result and recorded assistance. Count one real project
once; exclude controlled tests, duplicates and staff-assisted setup from the
ten-project target. Keep clients joining and verified status as separate measures.
No automatic ten-project success claim is made from a status field alone.

## Follow-on scope already deferred

Custom substage editing, full opening-payment-history import, device-level duplicate
identity detection, shorter links, a separate continuing nurture campaign, verification
revenue/bidding work and recorded welcome videos remain follow-on/team work. They
were not silently included in the locally completed payment release. Reprioritize
them explicitly if a real user or demo is blocked.

## Validation

The current reporting change passed 112 focused tests in 7 files, the isolated
PostgreSQL role/reporting suite, TypeScript checking and the production build.
The database cases cover qualification, primary
memberships, pending/revoked/observer cases, provisioned joins, preserved money,
view/function agreement, row security, replay and concurrent join deduplication.
Production acceptance and actual provider delivery remain open until exercised.
