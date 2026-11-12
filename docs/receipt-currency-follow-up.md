# Receipt currency and payment wording follow-up

This implements the latest review and the user's clarification that “ZAF” means
**XAF**. It keeps the agreed creator-specific workflows: client-created projects
start with payment; a contractor-created project's first live stage starts with
contractor evidence, client approval, payment for that reviewed stage, then
contractor confirmation. Later stages keep their existing progression rules.

## Changes

- Before the payment prerequisite is met, the stage shows its payment explanation
  below the work updates. The client upload form, file/camera controls and upload
  button appear when payment becomes available.
- Contractor copy describes their own action. Approved updates lead to waiting for
  the client's receipt, then reviewing it and confirming the money received.
  The confirmation button says **Confirm payment received and continue**. Both
  English and French copy distinguish client, contractor and observer roles.
- The client selects the currency printed on the receipt, including USD, XAF and
  the other supported transaction currencies. The entered amount must match that
  receipt, regardless of the scheduled stage amount. Positive partial payments
  remain supported. A mismatch retains the selected file for correction/retry.
- Each receipt stores its original amount and currency, USD equivalent, project
  equivalent, rates, source and date. Both project views read that saved snapshot.
  Receipt history and already recorded money are not repriced on refresh.
- Confirmed partial payments reduce the remaining stage budget. Pending receipts
  stay separate and flagged receipts are excluded. Uploading a receipt or reaching
  the allocation does not open work automatically: the contractor confirms and
  chooses whether to continue, request a top-up or flag the receipt. Proceeding
  with an agreed partial payment does not rewrite the stage's allocation.
- Confirmed BOQ totals, zero Groundwork fees, stage allocations, historical stage
  values and the division of contractor evidence/client approvals are preserved.

## Conversion rules

The receipt reader verifies the amount and currency from the private uploaded file
before attaching a conversion. Only the server role can attach that conversion;
the submission RPC requires the matched reading and rejects a different browser
rate. The first attached conversion remains fixed on retries.

For a receipt in the project's own currency, use the confirmed BOQ conversion.
USD receipts use parity. For a different supported transaction currency, the
server fetches a USD-based daily rate from the existing open ExchangeRate-API
provider. It accepts a recent valid feed, caches it for at most an hour and rejects
rates older than 48 hours or dated more than five minutes into the future. Missing
rates leave the payment unsubmitted and provide a retry message.

The native project equivalent uses the BOQ's saved conversion; projects without a
confirmed BOQ use the existing canonical country budget basis. The stage payment
panel uses that same budget basis, independently of any live display quote.
New receipts save the project equivalent to six decimal places. Older receipts
retain their stored amounts and conversion behavior; unknown legacy amounts stay
unknown. Existing receipt records are not rewritten by the migration.

Receipts converted through the provider show the saved rate, date and attribution.
The provider response fields, daily update behavior, caching and attribution
requirements were checked against its
[official open endpoint documentation](https://www.exchangerate-api.com/docs/free).
No new provider key or browser secret is required.

## Release

Apply `supabase/migrations/20261112001000_receipt_multicurrency.sql` after migrations
through `20261112000900_stage_approval_metadata.sql`, and release the matching API
and frontend. Migration 009 remains the repair for the missing `approved_by`
column seen during stage approval. Refresh both participants' sessions after the
release. Migration 010 requires server-attested conversions for new receipts, so
keep the application/API release coordinated with the database update.

The receipt reader still needs the existing server-only `ANTHROPIC_API_KEY` and
Supabase configuration. External transaction currencies additionally need server
access to `https://open.er-api.com/v6/latest/USD`. A provider outage does not
substitute a guessed transaction rate. Same-project-currency and USD receipts do
not need that rate request.

## Local validation

Verified for this change:

- Full Vitest suite: **4,495 tests passed across 257 files**.
- `npm run typecheck` and `npm run build`: passed.
- `npm run test:review-db`: passed with migration 010, including mixed XAF/USD/EUR
  receipts, frozen conversions, tampered-rate rejection, partial payments, top-ups,
  contractor-controlled progression and immutable receipt history.
- `npm run test:evidence-db`: passed with migration 010, retaining contractor-only
  evidence writes, client review/receipt permissions and approval-schema repair.
- `git diff --check`: passed.

The full suite ran outside the restricted subprocess sandbox because existing
repository checks invoke read-only shell commands. PostgreSQL checks used
disposable local databases on private Unix sockets. No production access was used.

## Follow-up acceptance testing

Use separate client and assigned contractor accounts on projects created by each
role, including a mid-build project. Check that clients only review construction
evidence, the first contractor-created payment names the reviewed stage, and the
receipt upload controls appear at the appropriate point. Confirm that contractor
copy addresses the contractor throughout the waiting and confirmation states.

For an XAF project, try matching XAF, USD and EUR receipts, a partial payment,
currency/amount mismatches and a second top-up receipt. Compare received, pending
and remaining balances in both views before and after contractor decisions.
Confirm that pending funds do not reduce the confirmed remaining budget, that a
contractor can proceed with an agreed partial payment, and that reloading does not
change saved conversions. Exercise file and camera options on a phone.

Local checks use disposable PostgreSQL databases and fixture receipt/provider
responses. Live account testing and real receipt acceptance remain the team's
follow-up after release; no production migration or deployment is performed here.
