# Friday product session — implementation follow-up

Sources: the November 13 Friday meeting notes, PDF and recording transcript
provided by the user. The auto-generated summary conflicts with its decision
section on a two-installment limit. The transcript at 1:17–1:24 discusses the
tradeoff without resolving it. The user's subsequent clarification controls:

- Offer full payment or two installments for each stage.
- Several vendor receipts may count toward either installment; two installments
  is not a two-file limit.
- The next stage normally waits for full settlement. A contractor may explicitly
  authorize progression with the remaining balance still recorded.

## Action points and current evidence

| Item | Status / work |
| --- | --- |
| Shared-link login failure, including an existing account in incognito | Invitation continuation/retry and account-role fixes implemented; 526 local application tests and PostgreSQL team/race tests passed. Live credential failure itself has not been reproduced. |
| Clear primary versus additional contractor/observer invitations | Verified locally: the primary client has contractor link sharing and an email option before the role is reserved. Pending and accepted assignments show their status; additional sharing uses observer access. Existing tests cover the form, role limits and email-delivery fallback. |
| Receipts overwrite one another | The preceding payment release retains individual receipt rows, pending batches and immutable replacements. Local PostgreSQL regressions verify this; repeat the exact live two-receipt scenario after release. |
| Read and total several vendor receipts | Each file is read against its own amount/currency. Only confirmed, unreplaced receipts count toward received totals; pending amounts remain separate. Mixed-currency snapshots remain fixed. |
| Full payment / two-installment plan | Implemented: client chooses full payment or proposes two installment amounts; the primary contractor accepts or requests a revision. Multiple verified receipts can belong to either installment. Versions and replaced proofs remain in history. |
| Work authorization versus settlement / next stage | Implemented: record received money without requesting a top-up, authorize current work separately, and use a distinct confirmation to progress with debt. Full settlement finishes already-reviewed, authorized work. Migration replay never converts a new work permission into a debt-progression permission. |
| Outstanding balance upload after work completion | Implemented by preceding payment release and covered by local database tests. The balance must remain payable after progression. |
| Wording after every payment/evidence action | Payment copy distinguishes the actors and decisions in English and French. In-app plan, receipt and progression notifications link to the correct stage. Partial receipt acknowledgement does not demand another payment. Existing evidence-first guidance remains in place. |
| Correct XAF conversion and show its basis | Actual reviewed receipt/project rate verified read-only; currency fix and release notes in exchange-rate-review-2026-11-14.md. |
| Individual test recordings | Ruth/team to record both project origins, primary-role/observer links, multiple vendor receipts, installments, price approvals and late balances after deployment. |

The notes' requests to message the team or schedule calls are meeting action
items. They are not instructions to send messages or book meetings from this task.

## Release order

The user has already released `20261114000000_project_payment_review.sql` and its
matching application. The new changes require the following migrations, in order,
before deploying the current application:

1. [20261114000100_invitation_role_consistency.sql](../supabase/migrations/20261114000100_invitation_role_consistency.sql), if not already applied.
2. [20261114000200_currency_basis.sql](../supabase/migrations/20261114000200_currency_basis.sql).
3. [20261114000300_stage_payment_plans.sql](../supabase/migrations/20261114000300_stage_payment_plans.sql).

The two new migrations are transactional and replay-safe. No new environment
variables are needed. The installment migration makes the old receipt write RPCs
private; deploy the matching application immediately after applying it.

Historical confirmed money, conversion snapshots and completed work are retained.
Existing recorded progression permissions are imported once; later receipts do not
gain those permissions when the migration is rerun. A client-approved reduction
to zero removes the obsolete payment gate while preserving the former plan and
receipt history. The payment card's USD equivalent follows the current approved
stage price rather than a previous ledger amount.

## Validation and remaining acceptance

- Full application suite: **4,893 tests passed in 276 files**. Subsequent zero-price
  and pricing-equivalent checks were verified in the affected project/budget suites.
- TypeScript checking and production build passed.
- Real local PostgreSQL tests passed for migration replay, immutable currency dates,
  full/split payments, several vendor receipts per installment, receipt replacement,
  record-only decisions, contractor permissions, stale confirmations, late balances,
  progression overrides, language-specific notifications and zero-price revisions.
- Production migrations, deployment and the team's controlled browser test remain
  external release steps; they were not performed by this implementation task.
  The reported live credential failure and original Back crash still need their
  exact live reproductions checked. Local invitation/Back regressions have passed.
