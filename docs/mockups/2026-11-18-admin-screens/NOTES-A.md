# Group A: Work + Finance (18 Nov 2026)

Design concept only. Nothing under `src/` or `api/` was changed. Illustrative data; amounts are USD
because every figure on these pages comes from `formatUSDFull`.

| Screen | Route | Files |
|---|---|---|
| Site updates | `/admin/site-updates` | `site-updates-desktop.png`, `site-updates-mobile.png` |
| Inspections | `/admin/inspections` | `inspections-desktop.png` (today, honest empty), `inspections-proposed-desktop.png`, `inspections-mobile.png` |
| Tasks | `/admin/tasks` | `tasks-desktop.png` (today, honest empty), `tasks-proposed-desktop.png`, `tasks-mobile.png` |
| Inflows | `/admin/finance/inflows` | `inflows-desktop.png`, `inflows-mobile.png` |
| Disbursements | `/admin/finance/disbursements` | `disbursements-desktop.png`, `disbursements-mobile.png` |
| Budgets & fees | `/admin/budgets` | `budgets-desktop.png`, `budgets-confirm-desktop.png`, `budgets-authorise-desktop.png`, `budgets-mobile.png` |

---

## 1. Site updates — `/admin/site-updates`

**Idea.** A log, so a filterable timeline: updates grouped by day, each a card with the project,
stage and substage, what was said, photo thumbnails and who reported it. A right rail breaks the
current view down by project and by reporter; both lists also act as filters.

| Today (site-updates.tsx) | Where it is now |
|---|---|
| Title + subtitle | Page header |
| Project filter (`?project=`, "All projects") | Header select, top right |
| Reporter filter (`?reporter=`, "Everyone"; hidden when there are no reporter names) | Header select; shown filled with an × to clear. Also the "Who reported" rail |
| Filters shown only when there are rows | Unchanged rule |
| Tiles: All updates / With photos or files / Last 7 days / Last 30 days, with counts | Segmented control under the header, counts in mono |
| Row: project name (or "Unknown project") | Card title |
| Row: Stage n · stage name · substage | Card title, secondary text |
| Row: description (pre-wrapped) | Card body. No description → "No description — files only." (key from the workspace tab) |
| Row: reporter (or unknown account) · relative time (full date on hover) · n file(s) | Card meta line |
| Row opens `/admin/projects/:id?tab=site-updates` | Whole card plus "Open in project ›" |
| Loading, error, "not available yet" (migration), empty, no match | Same states in the feed column; not drawn |

**Added.** Day headings (Today / Yesterday / date). Photo thumbnails (needs signed URLs for
`evidence_paths`; today only the count shows). The "Projects in this view" and "Who reported"
rails (counts derived from the loaded rows). A note that the feed does not approve, with a link to
Reviews & Approvals (from the page's own code comment). A line saying the 200 most recent are
loaded (`listAllSiteUpdates(limit = 200)`). **Dropped.** Nothing.

## 2. Inspections — `/admin/inspections`

**Idea.** Today this is a placeholder, so the main image is a useful empty state: what the page
will hold, why it is not built (the 02 §2.4 decision: the verification standard decides whether an
inspection differs from a verification; until then a stage verification already carries the visit
date and checklist), and three links to where the information lives today. The proposed image
is a board, since a visit is a pipeline: Requested → Visited, decision pending → Needs more
evidence → Verified, with the selected visit's checklist on the right.

| Today (placeholder.tsx) | Where it is now |
|---|---|
| Title (`nav.inspections`) | Page header |
| Body (`admin.placeholder.body`) | Lead under the title |
| "Until then, see …" link (`existingTo`) | Inspections has none today. **Added** three: Reviews & Approvals, Verifiers, Projects (the Stages tab) |
| Overview card copy (`admin.inspections.empty`) | Reused as the empty-state sentence |

**Proposed (labelled "Proposed — needs a data source").** Columns map to `stage_verifications.decision`
(`pending` with and without `visited_at`, `needs_more_evidence`, `verified`); the checklist is
`stage_verifications.checklist`. Most of it could be read from 087 today; the "Request a visit"
button, the calendar and the per-visit photos would need new work.

## 3. Tasks — `/admin/tasks`

**Idea.** Same honest empty state: what a task is (title, owner, priority, due date; linked to a
project, stage or conversation; open / done / cancelled), why the Action Center does not replace
it (computed items versus promises state cannot see), and where to-dos live today. The proposed
image is a queue grouped by due date (Overdue / Today / This week) with the selected task beside it.

| Today (placeholder.tsx) | Where it is now |
|---|---|
| Title (`nav.tasks`) | Page header |
| Body (`admin.placeholder.body`) | Lead |
| "Until then, see …" link | Tasks has none today. **Added**: Action Center, Communications (follow-ups with a next contact date), Inbox (assign and resolve) |

**Proposed.** Fields follow the deferred `tasks` contract in `docs/groundwork-admin/02` §2.4:
`assigned_to`, `created_by`, `created_from` (manual · conversation · verification · inspection),
`status` (open · done · cancelled), `priority`, `due_at`, optional project / stage / conversation.
Filters Mine/Everyone, status, priority, source, project. Actions: New task, Mark done, Reassign,
Change due date, Cancel.

## 4. Inflows — `/admin/finance/inflows`

**Idea.** Money, so figures, then a table, then status. Confirmed received is the green hero;
Expected funding sits beside it in amber and says it is never added to received. Received /
Expected is a segmented control beside the search. The row's inline expansion becomes a detail
panel on the right, so the table stays scannable.

| Today (FinanceLedger direction="in") | Where it is now |
|---|---|
| Title, subtitle | Header |
| Degraded notice (`admin.finance.degraded`) | Amber strip under the figures (shown, as a conditional) |
| Figures: Confirmed received, Expected funding, Movements | Three stats |
| Tabs: Received / Expected | Segmented control with counts |
| Search (project, person, stage, provider reference, note, amount) | Search field, same placeholder |
| Row: arrow, party (or "Account not readable"), project (or "Project not readable") · Stage n name / purpose / "Purpose not recorded", amount, state label + tone, dated label (Paid / Confirmed / Recorded …) | Table columns Homeowner, For, Amount, Status tag, When |
| Expanded: Confirmed by, Receipt established (provider / staff), Provider reference, Why it failed, Note, Open project financials | Detail panel |
| Loading, unavailable ledger, empty per tab (noInflow / noExpected), noMatch | Unchanged; not drawn |

**Added.** Counts on the tabs; a one-line custody note in the panel (Groundwork records, SwyChr
moves). **Dropped.** Nothing. Mobile shows the Expected tab with one row expanded.

## 5. Disbursements — `/admin/finance/disbursements`

**Idea.** The real work here is filing the SwyChr transaction ID for each approved release, so
that is the obvious primary action: a banner counts the releases still without one, those rows sort
first and say "No transaction ID", and the selected row's panel puts the Record form up front.

| Today (FinanceLedger direction="out") | Where it is now |
|---|---|
| Title, subtitle, degraded notice | Header; notice as on Inflows (not drawn here) |
| Figures: Release approved, Processing (initiated + reconciling), Paid, Payment issue (failed) | Four stats with row counts |
| Search | Search field |
| Row: party, project · stage / purpose, amount, state (Release approved, Processing, Paid, Payment issue, Under review), dated label | Table |
| Expanded: Authorised by, Provider reference, Why it failed, Note | Detail panel |
| Record the SwyChr transaction: label, hint, ID field, Record (disabled under 4 characters), server error codes translated (or shown raw) | Green-bordered form in the panel; mobile shows it disabled while empty |
| Form only where the server would accept it (outgoing, authorised, no reference yet) | Same rule |
| Open project financials | Panel button |

**Added.** The "need their transaction ID" banner, need-first sorting, the state chips (All /
Release approved / Processing / Paid / Payment issue / Under review) and row counts on the
figures. They filter what is already loaded. **Dropped.** Nothing.

## 6. Budgets & fees — `/admin/budgets`

**Idea.** Three jobs on one page, so it is a sectioned page with a sub-nav on the left (Budget
confirmations, Financial operations, Funding & releases → Funding, Releases), each with a count.
The queue that blocks a build from starting comes first, with a green Set budget on each row.
Financial operations becomes a totals strip and a worst-first table. Funding and Releases sit side by side.

| Today | Where it is now |
|---|---|
| Title "Budget Confirmations" + subtitle | Section 1 heading. The page title is the nav label "Budgets & fees" |
| Pending list: icon, name, open-project link (`/projects/:id`), owner name or email · country, Estimate (or —), Set budget | Table: Project (+ ↗), Homeowner, Country, Estimate, Set budget |
| Loading, empty ("All caught up" + budgetsEmpty) | Unchanged; not drawn |
| Confirm modal: title, project · owner, Wizard estimate + sub, Confirmed budget field ($, en-US grouping), higher/lower than estimate by $ and %, error, note, Confirm & Start (Starting… while busy), close | `budgets-confirm-desktop.png` |
| Financial operations: title, subtitle, totals Funded / Expected / Release authorised / In transit / Disbursed | Section 2 totals strip |
| Per-project rows: name, attention badge (Release failed / Reconciliation required / Awaiting release), owner · budget or "no confirmed budget" · "nothing recorded yet" / "awaiting funding"; Funded / Available / Disbursed, or Expected only; opens Financials tab | Section 2 table, chevron per row |
| Loading, error, ledger unavailable, empty | Unchanged; not drawn |
| Funding & releases: title, subtitle, unavailable | Section 3 heading |
| Funding rows: project link, stage, amount · state · confirmed by staff/provider · when · note; Confirm received when expected; empty | Funding card |
| Releases: project · stage · to name; amount · state · authorised by · when · provider + ref · failure; Open reconciliation when failed | Releases card |
| Release candidates: approved stage, milestone, "no accepted contractor" + disabled Authorise release | Releases card, under "Approved stages with no release yet" |
| LedgerModal (confirm / authorise / reconcile): title, body, Amount (USD), Beneficiary (contractor email), Reference or note, translated refusal, Cancel + action | `budgets-authorise-desktop.png` (authorise, with a refusal shown); the dialog notes the other two variants |

**Added.** "Waiting since" on pending budgets (the query already orders by `created_at` but does
not select it). The sub-nav with counts. **Dropped.** Nothing. The sub-nav is a long scroll page
with anchors, not tabs, so nothing is hidden.

---

## Unsure / for Favour

- **Budgets title.** The h1 today is "Budget Confirmations" though the sidebar says "Budgets & fees".
  I used the nav label as the page title and kept "Budget Confirmations" as the first section.
  The page has no "fees" content; fee settings may belong here later.
- **Thumbnails on Site updates** need signed URLs per file. That is a real cost on a 200-row feed,
  so they could be loaded lazily or only for the first rows.
- **Inspections proposed** is mostly readable from 087 today. If the verification standard decides
  that an inspection is a verification, this board could ship without a new table.
- **Disbursements "refresh it yourself"**: the attach hint promises a manual refresh, but this page
  has no refresh control, and a quick search found none elsewhere either. I did not draw one; either
  the hint's copy or the product needs a change.
- Dark mode not drawn (light only, as for the rest of the set).
