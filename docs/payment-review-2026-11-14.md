# November 14 payment and pricing update

Implemented from the November 13 review and the user's explicit approval of
price revisions to every stage, including zero-cost and completed stages.

## Result

| Area | Implemented behavior |
| --- | --- |
| Contractor-created projects | Every live stage repeats evidence → client approval → payment for that reviewed stage → contractor authorization → next stage's evidence. Mid-build historical work stays completed. |
| Client-created projects | Payment and contractor authorization precede stage work; client evidence approval precedes the next stage's funding. |
| Receipt review | Contractors answer whether money arrived, then whether work can continue. Non-receipt needs a reason. Requesting additional funds records the received money and holds progression. Allowing work keeps the outstanding balance visible. |
| Monetary confirmation | Receipt decisions, proposals, approval, retention and withdrawal have a second confirmation. Receipt and price snapshots reject stale decisions. Cancellation writes nothing. |
| Uploads | File and camera controls are visible when payment is eligible. Multiple files queue individually, each with its own amount/currency. Another receipt can be submitted while an earlier payment awaits review. |
| Corrections | An unconfirmed/flagged receipt may be replaced. The old proof remains linked to its replacement and contributes no duplicate balance. Confirmed received proof cannot be replaced. |
| Later payments | Outstanding balances can receive more receipts after work completes. This neither reopens work nor changes earlier confirmed ledger metadata. |
| Pricing | Primary contractors may propose zero or positive prices for any stage. Primary clients approve changes to the shared stage and project totals. The total must remain positive. Original BOQ/budget, receipts, work status and earlier proposals remain recorded. Archived projects stay read-only. |
| Feedback | Client and contractor wording differs by project responsibility. In-app notices open the right stage/tab. Actual completed actions suppress walkthroughs across sessions. Observers retain read access. |

## Rollout

Use the database that already has the current project-team, confirmed BOQ,
receipt reading/multicurrency, receipt reservation and stage-price amendment
migrations. Apply only the new additive migration:

`supabase/migrations/20261114000000_project_payment_review.sql`

It runs as one transaction, reloads the PostgREST schema and is tested when
replayed twice. It does not change monetary column types. Do not rerun
`009_admin.sql` as part of this update.

Apply the migration before deploying the matching frontend. Existing pending
price proposals use the earlier financial fingerprint and may now be stale;
withdraw/retain them and prepare a new proposal before approval. Previously
approved history remains intact. Only the current ordered locked work stage of
an active contractor-created project is repaired automatically. This creates no
receipt or payment.

No production migration, deployment, real receipt upload or external message was
performed during implementation. WhatsApp remains outside this release.

## Verification

- `npm run typecheck`
- `npm run build`
- `npm test -- --maxWorkers=2`: 4,809 passed; two spreadsheet preview tests timed
  out. The spreadsheet file rerun passed all six tests.
- `npm run test:review-db`: isolated PostgreSQL migration/RPC regressions, including
  repeated contractor stages, partial progression, multiple/replaced/late receipts,
  stale confirmations, role guards, all-stage revisions, immutable history,
  translated notifications and completed-action guidance. Migration replay is
  included.

For deployed acceptance, use controlled client/contractor accounts on both project
origins. Exercise receipt correction, multiple payments, mixed currencies, partial
and proceed, partial and request more, non-receipt, zero-cost and final stages,
mid-build history, price increases/decreases, retained proposals and Back from
each project tab. Compare both participants after every saved decision. Check an
observer sees the same recorded values without approval/upload/edit actions.

Real receipt extraction still depends on the deployed receipt service and its
provider configuration. This local verification does not establish live delivery
or receipt-provider availability.
