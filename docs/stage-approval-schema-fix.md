# Stage approval: missing database columns

The approval screenshot reports PostgreSQL error `42703`: `approved_by` does not
exist on `public.project_stages`. Migration 004 added approval metadata only to
`project_substages`. The later stage-approval functions also write `approved_by`
and `approved_at` to the parent stage, but their corresponding table change was
missing. The local database fixtures pre-created those fields and masked the gap.

When the last work item calls stage approval, that missing column aborts the
transaction. The last approval stays incomplete and its payment remains gated.
Previously saved photos and separately completed work items are retained.

## Repair

Run `supabase/migrations/20261112000900_stage_approval_metadata.sql` in the Supabase
SQL editor after migration 008. Then refresh the project page and retry the final
Approve updates action. This repair requires no frontend deployment.

The migration adds nullable UUID/timestamp fields, leaves existing progress, money
and evidence intact, and reloads the API schema. Unknown historical approvers/dates
stay NULL. Approval RPCs write attribution; ordinary direct writes cannot forge
it. Reapplying this repair preserves existing columns and recorded approvals.

## Regression verification

The stage, reviewed-payment and evidence-permission PostgreSQL suites now start
without stage approval columns. They install the existing approval functions,
reproduce the same undefined-column failure, apply the actual repair migration,
and successfully retry the same approval RPC. They also verify historical values,
approval attribution, direct-write protection, and safe migration reapplication.

Passed locally: `pnpm test:stages-db`, `pnpm test:review-db`,
`pnpm test:evidence-db`, and `git diff --check`. No production migration was run.
