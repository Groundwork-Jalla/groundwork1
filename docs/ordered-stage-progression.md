# Ordered stage progression and payment prompts

The second product-review fix connects the last update approval to the next stage
and enforces construction order in the database.

## Behaviour

- Clients approve updates directly across all existing project tiers while
  independent verification is paused. The last required update completes its
  stage atomically and returns the exact next stage and payment state.
- The client immediately sees the next receipt step. A background refresh cannot
  discard a saved approval, overwrite another project, or interrupt the handoff.
  Intentional history browsing remains selected across unrelated refreshes.
- The current stage can accept its receipt even when initial/mid-build setup
  already marked it active. Upload alone does not permit work; contractor
  acknowledgment remains required.
- Payments for future stages may be acknowledged, but cannot open those stages
  early. Completing the prerequisite opens a funded successor without requesting
  another receipt. Only one stage can be active or awaiting review at a time.
- Zero-cost stages open in order without a payment and still require their normal
  update approvals. Historical stages keep their completed state and allocations.
  Unknown prices or missing positive payment rows do not become free stages.
- Confirmed ledger entries determine funding. Approval synchronizes an outdated
  paid/partial flag; it never invents a receipt or an actual payout.
- Final completion produces no further payment prompt. Paused projects do not
  resume when a payment arrives. Repeated approvals do not reopen completed work.
- Approval failures remain visible and retryable. Remaining required approvals
  are counted instead of leaving users to guess what blocks progression.

## Database boundaries

The migration serializes normal project progression before locking stage/payment
rows. Deferred activation checks protect older initialization writers while
allowing historical-stage setup to finish atomically. Substage completion uses a
dedicated RPC; ordinary clients cannot bypass the final-update transaction with
a direct status update. Work submissions check order and acknowledged funding.

The migration does not silently cancel or reclassify previously recorded work.
Older inconsistent projects or missing funding records require review.

## Deployment and verification

Apply these migrations in order before deploying the frontend:

1. `20261112000000_receipt_payment_amounts.sql`, if not already applied.
2. `20261112000100_ordered_stage_progression.sql`.

Run `pnpm test:stages-db` for the actual migrations and approval/funding guards in
isolated PostgreSQL. UI and API tests cover the automatic prompt, prepaid
successors, current unpaid stages, finality, historical values, retry/error
handling and navigation races. Run `pnpm typecheck` and `pnpm build` as well.

No production migration or deployment has been executed by this change.
Primary-client/contractor invitation permissions are covered by the following
change, documented in [project-team-permissions.md](project-team-permissions.md).

## Contractor-created first-stage clarification

Migration `20261112000700_reviewed_first_stage_payment.sql`, after 005/006, keeps the
first live contractor-created stage current after client work approval. Its receipt
pays that reviewed stage. Contractor acceptance then completes it and selects the
next stage, which follows the ordinary funding cycle. The pending state also covers
partial payments, top-ups and paused projects without changing BOQ allocations.
Zero-cost first stages continue directly after work approval. See
[product-review-follow-up.md](product-review-follow-up.md) for release and tests.
