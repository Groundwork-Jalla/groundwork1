# Contractor evidence, client review

The client screenshot showed an evidence uploader and removal controls alongside
Approve updates. The shared substage component gated its editor on stage/payment
state, and the project page also admitted primary clients to the uploader. The
submission RPC admitted project owners, while legacy owner/member policies allowed
file and evidence-index writes.

## Implemented rule

- Accepted contractors on the project upload construction evidence. Client ownership,
  an account-level contractor role, observer access and a pending/revoked invitation
  do not grant evidence authorship.
- Clients see the contractor's openable photos/documents and approve updates.
  Empty work items explain that contractor updates will appear. The evidence editor
  and its removal controls are absent from their view.
- The project page obtains the permission from accepted project membership and
  passes it explicitly through the tracker and substage. Upload components default
  to no editing permission. Existing stage order, funding, pause and review gates
  still apply to contractor uploads.
- The database checks the contractor assignment before submitting or retrying a
  site update. Direct evidence-index additions, replacements and removals also
  require that assignment; reviewed evidence stays fixed.
- Restrictive storage policies prevent older owner/member policies from granting
  clients construction-file upload, replacement, rename or deletion rights. File
  read policies remain available for review. The client's payment receipts use the
  separate `/receipts/` path and retain the project-client upload permission.
- Existing construction evidence, BOQ values, receipt histories and stage approvals
  are retained. No production data was changed during local verification.

## Release

Apply `20261112000800_contractor_stage_evidence.sql` after migration 007, then release
the updated frontend. Apply each new migration once; earlier migrations need no
replay. The migration updates submission/index guards and storage policies in one
transaction.

The SQL requires the same database/storage policy privileges used for the earlier
receipt-proof migration. It does not silently skip a failed storage-policy update.

## Verification

- `pnpm test:evidence-db`: passed in a disposable PostgreSQL instance using real
  authenticated RLS and the actual membership, stage, payment and new migration
  functions. Covers clients, assigned contractors, contractor-created projects,
  global contractors invited as clients/observers, revoked/pending invitations,
  verifier/staff readers, receipt uploads, approved-proof protection and safe retries.
- Focused stage/review/receipt UI tests: 64 passed. Clients retain viewing and
  approval controls, and only assigned contractors receive the evidence editor.
- Full suite, typecheck and production build: final results recorded below.

After release, use separate client and contractor accounts on one project. Upload
evidence as the contractor, open it and approve it as the client, and confirm that
the client has no construction upload/removal controls. Repeat with a global
contractor invited as the project's client or observer, and check receipt upload
and the evidence-first contractor-created flow. These live checks require the
released application and have not been represented as completed locally.
