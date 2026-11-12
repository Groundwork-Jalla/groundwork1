# Follow-up review: payment and invitation workflow

Sources: the supplied follow-up transcript (11 November, meeting email generated
12 November 2026) and Gemini notes. Transcript decisions take precedence over the
generated summary. Earlier implemented behaviour remains in
`product-review-completion.md`; this document records the subsequent review.

## Observations and actions

| Observation | Agreed action | Evidence |
| --- | --- | --- |
| Payment controls appear above updates and offer payment before the relevant work review | Keep payment visible below the updates, disabled until the appropriate approval; preserve the initial payment exception for client-created projects | 00:11:04, 00:21:27, 01:04:34 |
| A reported six-digit rule does not establish sufficient funding | Accept positive amounts; make contractor acceptance, requests for top-ups and flags explicit | 00:13:22–00:18:55 |
| Current code has six-decimal precision validation, not a six-digit minimum | Clarify errors and exercise small positive amounts; do not introduce arbitrary minimums | Code audit of `confirmedBillAmount` and `StagePaymentGate` |
| A single acknowledgment does not capture incomplete payments or subsequent top-ups | Preserve each receipt, confirmed totals and decisions; let contractors accept a negotiated amount or keep work gated pending a top-up | 00:18:55 |
| Contractor-led ongoing builds are blocked waiting on a client’s first action | Contractor-created projects start with evidence; client-created projects start with payment | 00:28:42–00:31:39 |
| The first contractor-created receipt target was left ambiguous in the meeting | Pay the reviewed first live stage, obtain contractor confirmation, then proceed | User clarification: “Pay the reviewed first stage, then proceed” |
| File selection and receipt submission appear as competing calls to action | One Upload payment receipt entry point with file and camera options | 00:32:46–00:34:08 |
| The meeting claims receipts are read and matched, but current code only stores user input | Implement actual receipt extraction/matching, with explicit mismatch, unreadable and service-unavailable outcomes | 00:34:08 |
| Invitation delivery succeeds but project access/redirects block the full journey | Verify membership read-back before clearing the invitation; cover login, account switching and existing contractor accounts joining as observers | 00:37:15–00:45:58 |
| A contractor account joining as an observer needs the project on subsequent sign-ins too | List shared observer projects in the contractor workspace, without treating them as contractor assignments | Transcript role discussion and code audit |
| Invitation copy emphasises unavailable actions | Describe the permitted experience positively in English and French | 00:39:02–00:40:32 |
| A first-project prompt appears alongside existing projects | Use an accurate create-project tour prompt for returning users; preserve real first-project states | 00:09:33 |
| Overview cost presentation looks like the entire detailed costing screen | Keep a compact financial summary and link to full costing | 00:59:07–01:00:21 |
| Client stage design differs from contractor design | Share green completed/current styling and distinguish the current stage through its outlined marker | 01:03:14–01:05:27 |
| Groundwork messaging remains monochrome | Apply the shared green to the Groundwork messaging control | 01:07:03 |

## Implementation checklist

- [x] Compact overview summary; retain removed latest-update sections.
- [x] Shared client/contractor stage styling and green messaging.
- [x] Invitation acceptance, project read access and repeat-login visibility.
- [x] Positive invitation copy and accurate first-project prompts.
- [x] Receipt extraction and exact amount/currency comparison.
- [x] Persistent receipt history, top-ups, flags and contractor funding decisions.
- [x] One file/camera upload entry point below updates, with visible gated states.
- [x] Persisted creator-based workflow and matching frontend/database gates.
- [x] Local workflow, receipt, permission, BOQ and presentation regressions.
- [x] Typecheck, build and release instructions.

User clarification: **pay the reviewed first stage, then proceed**. For a
contractor-created project, the first live stage starts with evidence. The primary
client approves that work, then uploads the receipt for that same stage. The stage
stays current with work approved and payment pending until the contractor accepts
the receipt. Acceptance completes the reviewed stage and selects the next stage;
later stages follow the ordinary funding and approval cycle. Zero-cost stages
continue without a receipt. On mid-build projects this applies to the first live
stage, while earlier historical stages retain their saved status and allocations.

## Implemented behaviour

- Payment panels follow the stage updates. Future stages show the prerequisite;
  upload controls appear when payment is available, as clarified in the later
  [receipt currency follow-up](receipt-currency-follow-up.md). Client-created projects can upload the first live stage's
  receipt immediately; contractor-created projects start with evidence as above.
- Each receipt retains its actual native amount, saved FX/USD value, proof file,
  submission identity and contractor decision. A top-up adds a receipt instead of
  replacing the earlier proof. Confirmed partial money counts toward payouts while
  work remains gated; the contractor can request more, flag the proof, or agree to
  proceed with a negotiated amount. Agreement completes a reviewed first stage or
  opens an ordinary stage waiting on funding.
- One Upload payment receipt action offers file selection and camera capture. The
  server reads the stored private object, compares the entered amount in exact
  decimal units and requires the same currency. Ambiguous/unpaid/unreadable files,
  mismatches, oversized files and PDFs over five pages receive a specific outcome.
  Reading a receipt establishes document consistency; the contractor still confirms
  receipt of funds. This does not verify a payment with a bank.
- Database submissions require a recent server-issued reading bound to the actor,
  stage, amount, currency, file hash and storage object version. Browsers cannot
  create these readings or bypass them through the old submission RPC. Retries reuse
  the same receipt identity; recorded proof cannot be replaced or deleted.
- Invitation acceptance verifies the current session can read the project before
  clearing the continuation. Both invitation pages cancel stale preview reads and
  ignore acceptance results for a different token/account. Shared projects appear
  in the contractor workspace on subsequent logins; observer membership stays an
  observer membership. The new read policy exposes incoming receipts while keeping
  other beneficiaries' outgoing releases under their existing policies.
- The overview keeps a compact contract/payout summary with a full-costing link.
  Both participant views use the same completed/current stage marker and green
  Groundwork conversation controls. English/French invitation wording describes
  available actions, and the tour no longer calls a returning user's project their
  first one. Existing recipient-language selection remains in place.
- BOQ native totals, saved FX, zero-fee rules, zero-weight stages, and nonzero
  historical allocations remain unchanged.

## Release requirements

Apply only migrations not already recorded as applied, in order, after the earlier
`20261112000000`–`20261112000300` migrations:

1. `20261112000400_invitation_project_read_access.sql`
2. `20261112000500_review_payment_workflow.sql`
3. `20261112000600_receipt_amount_reading.sql`
4. `20261112000700_reviewed_first_stage_payment.sql`

Migration 007 incorporates the user's clarified first-stage rule. It supersedes
005's temporary assumption without editing or replaying 005/006. It adds a guarded
review/payment state, keeps the first receipt attached to the reviewed stage,
handles contractor acceptance and staff cash confirmation through the same
finalization path, and resumes a reviewed/paid stage only when its project resumes.
It preserves already completed history; older projects advanced under an earlier
workflow remain subject to the existing historical-data review process.

Release the application/API with these migrations. Set server-only
`ANTHROPIC_API_KEY` for the receipt reader; `RECEIPT_READER_MODEL` optionally overrides
its default model. Existing Supabase server URL, anon key and service-role key
configuration is reused. No new browser secrets or package dependencies are needed.
Without the reader key, new receipt submissions show a setup/unavailable message
and remain unsubmitted. Old application versions cannot bypass receipt reading after
migration 006, so refresh the application as part of the release.

The reader uses the existing authenticated `/api/events` dispatcher. Provider API
shapes were checked against the installed SDK and official
[model overview](https://platform.claude.com/docs/en/models/overview),
[PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support) and
[structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
No real receipt was sent to the provider during these local checks.

## Local validation

Verified on 12 November 2026:

| Check | Result |
| --- | --- |
| Full Vitest suite, two workers | 4,443 passed; zero failed or skipped |
| Final clarified-stage and audit regressions | 121 passed, including same-stage receipt prompts and stale-response protection |
| Final receipt-reader regressions after the exact-decimal cache fix | 16 passed, including the new large six-decimal retry case |
| `pnpm typecheck` | Passed after the final API/test changes |
| `pnpm build` | Passed; existing non-fatal chunk-size advisory remains |
| `pnpm test:boq-db` | Passed: exact native totals/FX, zero fees/stages, historical values and invitation acceptance |
| `pnpm test:receipts-db` | Passed: existing ledger amounts, acknowledgment and guards |
| `pnpm test:stages-db` | Passed: sequential approval, zero/history/sub-cent cases and idempotence |
| `pnpm test:team-db` | Passed under real authenticated RLS, including global-contractor observer reads, outgoing-release isolation and revocation |
| `pnpm test:review-db` | Passed after migration 007: same-stage first receipt, partial funds/top-ups, zero/final/mid-build stages, staff cash confirmation, prefunded successors, pause/resume, client approval attribution, exact proof binding and immutable proof files |
| `git diff --check` | Passed |

Database regressions use disposable local PostgreSQL databases and actual migration
functions. The team and follow-up suites use private Unix sockets to exercise real
authenticated row policies. Reader API/provider tests use fixtures and mocked model
responses; PDF page limits use actual generated PDFs. No production data or real
provider request is needed for these checks.

## Live acceptance after release

Use distinct client, assigned-contractor and observer accounts. Test invitations
when signed out, after signup, after switching accounts, and on a later login.
Compare native totals, USD equivalents, receipt histories and roles across both
views; repeat with an existing contractor joining only as an observer. Verify
English and French recipients get their own preferred language.

For projects created by each role, check the first action, review all work updates,
then follow the receipt prompt. For a contractor-created project, verify that the
first receipt names the stage whose updates were just approved and that later
stages stay locked until contractor acceptance. Upload a matching sample receipt, an
amount/currency mismatch, an unreadable image and a partial payment. Request a
second receipt, flag a receipt, and agree to proceed with received funds. Confirm
payouts sum each received receipt once, work stays locked until the contractor's
agreement, the reviewed first stage stays current until its receipt is accepted, and historical/zero stages retain their values. Repeat on a mid-build
project. Check the file/camera flow on a phone.

## Deferred and external actions

- Full prepaid-project/payment-history onboarding was explicitly deferred at
  00:21:27. Preserve existing recorded payments without adding that questionnaire.
- Philip provides a real test receipt and confirms the exact brand shade; retain
  the repository's shared brand token pending that confirmation.
- Philip and Ruth perform real-account invitation and payment acceptance tests
  after release. Synthetic fixtures do not replace that sign-off.
- The agreed work week is Sunday night through Thursday night, with reviews after
  morning stand-up and at end of day. This is a team cadence, not an application
  feature or authorization to send messages/calendar invitations.
- No production migration, deployment, external email or meeting invitation is
  performed by this local implementation.

## Client evidence permission clarification

Clients review construction evidence; accepted project contractors upload it. The
client-side uploader and removal controls have been removed, and migration 008
closes the matching submission, evidence-index and storage permissions. Client
payment receipt uploads keep their own permission. See
[contractor-stage-evidence.md](contractor-stage-evidence.md) for release and tests.

## Stage approval schema repair

Migration 009 supplies the stage approval columns omitted by the earlier schema.
Apply it after 008, refresh the project, and retry the failed approval. Existing
progress and financial values are retained; no frontend release is needed for this
SQL repair. The PostgreSQL fixtures now reproduce the reported undefined-column
failure before applying the repair. See
[stage-approval-schema-fix.md](stage-approval-schema-fix.md).
