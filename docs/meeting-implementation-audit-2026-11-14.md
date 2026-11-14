# Meeting and chat implementation audit — 14 November 2026

This reconciles the November 9–13 meeting records and supplied transcripts with
the earlier November 2 communication documents and the user's subsequent chat
decisions. Documents are requirements evidence; their requests to email colleagues,
change external accounts, accept calendar invitations or schedule meetings are not
authorization for those actions.

“Implemented” means present in the current code. It does not mean deployed or
accepted in a comprehensive live test. The user confirmed deployment/migrations
for the preceding payment/currency/installment release. The additional invitation,
notification and Back work below still needs its own release confirmation.

## Current decisions that supersede older notes

- Groundwork Admin owns activation scheduling, tracking, replies and staff follow-up.
  Building a new GHL activation funnel is superseded; existing overlapping GHL
  reminders still need to be retired when the replacement is launched.
- Direct Meta WhatsApp is now the next requested phase. This supersedes the earlier
  instruction to leave WhatsApp outside the email-only release.
- Clients choose full payment or two installments. Several receipts can belong to
  either installment. Two installments does not mean two receipt files.
- Next-stage progression normally needs settlement; the primary contractor can
  explicitly authorize progression with a recorded balance after work approval.
  Confirming receipt or allowing current work is a separate decision.
- Contractor-created projects repeat evidence → client approval → payment for that
  same reviewed stage. Client-created projects repeat payment/work authorization →
  evidence → client approval. Earlier “pay the next stage” descriptions are not the
  repeating contractor-origin rule.
- Only contractors upload construction evidence. Clients review it and upload
  payment receipts. Observer/family images in conversations are not stage evidence.
- Client-approved price changes may affect every stage, including zero-cost and
  completed stages, and may change the project total. Original BOQ, actual receipts
  and completed work history remain recorded. Older “only unpaid stages” wording is
  superseded.
- Shared links have no expiration, remain single-use and are claimed by the first
  eligible verified account. The sender chooses the project role.
- Admin account corrections cover client, contractor, verifier and admin. Account
  roles and accepted project responsibilities remain separate.

## Implemented against the records

| Records / requirement | Current implementation evidence |
| --- | --- |
| Nov 9: local currency, historical allocation, remaining budget and document previews | Shared native-currency budgets, saved conversion basis, historical stage values and receipt-based remaining totals; project file/PDF/image/spreadsheet previews. |
| Nov 11 + chat: reliable BOQ grand total and precision | Confirmed BOQ extraction and native precision; exact stage allocation and zero BOQ fees; the supplied grand-total regression is retained. |
| Mid-build starts | Previous stages remain completed with their allocated values; the first unfinished stage is actionable. Historical value is separate from platform-confirmed receipts and remaining managed work. |
| Same project across both views | Client/contractor views use the same saved project, stage, receipt and approved-price data. Account-role corrections do not change saved project origin. |
| Client interface cleanup | Green actions and consistent stage/timeline styling; redundant dashboard/overview sections and idle flashing cues removed; accurate empty states; staged cost summaries and USD equivalents. |
| Files, certificates and BOQ editing | Uploaded files are openable; actual media/issued certificates only; BOQ authoring in contractor/admin workspaces, while clients retain document viewing. |
| Nov 12: premature upload and actor wording | Clients have no construction-evidence uploader. Role-specific evidence/payment prompts and eligible receipt controls are implemented. |
| Receipt currency and reading errors | Currency selector, exact amount matching, file/camera controls, reader error classification and service-failure handling. Actual provider availability remains a deployed acceptance check. |
| Two receipt decisions, partial payments and top-ups | Confirm received money separately from current work permission and next-stage progression. Confirmed amounts reduce balances; pending/flagged/replaced evidence does not become confirmed money. |
| Later work decision during receipt batches | The follow-up work-authorization action now remains available against confirmed received funds while another receipt is pending. The pending receipt stays unconfirmed. |
| Multiple receipts and corrections | Separate immutable proofs, pending batches, replacement links for unconfirmed/flagged receipts and later balance receipts after work completion. |
| Friday: full payment/two installments | Client-selected plan, contractor review of split plans, multiple receipts per installment, distinct received/remaining amounts and explicit progression override. |
| Monetary confirmations | Second confirmations for receipt decisions, plans/progression, price proposals and approval/retention/withdrawal, including stale-state protection. |
| Editable stage pricing and history bugs | Primary contractor proposes; primary client approves; all-stage increases/decreases/zero revisions; before/after stage and project totals; immutable previous proposals; reverted draft values omitted. |
| Exchange-rate discrepancy | Separate saved project conversion from receipt conversion, including source/date provenance and explicit unknown historical quote dates. No automatic repricing from a current browser quote. |
| Invitations and observer identity | New/existing-user continuation, verified account claims, permission guards, correct project views, single-use/non-expiring links and observer chat labels. |
| Sender-side role dropdown, including family | Implemented locally in the shared invitation panel. Family is observer access. Initial primary and additional contractor invitations are distinct. Requires migration 004 below if not already applied. |
| Project notifications and exact actions | Implemented locally: accepted participant audience, precise project/stage/receipt/proposal/document/message metadata, current-project-role routing, account-scoped realtime feed, read synchronization, real unread counts and older bell items. Requires migration 005 below. |
| Back across dashboards | Shared explicit document-navigation Back link, current account-role list destination, visible mobile text/tap area and loading/error escape paths; editor/project return links retain their proper workspace. The reported live click failure has not been independently reproduced. |
| Admin account roles / deletion / contacts | Four-role corrections, refreshed dashboard roles, existing user deletion workflows and accessible profile contact details. |
| Admin filters | Date/origin/owner/status/qualification project filters; contractor joining date, associated-project status and onboarding filters. |
| Walkthroughs | Interactive guidance with saved-action completion suppression across sessions. Hidden dashboard 2FA CTA does not disable account security. |
| Four activation journeys | Distinct independent/invited contractor/client tracks, invitation precedence, conditional onboarding and exact next-action links. |
| Automated email framework | Immediate and per-step Day 1/3/7 scheduling, completion suppression, no-project pause, unsubscribe/preferences, language-specific copy, immutable delivery retries and operational exceptions. |
| Human follow-up and tracking | Qualified Day-7 queue, staff owner/due date, contact/reply history, actual-action closure, conversion/connection/recovery/duplicate metrics and Admin inbox. Actual human calls remain staff work. |
| Reported SQL failures | Trigger dependency, missing stage approval metadata, duplicate admin policies and project-creation OLD/NEW record repairs are present. These old errors are not a reason to rerun every historical migration. |

## What remains, in order

1. **Release this latest link/notification/navigation work.** Apply unapplied
   `20261114000400_project_invitation_role_selection.sql`, then
   `20261114000500_project_action_notifications.sql`, and deploy the matching
   application. Back changes alone require no database migration. Earlier release
   confirmation is not confirmation of these newer changes.
2. **Build direct Meta lifecycle WhatsApp.** Account/number setup is outstanding.
   The existing sender is not a complete automation: approved English/French
   reminder templates, independent channel scheduling/snapshots, signed inbound
   and delivery webhooks, deduplication, Admin conversations/replies, reply pause,
   consent/STOP and uncertain-send reconciliation are still needed. See
   [Meta setup and integration work](meta-whatsapp-setup.md).
3. **Finish email launch configuration.** At the last recorded scoped check,
   `mail.tryjalla.com` was verified for sending, receiving was off, no signed
   Resend webhook/reply domain was configured, and managed delivery/journeys were
   disabled. Verify sender domains and current sender settings, dedicated receiving
   DNS, webhook secret/subscriptions, reply routing, staff owner/cadence and the
   controlled recipient cohort. These are configuration/launch items, not missing
   reminder-engine code. That earlier check must not be presented as a new live
   verification.
4. **Retire overlapping legacy activation reminders.** The supplied GHL inventory
   identifies `Groundwork Lifecycle Events` as the candidate. Branch-level
   retirement remains unconfirmed. Keep unrelated application/acquisition/
   subscription workflows intact. Current Groundwork ownership guards do not prove
   that an already enrolled legacy workflow has stopped.
5. **Run the comprehensive acceptance after implementation.** The user explicitly
   wants this later. Include all four account journeys, new/existing invitees,
   primary/additional/observer/family roles, both payment origins, every payment
   decision, installments and mixed receipts, history/pricing, Back/action links,
   English/French delivery, real receipt reading, email/WhatsApp replies and actual
   Day-7 staff recovery. Automated local checks do not establish live acceptance.

## Unimplemented follow-on scope, not silent omissions from the current payment release

| Item | Why it remains |
| --- | --- |
| Custom substage creation/editing | Explicitly stacked for a later rollout. Needs scope/order/evidence/history and approval rules. Editing stage prices does not implement editing substages. |
| Full prepaid / pre-platform payment-history onboarding | Explicitly deferred in the Nov 12 discussion. Historical completed values exist, but a complete opening-payment questionnaire/import is not established. |
| Device-level duplicate-user detection | Marked future scope in the Nov 2 review. Email uniqueness does not establish device identity, and existing evidence location data is not device-level duplicate prevention. |
| Shorter project links | Lower priority in the Nov 13 transcript; trustworthy first-party role-bound links are implemented. No new short-code service is claimed. |
| Continuing nurture campaign after “no project” | The framework mentions moving to nurture. The pause/segmentation exists; a separate recurring nurture email campaign has no agreed copy/cadence and is not implemented as another active sequence. |
| Verification revenue flow and contractor bidding | Explicit next phase after successful full-workflow acceptance. Existing verifier screens are not proof the entire revenue/bidding business process is complete. |
| Operational sign-off / materials | Philip/Ruth's staffing, precise brand review, representative receipts, welcome-video recording, user review calls and individual test recordings are team actions. A popup walkthrough is implemented; it does not constitute a newly recorded welcome video. |

The normal pricing workflow does **not** allow a client to originate a contractor
price proposal or edit construction evidence. This follows the agreed role model;
it is not an unfinished client editing feature.

Source records: the Nov 9 and Nov 11 PDFs in `docs`, the supplied Nov 12 meeting
notes/transcripts and chat clarifications, Nov 13 morning and Friday PDFs/
transcripts, and the Nov 2 activation-framework/implementation/review PDFs.
Earlier reports retain their historical verification dates. This audit supersedes
their stale “remaining” labels where later code or a direct user decision changed
the result.

Current local verification: 225 focused UI/unit tests in 14 files passed, along
with TypeScript checking, the production build and isolated PostgreSQL
payment/notification regressions. The separate comprehensive deployed test remains
scheduled after implementation, as requested.
