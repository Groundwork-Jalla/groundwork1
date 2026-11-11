# November product review implementation

This completes the local application work from the 11 November review, alongside
the earlier BOQ, invitation and receipt fixes. The requirements checklist is in
[product-review-remaining.md](product-review-remaining.md).

## Resulting behaviour

- Both project participants read the confirmed BOQ budget, saved native allocations
  and saved currency conversion. Uploaded BOQs carry no additional Groundwork fees.
  Historical stages retain their allocation and completed status; zero-weight stages
  remain zero. Receipt payouts are separate from those scheduled values.
- The client overview keeps summary figures, the current action, actual payouts,
  weather and project dates. The two latest-update cards are removed. Costing has
  one combined stage/payment schedule, showing work approval separately from actual
  receipt acknowledgment. Client sign-off says Approved/Approve updates. Historical
  work says Completed before tracking.
- Financial figures show the project currency with a USD equivalent. Primary
  actions use the contractor green; progress distinguishes green completion, dark
  active stages and pale locked stages. Empty evidence explains where contractor
  uploads will appear, without flashing.
- The dashboard retains other projects and Messages/Documents actions. Its cost
  allocation and Upload updates sections are removed. Filtered empty lists explain
  the selected filter. A stage-read failure offers retry instead of presenting a
  financial summary; late reads cannot replace a different project's schedule.
- Building classification can be corrected at final confirmation without resetting
  an uploaded BOQ's confirmed amount, currency or FX snapshot.
- Actual documents and site evidence open in the application. Completed stages do
  not manufacture document or certificate entries. Certificate controls require an
  actual unrevoked issued PDF, including in the dashboard document vault. Failed
  reads and cancelled file opens do not create phantom empty states or reopen files.
- Spreadsheet previews support XLSX, XLS, CSV and ODS, using saved values at their
  stored numeric precision. Parsing runs in a disposable worker. Preview limits are
  20 MB, 12 sheets, 200 rows, 40 columns and 2,000 characters per cell, with a 12-second
  deadline and a visible truncation notice. The original download stays available.
  SheetJS uses its [official distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/).
- BQ authoring is available to assigned contractors and admins, with matching route
  and database permissions. The editor remains in the contractor/admin workspace;
  legacy links redirect there. Client access to uploaded BOQ documents remains. Clients
  and observers cannot author drafts; revoked contractors lose editing access even
  to their own rows. Contractor submissions freeze their figures; subsequent
  revisions require a new draft. Draft authoring never changes the agreed budget.
- Authoring actions say Edit bill of quantities. Sharing says Share this project
  and remains in the project Team tab. Unpublished videos are hidden from the
  catalogue and direct article routes. Dashboard MFA setup prompts are hidden while
  password-recovery prompts and account security settings remain available.

## Release requirements

Apply unapplied migrations in repository order before deploying the application.
The relevant sequence, after the existing project schema, is:

1. `20261111000000_a_bill_is_the_whole_project.sql`
2. `20261111000100_home_2_from_its_bill.sql`
3. `20261111000200_confirmed_boq_budget.sql`
4. `20261111000300_invitation_acceptance.sql`
5. `20261112000000_receipt_payment_amounts.sql`
6. `20261112000100_ordered_stage_progression.sql`
7. `20261112000200_project_team_permissions.sql`
8. `20261112000300_boq_editor_access.sql` — new BQ authoring permissions and capability.

The confirmed-BOQ migration includes the earlier trigger-dependency correction.
Do not replay migrations already recorded as applied. No production migration,
deployment, real invitation or external email was performed during this local work.

## Validation

Final typecheck, build, regression-suite and database results are recorded below
after execution. Database checks use temporary local PostgreSQL instances.

## Live acceptance after release

Use separate client and contractor accounts to create a BOQ project from each role,
accept the invitation after signing out/in, and compare the budget, USD equivalent,
stage allocations and Team roles. Repeat with a mid-build project and zero-weight
stages. Upload a negotiated receipt amount different from its allocation, acknowledge
it as the contractor, then approve work and check the next-stage payment prompt.
Check English and French invitation delivery using actual recipient preferences.

Open actual spreadsheet, photo and PDF uploads from both participant views. Confirm
historical stages without uploads/issuance produce no media or certificates, that
only contractors/admins have BQ authoring controls, and that submitted/revoked access
is enforced. These authenticated live checks require the released application and
have not been represented as completed by unit or local database tests.

Philip's invitation-copy review and Ruth's follow-up meeting are external review
actions from the meeting notes. No messages or meeting invitations were sent.
