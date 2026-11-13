# November 13 morning product review — reconciliation

Reviewed on November 14. The tables below preserve the pre-fix audit and the
meeting's requirements. The user subsequently authorized implementation,
including client-approved changes to **every stage, including zero-cost stages**.

## Implementation update — November 14

The repeating contractor-origin workflow, separate receipt/progression decisions,
second monetary confirmations, multiple/corrected receipts, all-stage approved
amendments, role-specific wording, exact-stage notifications and completion-based
walkthrough suppression are now implemented locally. Confirmed receipts, original
BOQs, completed work and earlier proposal snapshots remain recorded. Client-origin
projects remain payment-first.

Regression checks confirm approved proposal A survives declining proposal B, and
edits reverted before submission are omitted. The contractor list's existing
current-stage null fix is covered by its regression test. Project Back now uses an
explicit workspace list link, and asynchronous project refresh callbacks safely
handle leaving the screen. The original live Back exception was not captured in
this environment; it is not claimed as independently reproduced here.

See [the rollout and acceptance notes](payment-review-2026-11-14.md) and
[the additive migration](../supabase/migrations/20261114000000_project_payment_review.sql).
Production migration/deployment and controlled browser acceptance remain rollout
steps. No external account settings or real user budgets were changed in this work.

## Sources and interpretation

- `_Morning Product Working Session - 2026_11_13 14_04 WAT - Notes by Gemini.pdf`
  and the supplied email/meeting-note pastes describe the same review.
- The Google transcript starts at 00:13:58. The second recording's transcript
  starts at 0:00, so corresponding timestamps differ by roughly fourteen minutes.
  The payment, price and invitation decisions were cross-checked against the
  direct conversation, rather than treating the generated action list as exact.
- The notes are evidence of the discussion. They do not authorize sending
  messages, accepting calendar invitations or changing external accounts.
- The user's newer explicit decision keeps **WhatsApp outside this release**.
  Earlier direct decisions about non-expiring single-use links, contractor-only
  evidence uploads, client approval of project-total changes and purpose-specific
  sending addresses remain relevant when reconciling the notes.

The generated summary contains a material error: it calls payment before updates
on a client-created project the bug. At **00:54:49** and **01:43:09–01:44:27**,
the participants explicitly retain client-created payment-first and
contractor-created updates-first workflows. The observed bug is the
contractor-created project requesting the following stage's payment before its
updates. Recording 2 confirms the same distinction at approximately 40:51.

## Correct payment behavior

| Project origin | Repeating stage cycle |
| --- | --- |
| Client-created | Client pays and submits proof → contractor confirms receipt and whether work may proceed → contractor provides stage updates → client approves updates → next stage's funding step |
| Contractor-created | Contractor provides stage updates → client approves → client pays that reviewed stage and submits proof → contractor confirms receipt and whether progression may proceed → next stage's updates |

The contractor-created cycle must continue through later live stages. The current
code only exempts the **first** non-historical stage from payment-first gating:
[frontend progression](../src/lib/projects/stage-progression.ts) and
[database predicate](../supabase/migrations/20261112000500_review_payment_workflow.sql).
This reproduces the logical cause of the stage-four-to-five issue in the review.
The reviewed-stage settlement migration also explicitly targets the first live
stage, so a frontend-only change would leave the database rejecting later work.

### The two decisions

At **01:17:47–01:26:56** and **01:38:48–01:43:09**, Philip separates:

1. **Was the reported money actually received?** The contractor confirms that,
   or reports non-receipt. Reading a receipt is not proof that the contractor's
   account received the money.
2. **May work progress with the amount received?** Groundwork calculates coverage
   against the stage allocation. If the amount differs, the contractor can accept
   it for progression or request a stated additional amount and keep progression
   blocked. The client must see the decision and the next action.

These are separate from the document check: the client's typed amount and chosen
currency must match the receipt itself. A legitimate partial receipt must not be
rejected merely because it differs from the stage allocation.

Permission to proceed with a partial payment must not erase the outstanding
balance or label the stage fully paid. Received, pending, disputed and outstanding
amounts need distinct statuses. All monetary comparisons must use the same
currency and recorded conversion basis.

Historical stages retain their recorded work/payment history. Zero-cost stages
need no invented receipt. A final stage has no successor to unlock. A paused
project must not resume through a receipt alone. Mid-build projects start the
applicable cycle at their first live stage.

## Payment actions and status

| Item from the review | Current evidence | Remaining work |
| --- | --- | --- |
| Receipt-check failure (00:21:24) | A later incident was traced to the reservation constraint rejecting rows before extraction. `20261113001300_receipt_reading_reservation.sql` repairs it and the local database regression covers bare reservations. | Verify the deployed schema/API and retry an actual authenticated upload. The recording later shows successful checks, so the initial error does not establish a continuing provider failure. |
| Wrong document, amount and currency rejection (00:55:54, 01:04:59) | Implemented in the reader/API; the recording also demonstrates rejection. | Retain distinct errors and retries while changing the flow. |
| Evidence-first across contractor-origin projects (00:42:31, 00:54:49) | First-live-stage support exists; later stages return to funding-first. | Extend the database and UI cycle to later stages, including stage approval and receipt settlement. |
| Separate funds receipt from permission to progress (01:17:47, 01:38:48) | `accept`, `needs_top_up` and `flag` actions exist. Accept currently executes directly. | Present the two decisions explicitly and add a final confirmation showing the amount, currency, balance and progression consequence. |
| Partial-payment autonomy (01:10:42–01:19:24) | Partial amounts, further-funds requests and contractor-controlled continuation exist. | Explain the choice, retain the unpaid balance after continuation, and communicate the decision to the client. Do not introduce a system-defined minimum percentage. |
| Full/partial/balance-due status (00:46:47) | Received/pending totals and remaining budget are calculated; receipt status and work permission are also displayed. | Add unambiguous stage-level financial status even after a stage closes or progression is authorized with a balance outstanding. |
| Receipt decision reinforcement (00:42:31–00:44:42) | The main confirm button calls the decision directly; request/flag have forms. | Add the second confirmation and show what the action will do before saving. |
| Additional-funds wording (00:40:24, 01:20:26) | Visible copy still includes `Request a top-up`; a requested amount is shown. | Use plain wording such as `Request additional payment`, state the amount/currency and what remains blocked, and make the client's response action clear. |
| Upload/file-camera visibility (00:29:02) | File/camera choices appear after the primary receipt CTA; changing a retained file uses an understated text control. | Make both choices prominent within the payment area once payment is eligible. Preserve evidence/approval gating. |
| Duplicate awaiting-review prompts (00:29:02–00:32:24) | Pending information appears in the receipt history and overall payment state. | Consolidate the actionable prompt and emphasize the participant's next step. |
| Replace an incorrect receipt (00:57:31–00:58:53) | Unsubmitted failed files can be changed, but submitted pending receipts are protected. | Support a clear correction/replacement path for an unconfirmed submission, retaining audit history. Never silently overwrite confirmed money or another receipt's proof. |
| Multiple receipts (00:58:53–01:00:16) | Receipt history and sequential top-ups exist; a unique pending-receipt constraint permits only one pending receipt per stage. Completed/funded stages also block new submissions. | Support the required multiple-payment evidence scenario and define corrections/top-ups after authorized progression, without deleting or reusing prior proofs. |
| Next-action navigation (00:47:57–00:49:25) | The implementation automatically selects progress after approval/refresh. | Offer a clear, role-specific action to enter the next stage; contractor-origin projects must land on updates, not another premature payment request. |
| Overpayment reinforcement (01:31:08–01:36:58) | Exact receipt checking exists, but the decision UI lacks the requested explicit over/under-allocation confirmation. | Show the difference and require acknowledgment. Automatic allocation of excess money to a later stage was discussed as an idea, not agreed behavior to implement silently. |
| Reliable notifications (00:53:07, 01:20:26) | Saved receipt decisions/activity exist; the session reported absent or unclear recipient feedback. | Verify both parties receive the correct received/further-payment/non-receipt/progression status and an actionable destination. Distinguish in-app notifications from any future payment-reminder email sequence. |

The current payment component is
[StagePaymentGate](../src/components/project/StagePaymentGate.tsx). Its immediate
accept action, conditional file controls and one-pending-receipt assumptions
should be reviewed together with the SQL, not as isolated label changes.

## Exchange-rate discrepancy

The review records differing XAF equivalents for USD 2,000 at
**00:33:41–00:35:23**. The user has already clarified that the transcript's
"ZAF" means **XAF**.

Current code intentionally distinguishes live display quotes from a saved BOQ or
approved-pricing conversion. New receipts retain their conversion snapshot;
same-project-currency amounts use the saved project basis. See
[receipt API](../api/_handlers/read-payment-receipt.ts),
[transaction rates](../api/_lib/receipt-exchange-rate.ts) and
[project money](../src/lib/budget/use-project-money.ts).

The exact cause on the tested projects is not established by the transcript.
Reproduce using their saved project basis and receipt snapshot, then compare
quotes with the same timestamp, direction, currency and rounding. Display the
source/date and distinguish a budget equivalent from a current transaction quote.
The phrase "Google or higher" expresses the discrepancy concern; arbitrarily
increasing an exchange rate would misstate money. A chosen factual rate must not
rewrite previously recorded receipts or the agreed native BOQ total.

## Stage-price amendments

| Item from the review | Current evidence | Remaining work |
| --- | --- | --- |
| Original versus proposed amounts unclear (01:48:33–01:56:08) | One editable stage amount and aggregate preview exist. History renders total and per-stage arrows with little explanation. | Separate labelled current/proposed stage columns, and label original/revised project totals independently. Show only the final confirmed changes in the approval summary. |
| Decimal/dash and reverted edits (01:49:58–01:57:14) | Current inputs normalize decimal text; proposals are sent on submit, not every keystroke. Unchanged values are excluded by the preview helper. | Reproduce the exact typing/reverting sequence. Ensure display separators never become part of the monetary input, final drafts are retained and no interim value enters a submitted proposal. Do not assume current storage is autosaving because the recording's display was confusing. |
| All stages editable (01:51:25) | `stage_price_editable` currently excludes historical/completed, zero/fixed-zero and financially committed stages. | Reconcile the expanded request with the user's earlier zero-stage rule. If adopted, use approved amendments that preserve original prices, real payments and prior work; removing the old guard alone is insufficient. |
| Contractor submission confirmation (01:57:14) | Submission currently calls the proposal RPC directly. | Review the exact final per-stage changes, currency and revised total in a second confirmation before saving. |
| Client decision confirmation (02:01:54) | Approve/retain buttons currently call the decision RPC directly. | Add clear confirmation of the selected proposal and the consequence of approving or retaining prices. |
| Price rejection affects prior proposals (02:03:40–02:05:45) | Reported in the session. Current SQL updates `WHERE id=p_proposal`, and each proposal stores its own before/after snapshot; current history renders by proposal ID. | Reproduce approved A → declined B, including same-stage and different-stage proposals, and inspect rendering versus persisted rows. Confirm A and the approved project budget stay unchanged; do not assert all history is being rewritten without this check. |
| Contractor receives acceptance feedback (01:58:44) | Realtime history includes decision status, but there is no prominent dedicated acceptance acknowledgment in the component. | Show the accepted/retained result, revised total and date clearly to the proposer, with the appropriate notification. |
| Role-specific instructions (02:00:34–02:01:54) | The shared hint currently says `Your contractor can propose revised stage prices` for every participant. | Address contractors as proposers, clients as reviewers (`Awaiting your approval`) and observers as readers. |

Relevant code: [StagePricingPanel](../src/components/project/StagePricingPanel.tsx),
[preview/RPC client](../src/lib/supabase/stage-pricing.ts), and
[amendment migration](../supabase/migrations/20261113000100_stage_price_amendments.sql).
The user's direct decision still permits total increases/decreases after client
approval; confirmed receipts and original BOQ evidence remain recorded.

## Other product and communication work

| Item | Current status / action |
| --- | --- |
| Walkthrough popups after an action has already been completed (00:20:14) | Confirmed gap: tours remember shown/dismissed anchors in local storage. They do not derive completion from saved user/project actions. Add real completion-based suppression, including another session/device, while retaining optional guidance for unfinished actions. |
| Project Back error (01:01:49) | Reported, not reproduced in this review. Contractor Back currently links to `/work/projects`. Reproduce the exact source tab, destination and exception across both account/project roles before claiming a root cause. |
| Action hyperlinks (01:04:59) | Some navigation exists. Audit each displayed action so it opens the exact stage/tab/receipt or review section, with the correct role and project. A label alone is not a complete action. |
| Client/contractor/observer link creation (02:11:38–02:21:27) | All three roles exist in the current link API and invitation panels; role is set at creation, not chosen as a privilege by the recipient. Test all paths with new/existing accounts. Client links remain the immediate business priority. |
| Observer permissions (02:14:36–02:16:52) | Project-role guards currently restrict writes independently of account type. Verify actual approval/payment/proposal/evidence mutations and read-only UI with an observer account. Seeing a client account dashboard alone does not establish client project permissions. |
| Link language and shortening (02:08:48–02:14:36) | Keep a recognizable first-party address, non-expiring single-use claims and clear recipient-role wording. The conversation explicitly reduces shortening to lower priority; do not weaken claim tokens to shorten a URL. |
| Four communication pathways (02:29:49–02:44:47) | Journeys, Admin templates/inbox/follow-up/tracking are implemented locally. Keep conditional onboarding branches visibly distinct from sequential unfinished steps. |
| Seven-day follow-up before human intervention (02:37:03–02:42:24) | Every unfinished action needs its own Day 1/3/7 cycle. A joined/already-onboarded acknowledgment is not another unfinished action requiring escalation. Test the actual step being reminded, suppression and Day-7 qualification, not just message count. |
| Support sender (02:44:47) | Meeting requests a support address for communication and says the partner address is fine. No exact replacement support mailbox is specified in the supplied records. Keep the user's directly selected addresses until the intended mailbox/scope is established; sender fields are already editable. |
| WhatsApp and GHL (02:44:47–02:51:22) | The user's newer explicit instruction excludes WhatsApp from this release. Do not infer permission to retire GHL's WhatsApp/acquisition workflows from an email-only release. Avoid duplicate activation email timers when that email rollout is enabled. |
| Cost concerns (02:46:05–02:50:12) | Current lifecycle scheduling/rendering uses database rules and stored templates, not a model call for each reminder. Receipt extraction is a separate model-consuming feature. Review delivery/database/runtime volumes separately instead of projecting token cost from a paused test. No current provider prices were researched for this review. |

## Team actions and deferred scope

- Ruth owns notifying Joseph about the stage-price timeline and coordinating the
  next review. These are team operations, not application code or authorization
  for the agent to send messages.
- The user/team owns calendar acceptance and meeting timing. No invitations were
  accepted by this review.
- Shorter links are lower priority than client access, money correctness and
  progression. Custom substage authoring remains deferred under the earlier user
  direction; the current-stage update workflow still needs to be correct.
- Verification revenue and contractor bidding follow this workflow acceptance.
  The meeting's schedule is a record, not a new deadline invented here.

## Recommended implementation order and acceptance

1. Correct the repeated contractor-origin cycle in database and UI together.
   Add a test that completes one paid contractor-origin stage and uploads the
   **next** stage's updates before any receipt for that next stage. Include a
   mid-build project. The previous first-stage-only tests are insufficient.
2. Implement the two-question receipt decision, second confirmation, financial
   status and exact client/contractor next actions. Preserve balances when work is
   authorized with a short payment.
3. Correct replacement/multiple-receipt handling, file/camera visibility and
   both-party notifications. Cover pending, flagged, corrected, confirmed and
   subsequent receipts; retain proof immutability and duplicate prevention.
4. Fix stage-price review/confirmation/role copy and reproduce the two reported
   draft/history bugs. Decide the zero/historical-stage scope before changing its
   guards; preserve approved snapshots and actual receipts.
5. Reproduce the Back exception, complete action destinations and suppress tours
   from real completion. Finish role-specific link/observer acceptance.
6. Review sender naming and run the complete controlled email journey/inbox test,
   alongside one comprehensive project/payment acceptance across both origins.

For each origin exercise: full payment, partial and proceed, partial and request
more, non-receipt, incorrect file, corrected receipt, multiple payments, mixed
supported currencies, overpayment reinforcement, final stage, zero stages,
mid-build history and repeated clicks/stale responses. Compare both views after
every decision. Budget totals, outstanding money, work permission and proposal
history must agree without becoming the same status accidentally.

The prior local checks (1,474 payment/project/budget tests and the payment database
regressions) passed the **existing** behavior. They do not establish that the new
repeated contractor-origin cycle or monetary confirmations described here are
implemented or accepted live.
