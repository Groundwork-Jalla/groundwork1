# Group F: project workspace, the seven other tabs (18 Nov 2026)

Design concept only. Illustrative data continues the Overview tab (Mbala Residence, Claire Mbala,
Bob Ousmane, Vanessa G., stage 5 under review, 600 XAF to the dollar). Every page reuses
`workspace-desktop.html`'s header and tab bar unchanged, with the active tab switched. Dialog
PNGs show the dialog over the dimmed tab it opens from.

| Tab | Desktop | Phone | Dialogs |
|---|---|---|---|
| Stages | `ws-stages-desktop` | `ws-stages-mobile` | `ws-stages-record-verification-desktop`, `ws-stages-confirms-desktop` (Approve, Request verification picker, Request changes, Mark paid) |
| Financials | `ws-financials-desktop` | `ws-financials-mobile` | `ws-financials-ledger-desktop` (Authorise release, Confirm received, Open reconciliation) |
| Site updates | `ws-site-updates-desktop` | `ws-site-updates-mobile` | none |
| Documents | `ws-documents-desktop` | `ws-documents-mobile` | none |
| Conversations | `ws-conversations-desktop` | `ws-conversations-mobile` | `ws-conversations-record-decision-desktop` |
| Activity | `ws-activity-desktop` | `ws-activity-mobile` | none |
| Team | `ws-team-desktop` | `ws-team-mobile` | `ws-team-dialogs-desktop` (Assign verifier, Remove verifier, Make primary homeowner) |

**One figure differs from the Overview mock-up.** `workspace-desktop.png` shows Authorised $0 and
Disbursed $27,667. No provider has ever written to the ledger (`stage-money-flow.ts`), so a release
cannot get past "Release authorised". The Financials tab shows it truthfully: Authorised $27,667
(stages 1 to 4), In transit $0, Disbursed $0. Budget, Funded and Available to release stay as on
the Overview ($100,000 / $39,333 / $11,667). The Overview mock-up should be changed to match.

---

## 1. Stages

**Idea.** The six-step loop becomes a horizontal progress rail (done, current, blocked, part-done),
so the stage's position shows at a glance. Under the rail, a **Next action** card holds the one or
two live acts. Each act that is offered but held appears as a locked line with the database's
reason. The six step details sit underneath as a 2×3 grid instead of a long list.

**Checklist (from `StagesTab.tsx`, `stage-actions.ts`, the modals)**
- Ladder: every stage, its lifecycle badge, the selected stage highlighted, links to `?stage=`. **Kept**, with the milestone added per row and a progress bar in the header (both already in the model).
- Empty, with no stages: "No planned dates recorded on the stages." **Kept** (same text in ladder and detail; not drawn).
- Head: eyebrow "Stage n", name, lifecycle badge, each blocker except on_hold, "Approved {date}" when complete. **Kept**; the milestone moves into the head.
- Action row: shows only offered acts, and disables the rest while any act is busy.
  - Request verification. Offered when the stage is pending review, verification is required, the state is `verification_pending` and no request is open. Held with "Verification needs migration 087…" (087 missing) or "No verifier is assigned…" (no verifier). Opens the inline verifier picker (verifier — discipline) and its Request verification button, disabled until a verifier is chosen. **Kept**; the picker is drawn in `ws-stages-confirms`.
  - Record the verifier's decision. Offered and live while a request is open. **Primary button in Next action.**
  - Approve stage. Offered when the stage is pending review, live once verified, otherwise held with approveBlocked. **Locked line under the buttons** (the stage-5 state).
  - Request changes. Offered whenever the stage is pending review. **Secondary button.**
  - Mark paid. Offered on a locked stage whose tranche is `expected`, held when the ledger is missing. Confirm dialog with the receipt-count sentence. **Kept** (`ws-stages-confirms`).
  - Confirm received. Offered when the stage is approved and awaiting funding with an expected tranche; held when the ledger is missing or there is no tranche. Opens LedgerModal "confirm". **Kept**: it appears in Next action when offered (dialog in `ws-financials-ledger`).
  - Authorise release. Offered on a complete stage with a milestone and no live release; held for ledger missing, no contractor, payout blocker (4 reasons), on hold, insufficient funds or not verified. **Kept**: Next action when offered, described in the Release step.
  - Approve and Authorise release keep the filled (primary) style. Held reasons are shown inline, not as tooltips. The refusal text (role=alert) goes under the buttons, in the database's words.
- Step 1 Work: substages with status dot and label; "No substages on this stage." **Kept.**
- Step 2 Evidence: up to 12 files, each opening a signed URL, unsigned ones marked; the site-update lines (who · when · description); the DomainNote states; "No evidence uploaded." **Kept**, as thumbnails.
- Step 3 Verification: every verification with decision colour, verifier, when, requested by, visited or not, certificate, findings, and the on-behalf line with its reason; plus "Not required on this plan…", "No verification requested." and the DomainNote. **Kept.**
- Step 4 Approval: Approved {date}, ready to approve, blocked, not submitted or not reached. **Kept.**
- Step 5 Funding: milestone, tranche state, staff or provider source, "No milestone…", "No tranche…", DomainNote. **Kept.** *Added:* the stage's parts listed with a received bar (the rows exist in `fin.payments`; today only one tranche shows).
- Step 6 Release: amount, state (failed in red), to whom, authorised by and when, failure reason, "No release recorded.", DomainNote. **Kept.**
- Modals: RecordVerificationModal (decision verified / rejected / needs more, visited checkbox, findings, mandatory reason, errReason and errVisit) is drawn with radio cards instead of a select. Approve ConfirmModal, ReworkModal ("Explain what needs to be corrected. The homeowner will be notified.", Send feedback disabled until text is written) and MarkPaid ConfirmModal are drawn. LedgerModal is drawn in Financials.

**Dropped:** nothing. "Open in Overview" is a new link back to the same stage.

## 2. Financials

**Idea.** Answer "where is the money" before anything else: one bar of the budget (authorised,
available, not yet funded) above the six figures. Next comes the provider banner, then one table
where each stage row shows its milestone, a four-leg money journey, its lifecycle and its one
action. The detailed ledgers (Funding, Disbursements), the read-only sections and Costing follow.

**Checklist (`FinancialsTab.tsx`, `MoneyFlow.tsx`, `RepriceCard`, `StagePricingPanel`, `BudgetView`)**
- Ledger unavailable or error: the DomainNote, with only Fees and Costing below. **Kept** (not drawn).
- Six figures: Budget (dash when no budget), Funded, Available to release (emphasised), Authorised, In transit, Disbursed. **Kept**, with XAF underneath. *Added:* the budget bar.
- MoneyFlow: title, subtitle and the noProviderNote banner with Open Integrations (shown when no provider). For each stage: number, name, milestone or "No milestone", and four legs (Homeowner → Groundwork, Release authorised, Groundwork → provider, Provider → contractor). Each leg shows its state (Not yet, In progress, Done, Failed, Under review, No provider connected, Not scheduled), amount, date and actor. **Kept**; the journey is now a column of the stage table.
- Releases table: Stage (links to Stages with the stage selected), Milestone, Funding state, Legacy projection (with its hint), Lifecycle, Release (state · amount), and Authorise release. That button is shown when the stage is complete, has no live release and has a milestone; it is disabled with "No accepted contractor…" when nobody can be paid. **Merged into the same table**: Funding state and Release state are legs 1 and 2, the legacy projection is a muted line under the lifecycle, and Authorise release sits in the Action column (the rule is written under the table, because no stage qualifies in this data).
- Funding list: amount, state, stage, source (staff or provider), "Not yet received", note, and Confirm received on expected rows; empty text. **Kept** (first 9, then "Show all 13").
- Disbursements: amount, state colour, stage, beneficiary, authorised by, provider and reference, failure reason, note, and Open reconciliation on failed rows; empty text. **Kept.**
- Compensation: honest empty. **Kept.**
- Reconciliation: loading, error, unavailable, empty; events with provider · type · amount · stage, when, provider event id, and outcome (applied, or unmatched / illegal / unknown in red). **Kept** (empty state drawn).
- Fees: kind · amount · projection · paid when; empty. **Kept** (empty, since the project is priced on its bill).
- Costing: StagePricingPanel (read-only for staff, proposal history and status, current total) and RepriceCard (Preview recalculation, then a preview table, Apply to N stages and Cancel, plus the noTakeoff / noBudget / noChange / notBalanced / done messages; shown only when `pricing_revision` is 0). Then Edit bill of quantities, and BudgetView: total with the rate note, PDF export, the slices (only construction when priced on a bill), the low-estimate warning, the disclaimer or bill note, the takeoff comparison, the Total budget and Completed-before-Groundwork boxes, and the stage schedule. **Kept**, in two columns. Edit bill of quantities and PDF move to the section header.
- LedgerModal (confirm / authorise / reconcile: amount, beneficiary, note, refusal text, buttons disabled while busy or invalid). **Drawn.** *Added in the authorise dialog:* a three-figure context strip (milestone, funded for this stage, live release) and the beneficiary's payout status line. Both come from data the page already loads.

**Copy concern:** the money-flow leg label "Homeowner → Groundwork" (en.ts `admin.flow.leg.funding`)
reads as if Groundwork holds the money, which the custody rule forbids. Kept here because it is the
real label. Suggest "Homeowner → provider", matching `fundingSub`.

## 3. Site updates

**Idea.** A photo-first feed grouped by day: each update is a card with its author, the stage pill
and large thumbnails. A right rail filters by stage and by reporter. Read-only, as today.

**Checklist (`SiteUpdatesTab.tsx`)**
- Unavailable or error DomainNote; empty state "No site update yet" with its body. **Kept** (not drawn).
- Per update: who (or "Unknown account"), relative time with the exact time on hover, the "Stage n · name · substage" link to Overview, the description or "No description — files only.", and the evidence (12 max, signed on demand, unsigned marked). **Kept**: evidence becomes real thumbnails, and unsigned ones say "Could not be opened".
- *Added:* day grouping, stage and reporter filters with counts (client-side over rows already loaded), and the empty-state sentence moved into the rail as a standing note.

## 4. Documents

**Idea.** A grouped grid with previews (first-page tile for PDFs, image for photos), groups flowing
side by side so a project with one file per category fits on one screen. A toolbar holds search,
category chips and a grid/list toggle.

**Checklist (`DocumentsTab.tsx`)**
- Order boq, contract, permit, report, invoice, receipt, site_photo, other; categories with no files are hidden; each group shows its count. **Kept.**
- Read-only note. **Kept**, under the toolbar.
- Per file: type icon, name, size · date · uploader · stage link (to Overview), and the download link (pending, unsigned with the "could not be opened" tooltip, or open in a new tab). **Kept**; the unsigned reason is also printed on the card.
- Unavailable, error and empty states. **Kept** (not drawn).
- *Added:* search, category chips and the grid/list toggle (all client-side). The previews need the signed URL the page already fetches.

## 5. Conversations

**Idea.** Three panes: threads, the open thread, and the decision log beside it. A decision is read
next to the conversation that produced it.

**Checklist (`ConversationsTab.tsx`, `ConversationThread.tsx`, `RecordDecisionModal.tsx`)**
- Empty state with "Start the project thread" (and its error); unavailable or error DomainNote. **Kept** (not drawn).
- Thread list: status dot, subject or channel, status · channel · assignee · last message. **Kept.**
- Thread header: title, status, channel, resolved when. Assign select (Unassigned, or "No staff account to assign" when there are none) with an Assign button, disabled until the choice changes. Resolve (hidden once resolved). Record decision. **Kept.**
- Messages: loading, error, unavailable, "No message on this thread yet."; inbound left, outbound right; internal notes as full-width amber; attachments; "not delivered" on failed sends. Clicking a message makes it the decision source (highlighted, then quoted in the modal). The one-channel filter is used when the thread is embedded elsewhere. **Kept.**
- Composer: textarea ("Write to the homeowner…"), attach (size and type errors, upload failed), voice note, Send, Internal note with its hint; both disabled while empty or busy. **Kept.**
- Decisions list: subject, decision, related (kind · stage), recorded by, approved by, cost, schedule, Open thread, supersedes; empty, unavailable and error states. **Kept**, as the right-hand pane.
- RecordDecisionModal: the quoted source, Subject, Decision, Relates to (Budget / Stage / Design / Payment / Other, now as chips), Which stage (only for Stage), Cost impact (USD), Schedule impact (days), Approved by the homeowner with its hint (disabled when there is no owner), errRequired, Cancel and Record decision. **Drawn.**

## 6. Activity

**Idea.** A filterable timeline: entity-type chips with counts, a person filter and search above a
day-grouped feed. Each row has a coloured entity icon, the sentence, and the entity chip that deep-links.

**Checklist (`ActivityTab.tsx`)**
- Unavailable or error DomainNote; the empty title and body. **Kept** (the body is reused as a footnote).
- Per row: actor (or "Unknown account"), the action label, the person name, the amount, the entity chip with stage number and a chevron when it links, and relative time with the exact time on hover. Rows with a tab are links (Stages with the stage selected); rows without one are plain. **Kept** ("changed the plan" is drawn as a non-link row).
- *Added:* the entity and person filters, search, day headers and "Show older". This is new behaviour, client-side over `ws.activity`. If the loader caps rows, "Show older" needs a paged read.

## 7. Team

**Idea.** People grouped by role (Homeowner, Contractors, Verifiers) with avatars. Payment details
sit directly under the contractor who is paid. The homeowner-role card and a real assignment
timeline go on the right.

**Checklist (`TeamTab.tsx`, `TeamCard.tsx`, `ContractorPayoutCheck.tsx`, `PrimaryClientCard.tsx`)**
- Header: Team, subtitle, Assign contractor (opens the inline email form) and Assign verifier (only while 086 is available). **Kept**; the form is drawn open: email, Assign (disabled while empty or busy), the hint, and the error line.
- Project creator: name · email, or "Unknown account". **Kept.**
- Contractors: name, email, invite status (Invited / Accepted / Declined), accepted when. The ★ "Paid for this project" badge, or "Pay this contractor" only on an accepted row with an account. "No contractor assigned yet." **Kept**; the invited row says why it cannot be paid.
- Payment details on file (primary contractor only): loading, unavailable, none; each live destination with method (mobile money or bank · bank name), masked number, account name, Checked or Awaiting check plus "Mark as checked" (Saving…), errors, and the hint. **Kept.**
- Verifiers: name · discipline · status, with remove (×) only when active (confirm, then the removed / failed / not-admin notices); "No verifier assigned yet."; unavailable. **Kept.**
- Homeowner role card: title and body, the "Primary homeowner · name" or "Awaiting the primary homeowner invitation." line, each viewer (email, Primary homeowner or Observer, Pending) with Make primary homeowner on accepted observers, the ConfirmModal, "No homeowner or observer invitations…", loading, and the error with Retry. **Kept.**
- Assignment history: each contractor (invited, accepted) and verifier (discipline, assigned, removed shown as "Declined"), the empty and unavailable states. **Kept**, as a timeline.
- AssignVerifierModal (verifier, discipline, errors). **Drawn.**
- *Changed:* verifier removal uses `window.confirm` today; it is drawn as a proper dialog. *Added:* the "has an open verification on stage 5" warning in that dialog (derivable from `ws.stages`).
- **Copy bug:** a removed verifier's history line says "Declined" (`inviteStatus.rejected`). It should say "removed {when}" (`removedWhen` exists in en.ts but is unused).

---

## Open points
- Several helper lines in the mock-ups are explanations for reviewers, not product copy: "Shown only when…", "Today this is a browser confirm…", and the rule under the Financials table.
- Request-changes body and its "Send feedback" button are hard-coded English in `ReworkModal.tsx`, not in en.ts.
- On a phone the long sections (Financials ledgers, Assignment history, the step details) collapse to rows that open them. None is removed.
