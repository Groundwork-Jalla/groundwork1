# Weekly readiness — November 16–20, 2026

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
| Communication framework | Four journeys, per-step Day 1/3/7 scheduling, preferences, reply handling, staff follow-up, ownership/cadence controls and tracking. | Complete Resend sending/receiving, signed callbacks, real replies, staff configuration and controlled delivery. Verify GHL overlap is retired. |
| Direct Meta WhatsApp | Independent scheduling, consent/STOP, signed callbacks, delivery ledger, Admin conversations and template checks. | Replacement token approval by another Meta team member, connection check, real signed inbound event, controlled replies/delivery and approved reminder templates. |
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
3. Complete Resend root-domain sending verification, dedicated receiving DNS,
   canonical signed webhook, reply routing and staff sender/owner/cadence settings.
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
