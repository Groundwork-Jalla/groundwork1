# Stage pricing and account corrections: review follow-up

The supplied meeting notes are review material. The user clarified the pricing
decision directly: **a stage-price change may increase or reduce the project total
after client approval**. The implementation follows that decision.

## Status against the review

| Review item | Status |
| --- | --- |
| Remove premature receipt upload controls | Implemented in the preceding receipt fix; payment explanations remain visible and controls appear when payment is available |
| Receipt currency dropdown and exact reading | Implemented in the preceding fix, including XAF and USD; currency means the currency actually printed on the receipt |
| Partial payments and contractor confirmation | Implemented: confirmed receipts reduce balances, pending receipts stay separate, and contractors decide whether to proceed or request a top-up |
| Different initial actions by project creator | Retained: client-created projects start with payment; contractor-created projects start with evidence, client review and payment for that reviewed stage |
| Contractor stage-price editing | Implemented as proposals for client approval, available across project origins and countries |
| Client-approved changes to the project total | Implemented for increases and decreases, with the original budget and proposal history retained |
| Admin correction of client/contractor signup mistakes | Implemented under Admin → Users → Change account type |
| Custom substage creation and editing | Queued for a future rollout, as requested; no custom-substage editor is included in this release |
| Second round of live testing | Team acceptance after the migrations and application release; local automated tests do not replace it |

## Stage pricing

The accepted primary contractor opens the project's **Money** tab and chooses
**Propose revised prices**. The form shows the current prices in the project
currency and previews the revised total. They can update eligible construction
stages and add a reason. Submitting the form records a proposal; the current
budget, receipt amounts and stage progression remain applicable.

The primary client sees a project review prompt and can review the complete change
in **Costing**. **Approve revised prices** applies the entire proposal. **Keep
current prices** closes it without changing the budget. The proposer can withdraw
a pending proposal. One proposal may await review per project.

Approval writes the revised native stage prices, matching USD schedule, expected
unfunded ledger amounts, stage shares and project total in one transaction. Both
views use these saved values. The contractor project refresh also rejects older
responses so an in-flight request cannot replace an approved budget with a stale
one or display the previous project's response after navigation.

Completed and historical stage amounts, zero-cost stages and stages with financial
commitments retain their recorded prices. Stages with receipts cannot be repriced
through this editor. Actual receipts are never rewritten to match an allocation.
Clients and observers cannot submit contractor price proposals, and contractors
cannot approve their own proposals. The server checks these roles independently
of the displayed buttons and the user's account type.

A proposal includes a fingerprint of the budget, stage prices, progress and
eligibility. The server rechecks it under the same project lock used by stage and
payment workflows. A payment, completed stage, price change or contractor
reassignment that invalidates the proposal requires a fresh proposal. The client
can retain current prices and the contractor can prepare another proposal. Repeat
approval is idempotent.

## Budget and BOQ history

Before any amendment, the confirmed BOQ remains the authoritative total. After a
client-approved amendment, the application labels the figure **Approved project
total** and shows the original BOQ total alongside its proposal history. The
original source file and source label remain intact. Future amendments retain the
first original total rather than replacing it with the previous revision.

Revised BOQ stage prices sum exactly to the revised native total and the USD
schedule sums exactly to its saved USD equivalent. Percentages describe the new
prices; the accepted prices govern the allocation. Tiny USD conversion rounding
is reconciled on a changed stage, without changing historical or paid prices.
Groundwork fees remain zero on BOQ projects.

Projects priced by the estimator retain their recorded standalone fees when stage
prices change. Approval saves the revised breakdown and currency basis, rather
than generating new estimator fees from the larger total. Native prices retain up
to six decimal places. Budget views use the approved breakdown and no longer show
estimator derivations or low-estimate prompts for those agreed figures.

Pricing decisions and account corrections have English and French audit labels.
The admin Financials tab shows proposal history. The previous automatic take-off
repricing tool is hidden after an agreed pricing revision so it does not replace
custom prices without the client's approval.

## Account-type correction

An administrator selects the user, chooses **Client** or **Contractor**, and saves.
The database verifies administrator standing and the expected existing type. The
change retains account identity, owned projects, project memberships, receipts,
staff roles and verifier roles. It records the administrator and both account
types in the audit log. A user can refresh or sign in again afterward.

This changes the account's base type, not its role on each project. A client who
becomes a contractor still reviews work as the client of their existing project;
they do not acquire construction-evidence permissions through the account switch.
The editor does not grant admin or verifier standing. An account with accepted
contractor assignments must have those responsibilities reassigned before it can
be converted to a client. Removing contractor standing also clears the old
contractor signup intent so a later authentication callback cannot undo the
correction.

## Queued: custom substages

Keep this as a separate future feature:

- Add and rename custom substages within an eligible main stage, with stable IDs
  and an explicit ordering model.
- Preserve evidence, approvals and audit history when the scope changes; retain
  approved work rather than deleting it or silently reducing the completion target.
- Define client review of changed scope and its effect on completion before
  changing the approval gates.
- If substage costing is added, reconcile its exact native amounts to the approved
  main-stage amount. Changes to the agreed total use the same client approval rule.
- Enforce contractor authoring, client review, observer read access and existing
  payment, historical and zero-stage rules on the server.

## Release order

Keep all preceding migrations through
`20261112001000_receipt_multicurrency.sql`, then apply:

1. `20261113000000_admin_account_type.sql`
2. `20261113000100_stage_price_amendments.sql`

Release the matching frontend and API together. The receipt API now reads the
pricing revision when selecting the frozen project currency basis. No new API key,
package dependency, production data backfill or outbound email is required.

No production migration, deployment or real-account conversion is performed by
these local changes.

## Local verification

- Full application suite: 4,533 tests passed across 260 files.
- Final contractor refresh and project-role regressions: 8 tests passed after the
  last navigation/loading guard.
- Typecheck and production build: passed.
- `test:review-db`: passed using actual migrations in a disposable PostgreSQL
  database. Checks cover client approval, increases/decreases, stale receipts,
  immutable originals, zero/historical stages, exact native/USD totals, estimate
  fee preservation, fractional GBP totals, account correction permissions and
  creator-specific payment/evidence progression after revised prices.
- `git diff --check`: passed.

Existing tests that spawn read-only shell commands ran outside the restricted
subprocess sandbox. Database tests used a private local Unix socket. Provider
responses remain fixtures; no production account or payment was changed.

## Acceptance checks after release

Use distinct client, primary contractor, observer and admin accounts. Repeat the
price proposal flow on client-created, contractor-created and mid-build projects.
Check pending, approved, retained and withdrawn proposals; increases and decreases;
fractional native amounts; original BOQ history; and identical revised figures in
both views. Upload a receipt while a proposal awaits review and confirm that stale
prices cannot be approved. Confirm historical prices, zero stages and received
money remain intact.

Use the admin editor to correct a mistakenly registered client to contractor. On
refresh, check their workspace and existing projects, including their retained
client responsibilities. Verify a non-admin cannot call the correction RPC, staff
standing remains intact, and assigned contractor accounts receive the reassignment
instruction before conversion to client.
