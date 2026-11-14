# Project, evidence, payment and price behavior — 14 November 2026

This describes the current implementation and the latest decisions from the chat.
It is a behavior reference for the team's later comprehensive test, not a claim
that every scenario has passed on the deployed application. The latest invitation,
notification and navigation work still needs its matching release.

## Responsibilities

| Project role | Responsibilities |
| --- | --- |
| Primary client | Approves construction updates and price proposals, chooses/proposes payment plans, uploads payment receipts and invites eligible participants. |
| Primary contractor | Uploads construction updates, proposes stage prices, reviews installment plans, confirms received money, authorizes current work and explicitly authorizes progression with a balance. |
| Additional contractor | Uploads construction updates and collaborates; does not replace the primary contractor's financial/pricing authority or gain invitation management. |
| Observer / family | Reads project progress, costs, documents and conversations; can participate in conversation, including permitted attachments. Cannot approve, submit stage evidence, upload payment receipts or change prices. |
| Assigned verifier | Reviews assigned verification work in its own workflow. This does not replace the primary client/contractor payment responsibilities. |

Account role and project role are distinct. An admin correcting someone's account
role changes their general dashboard, while accepted project responsibilities
remain explicit. Saved creation origin does not change when an account role changes.

## Creation and invitations

Both origins save one project and one shared stage schedule. An uploaded confirmed
BOQ supplies the project's native total and precision without extra Groundwork fees.
Standard percentage/fixed/zero rules distribute it across all stages and retain the
same sum. A mid-build start records previous stages as completed with their values;
it does not turn those values into zero or invent received-payment records.

The sender chooses a role before generating a link. The first contractor can be
the primary contractor; later contractor invitations are additional assignments.
There is one primary client. Family is observer access. An email invitation remains
available alongside the link option. Choosing a dropdown option alone sends nothing.

A new invitee signs up and verifies their account; an existing invitee signs in.
The role and original project context survive confirmation/MFA/recovery. Required
contractor onboarding is completed only when necessary. The recipient joins the
existing project in the chosen role rather than creating another project.
Independent contractor signup grants standard access, not automatic certification
or directory/partner standing.

Shared links do not expire and can be withdrawn. Only the first eligible verified
account can claim one; a retry by that account is safe. Email-bound invitations must
match the invited address. Another account, a revoked invitation or an already
assigned member cannot use a link to acquire a different project privilege.

## Contractor-created project: repeating cycle

1. The contractor creates the project and invites its primary client.
2. The current unfinished stage is available for contractor construction updates.
   Uploads can be added before the client joins, but a client must join to review.
3. The client views and approves the required substage updates. The final required
   approval triggers the main-stage approval check.
4. Approved work remains on that stage awaiting its own payment. Receipt controls
   become available for this reviewed stage. The next stage remains gated.
5. The client submits the stage's receipt(s), using full payment or the agreed
   installment arrangement.
6. The primary contractor confirms whether money arrived and separately decides
   whether current work is authorized. A receipt upload or reader match alone does
   not count as money received.
7. With approved work, received funds/work authorization and full settlement, the
   stage completes and the next stage opens for evidence. If money is outstanding,
   the contractor must explicitly authorize next-stage progression to move on.
8. The same evidence-first cycle repeats for every later live stage.

Payment after approval belongs to the reviewed stage, including the first live
stage of a mid-build project. Completing Stage 4 does not ask for Stage 5 payment
before Stage 5 evidence on this origin.

## Client-created project: repeating cycle

1. The client creates the project and invites its primary contractor.
2. The current unfinished stage starts with payment. The client submits proof for
   that stage and the contractor reviews it.
3. Confirming received money alone does not authorize work. The contractor must
   also allow work; a split plan must be accepted before work is authorized.
4. When authorized, the contractor uploads that stage's required evidence.
5. The client reviews and approves it. Paid money alone never approves construction.
6. With approved work and full settlement the stage completes; the next stage
   awaits its own payment/work authorization. With a remaining balance, explicit
   progression authorization is still required.
7. Repeat payment → authorized work/evidence → client approval for later live stages.

If the client submits a receipt before the contractor has joined, it is pending
until the primary contractor joins and reviews it. An observer or additional
contractor cannot perform that financial confirmation.

## Full payment and two installments

The plan concerns a stage's agreed price; it does not move money or change the
project budget. Full payment is the default, and saving a full-payment plan needs
no separate contractor acceptance of the plan itself. Receipts still need review.

For two installments, the client enters a positive first amount below the stage
total. The second is the remainder; it need not be 50/50. The primary contractor
accepts the arrangement or requests a revision. Receipt evidence can be submitted
while a split plan is awaiting review, but the unaccepted arrangement cannot
authorize work/progression. A declined plan requires revision before new receipts.

Several receipts may count toward installment 1 or 2. For a stage of 1,000,000 XAF,
a 600,000 / 400,000 split might have 200,000 and 400,000 receipts for the first
installment and 150,000 and 250,000 for the second. Each file retains its amount,
currency, installment association and decision. Confirmed amounts total the same
1,000,000. An installment is not a limit of one file.

Plans are normally chosen before receipts/funding. Declined plans can be revised
where allowed; previously submitted proof keeps its original history. The UI does
not silently retag or overwrite old receipts when a plan changes.

## The three separate decisions

| Decision | Effect |
| --- | --- |
| Was this money received? No | Record a reason/flag. It does not reduce the confirmed balance or unlock work. |
| Received: record only | Reduce the balance by the confirmed amount. Do not grant current work permission. |
| Received: request more | Record actual received money and request a bounded top-up; keep work/progression gated. |
| Received: allow current work | Permit work where the stage/accepted plan allows it; retain any unpaid balance. |
| Allow next stage with balance | After work approval and received funds, explicitly confirm progression. Keep the amount owed against the original stage. |

For a 1,000,000 XAF stage with 600,000 confirmed, the remaining amount is 400,000.
Allowing current work does not make that 400,000 paid and does not itself authorize
the next stage. Once work is approved, the contractor can wait for settlement or
confirm progression with debt. Later payments reduce the same old balance without
reopening work or skipping the current construction stage.

Confirmation dialogs show the affected amount and consequence. Canceling writes
nothing. A stale receipt, price or plan must be refreshed before confirmation.
The contractor can also return to confirmed received funds and authorize work
later while another receipt is still pending. That action does not confirm the
pending receipt or include it in the received total.

## Receipt submission and exceptions

The client selects a file or camera capture, selects the currency printed on that
proof and enters its exact amount. The reader checks the document independently
of that typed amount. Each queued file is checked/submitted separately; selecting
several files does not authorize treating all of them as one transfer.

- Successfully read unrelated image: request a real payment receipt.
- Unreadable proof: request a clearer image/document.
- Amount/currency mismatch: correct the input/selection or use the right proof.
  A valid partial amount is compared with the receipt, not forced to equal the full
  stage price.
- Reader/provider unavailable: keep the file/input and offer retry. It cannot be
  classified as a valid receipt or credited without a successful check.
- Pending proof: visible in history but separate from confirmed received totals.
- Flagged or unconfirmed incorrect proof: replace it while retaining the original
  and replacement relationship. Replaced proof is excluded from balance totals.
- Confirmed proof: remains immutable; the replacement action is unavailable.
- More payments: add separate receipts. One receipt must not be reused to count
  money twice or assigned to two stages.
- Received money above a later revised price: retain actual history and show no
  negative payable balance. This does not implement an automatic refund or move
  excess money to another stage.

Groundwork records evidence of payments made outside the application and the
contractor's acknowledgment. Reading a receipt does not independently verify bank
settlement or initiate another transfer.

## Currency, historical work and special states

Both views share the saved project budget and receipt snapshots. The receipt's
original amount/currency, receipt-to-USD conversion and USD-to-project conversion
remain recorded. A later browser market quote does not silently change an agreed
BOQ or old payment. The interface distinguishes source/save time/provider quote
date; an unavailable original historical quote date is not invented.

Zero-cost stages require no payment; their normal applicable work/review rules
still apply. A later explicitly approved price revision can change an originally
zero stage. Missing/unknown prices are not automatically free.

For a mid-build 8,000,000 XAF project with 2,000,000 of previously completed work,
the whole recorded project value remains 8,000,000 and the remaining managed work
starts at 6,000,000 before new confirmed payments. The historical 2,000,000 is not
rewritten as zero or fabricated as a new contractor receipt.

Future stages cannot be used to skip incomplete earlier work. On-hold work does
not automatically resume because a receipt exists; permitted financial history
for completed stages remains separate. Archived projects remain read-only. Final
work completion creates no next-stage prompt. If progression was authorized with
debt, later balance receipts remain possible after work/project completion.

## Stage price changes and what a client can edit

The normal client workflow is **review/approve**, not originating a contractor
price proposal. The primary contractor selects proposed zero or positive prices,
sees each before/after amount and the revised project total, and confirms submission.
Every stage is eligible, including completed, zero and historical stages, subject
to the project's writable status. The project total must remain positive.

While pending, the existing approved budget continues to apply. The primary client
reviews the exact proposal and confirms approval or keeping current prices. The
contractor can withdraw an undecided proposal. There is one pending proposal per
project. Canceling or reverting a draft edit does not record a price change.

Approval updates the agreed stage prices and project total together for both
views. Raising one stage by 100,000 normally raises the total by 100,000; it does
not silently deduct that amount from other stages. The original BOQ and previous
approved/declined proposals remain history. Declining a new proposal never changes
an earlier approved proposal. Actual received amounts and completed work remain
recorded. An increase may create another outstanding balance; a reduction may
remove a payment gate. The system does not invent a payment or reopen historical
work to make those figures match.

Changes in receipts, assignments or project prices while a proposal is open can
make it stale. It must be refreshed/recreated rather than approving outdated
figures. Editing substage names, scope or adding new substages is separate deferred
functionality, not a consequence of changing a stage price.

## Notifications, guidance and return links

The latest local notification implementation sends meaningful project events to
accepted participants, normally excluding the person performing the action.
Pending/revoked members are excluded; existing invitees have acceptance notices
and joining users get project-ready notices. Private staff notes stay private.

Clicks resolve current project membership and open the right workspace and exact
stage/receipt/proposal/document/conversation/message. Approvers get the applicable
controls; observers get the read view. Clicking a notice never approves or confirms
money by itself. Read status synchronizes across the bell/list, and unread counts
include older records. Revoked access produces an access error, not another
project's screen.

Back uses an explicit role-aware document link, with visible mobile text and
loading/error escape paths. BOQ-editor Back retains the relevant authoring/project
tab. The original reported live failure remains part of the later deployed review.

Completed actions suppress their walkthrough tips. Activation email reminders are
the separate signup/onboarding/invitation Day 1/3/7 framework; they do not confirm
payments. Actual email launch configuration and direct Meta WhatsApp integration
remain separate work in [the implementation audit](meeting-implementation-audit-2026-11-14.md).
