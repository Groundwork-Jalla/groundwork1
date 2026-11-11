# Receipt-based project payouts

The first outstanding item from the November 11 product review is implemented in
the repository. Apply the database migration before deploying the updated UI.

## Behaviour

- Clients enter the actual amount on a payment receipt and attach the file. The
  planned stage amount remains visible as a reference; it is not prefilled as an
  actual payment.
- Contractors see the submitted native amount and saved USD equivalent before
  acknowledging receipt. Upload alone does not open a stage. Confirmation checks
  the receipt path and exact upload timestamp so a replacement cannot be confirmed
  using an outdated screen.
- Client overview, client costing and contractor project money use the same
  receipt payout summary. Confirmed receipts count as Payouts; submitted receipts
  awaiting acknowledgment are separate. A completed stage never supplies an
  actual payment amount.
- BOQ contract totals, allocations and fee rules remain unchanged. Receipt amounts
  may differ from the allocation by agreement. Native receipt amounts retain up to
  six decimal places and use a saved conversion rate. BOQ receipts use the
  project's locked rate on the server.
- Remaining budget excludes historical allocations and acknowledged receipts.
  Overruns are shown explicitly. Missing legacy receipt amounts and failed ledger
  reads display unknown values instead of invented payouts or zero.
- Existing provider transfer history remains separate from direct payments to the
  contractor. Paid fee flags and waived fee amounts are not receipt amounts.

## Deployment

Run `supabase/migrations/20261112000000_receipt_payment_amounts.sql` after the
existing confirmed-BOQ and invitation migrations, then deploy the frontend.
Already applied migrations do not need to be rerun.

The migration adds nullable receipt amount/currency/FX columns without inventing
values for older receipts. Pending older receipts must be resubmitted with an
amount before contractor confirmation. Older confirmed rows remain unchanged and
are flagged for review by the summary.

It also repairs the original payment guard to admit the receipt transitions
introduced by migration 175 while retaining existing ledger protections. The old
amount-free upload RPC refuses new submissions; the old confirmation RPC retains
the existing admin cash fallback.

## Verification

Run `pnpm test:receipts-db` for the actual migration, receipt RPCs and original
ledger guards/projection in isolated PostgreSQL. Unit and component tests cover
actual versus scheduled amounts, pending versus acknowledged receipts, fixed FX,
native decimals, historical allocations, unknown legacy values, failed reads,
replacement races and stale project views.

Production migration, deployment and browser acceptance testing have not been
performed by this change. The subsequent approval-to-payment and stage-order fix
is documented in [ordered-stage-progression.md](ordered-stage-progression.md).
