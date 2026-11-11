# BoQ budgets and project invitations

The supplied `Devis_R4_Penthouse_Simplifie_Corrige.xlsx` ends at `2-Devis!E65`:
`TOTAL GÉNÉRAL TTC = 1,414,073,374.524 FCFA`. Its earlier HT total is
`1,185,805,764.8`, which the previous parser incorrectly selected after stripping the
TTC decimal point.

## Behaviour

- Native spreadsheet numbers retain their values and source cell. Text readers
  support English/French separators and up to six decimal places. Final payable/TTC
  totals outrank section totals; equivalent overall totals use the final occurrence.
  An unreadable final total requires manual confirmation instead of an earlier subtotal.
- A pending BoQ read finishes before Continue, or the user explicitly selects manual
  entry. Floor-plan reads cannot cancel a BoQ result. Drafts retain the source amount,
  currency and filename; missing readings never become estimator budgets.
- BoQ projects preserve their source amount/currency and a fixed FX snapshot. The
  confirmed amount is allocated in source units using largest remainders. USD values
  retain nine decimal places so both currency totals reconcile. Payment-provider
  requests continue to use their own supported precision.
- Client and contractor screens use saved allocations. Zero-percent stages remain
  zero. Historical stages are complete and keep their allocation; they never create
  expected funding requests. Historical value, remaining work and actual payments are
  distinct. Groundwork fee rows are zero for BoQ projects.
- All authentication entry points resume the same invitation. Safe return URLs carry
  context across devices and password setup. Pending state is removed only after
  successful acceptance; repeat acceptance by the same account is safe. The verified
  account email must match the invitation. Project lists merge owned, shared and
  contractor relationships, retaining successful results when another lookup fails.
- Invitation email language uses the recipient's saved preference, then the sender's
  current interface, then the sender's saved preference. Initial account language is
  persisted, including English. Local development runs the production handlers.

## Rollout

Apply these migrations **before deploying the frontend**:

1. `20261111000200_confirmed_boq_budget.sql`
2. `20261111000300_invitation_acceptance.sql`

The first migration adds the source budget and native stage allocations, installs the
atomic confirmation RPC and rejects later changes that break the confirmed schedule.
It drops and recreates the existing funding trigger within the transaction before
changing milestone precision, as PostgreSQL requires for an `UPDATE OF` dependency.
Legacy BoQ pricing mode is recorded independently of document fetching. Former fee
amounts are retained in `boq_waived_amount_usd` before the fees are waived; payment
markers and settled ledger rows are preserved.

The known Penthouse project's incorrect HT budget is corrected only if its document
name and existing amount match the reviewed case and no settled payments would be
changed. Other legacy projects retain their existing budget until their source total
is verified; the migration does not invent a document amount or historical FX rate.
Any future revision to a confirmed bill must update its source budget and allocations
in one transaction; a USD-only stage edit that contradicts the bill is rejected.

Check Supabase's auth redirect allowlist permits the production callback and its
invitation query parameters. Application invitation emails use Resend; Supabase's
separate authentication templates remain dashboard-managed.

## Verification

```sh
pnpm typecheck
pnpm build
pnpm test
pnpm test:boq-db
```

The database regression uses temporary PostgreSQL storage and a standalone backend;
it opens no listener and needs no production credentials. It executes the actual
migrations and confirmation/join functions against a minimal fixture schema. Install
PostgreSQL server binaries, or set `GROUNDWORK_PG_BIN` to their directory.
The fixture installs the existing funding trigger before the migration and verifies
that the old operation fails with `0A000` before testing the corrected upgrade.

Coverage includes the supplied workbook through draft restoration and allocation,
manual French/English entry, exact totals, zero stages/fees, historical values without
funding requests, owner/partner/admin guards, fixed FX and idempotent retries,
recipient matching, both invitation directions, cross-device return context, dual-role
project lists, failed language writes and local/production email-handler parity.
