# Phase 5 — Project Workspace `/admin/projects/:id` — design report (read-only)

**Status:** design for review, 13 September 2026. No code, no migration, no production change. Authoritative inputs: `01-information-architecture.md` (§1, §3 Projects/Stages & Reviews/Verification, §5, §6), `02-data-relationships.md` (§2.1–2.5, §3, §5), `03-workflows.md` (§2 lifecycle, §3, §5 Action Center, §6 RLS), `04-implementation-plan.md` (§3 lifecycle module, §5 Phase 5 row). Everything below reads from tables 084–091 created; nothing proposes a new source of truth.

---

## 1. What exists today

| Surface | File | What it is |
|---|---|---|
| Client project page | `src/app/routes/projects/detail.tsx` (534 lines) | Owner/contractor view: tabs `overview · stages · costing · timeline · payments · documents · messages`. Loads `fetchProject / fetchProjectStages / fetchProjectSubstages`; realtime on `project_stages` UPDATE. Owner actions: mark substage complete, upload evidence (088 RPC), approve stage (`approveStage` → 087/089 RPCs), invite contractor, upload/delete documents, chat (091 RPC), confirm payment (→ `funding_reported` bell). |
| Admin project list | `src/app/routes/admin/projects.tsx` (501) | Table with owner, tier, stage; **row link opens the client page** `/projects/:id` in a new tab; modals: assign contractor (029 RPC), assign verifier (086 RPC), delete (069 RPC). |
| Stages & Reviews | `src/app/routes/admin/reviews.tsx` (654) | Queue of `pending_review` stages: request verification picker, on-behalf decision modal (`RecordDecisionModal` — a *verification* decision, not a 091 decision), approve (087), request rework (089), site updates per stage (088). **Evidence links are the bare storage paths** (`sub.evidence_urls` → `<a href>`), so they do not open — see §11. |
| Payments & Budgets | `src/app/routes/admin/budgets.tsx` + `components/admin/LedgerPanel.tsx` | Pending budgets + the 090 ledger across all projects (confirm received, authorise release, open reconciliation). |
| Admin shell | `routes/admin/_admin-layout.tsx`, `components/shell/AppShell`, `nav-config.ts` (`ADMIN_NAV`) | `isAdmin` gate, notification bell, data-driven nav. |

**There is no admin view of a single project.** Every admin row that says "open project" opens the client-facing page with the owner's actions and none of the staff ones.

## 2. Data available per project (all live, 084–091)

| Domain | Table(s) | Read module | Admin read policy |
|---|---|---|---|
| Project, stages, substages, fees | `projects`, `project_stages` (+`verification_required` 086), `project_substages` (`evidence_urls`), `project_fees` | `projects.ts` | 009 `admin_select_all_*` ✓ |
| Evidence records | `site_updates` (088) | `site-updates.ts listSiteUpdates` | `members_read_site_updates` (admin arm) ✓ |
| Verification | `project_verifiers`, `verifier_profiles` (086), `stage_verifications` (087) | `verifiers.ts`, `verifications.ts` | ✓ |
| Money | `payments`, `payment_events` (090) | `payments.ts listProjectPayments` | `admin_read_payments` ✓ |
| Conversations, decisions | `conversations`, `project_messages` (+direction/channel/status), `decisions` (091) | `conversations.ts`, `messages.ts` | ✓ (`admin_select_all_messages`, `admin_read_conversations`, `admin_read_decisions`) |
| Activity | `project_audit_log` (+entity/person, 089) | *none yet* — `admin-overview.ts` reads the last 20 globally | `admin_select_all_audit_log` ✓ |
| Documents | `project_documents` (table) + `documents` bucket | `documents.ts` | table ✓ (009); **bucket ✗** — see §11 |
| Evidence files | `evidence` bucket | `approvals.getSignedEvidenceUrl` | **bucket ✗** — see §11 |
| Team | `contractor_invites` (+`contractor_user_id`), `project_verifiers`, `profiles` | `invites.ts`, `verifiers.ts`, `admin-users.ownerLookup` | 029 `admins_read_invites`, 009 `admin_select_all_profiles` ✓ |
| Certificates | `certificates` (079) | `certificates.ts` | ✓ |
| Derived | `stageLifecycle()`, `availableFunds()` (`src/lib/lifecycle/stage.ts`) | pure | — |

Every input `stageLifecycle()` needs — status, `verification_required`, latest verification, latest site update, the ledger, next-stage-started, project status — is readable by an admin today. Nothing new must be stored.

## 3. Reuse

| Reuse as-is | Reuse after extraction | Do not reuse |
|---|---|---|
| `stageLifecycle`, `availableFunds`, `STATE_SEVERITY` | `LedgerModal` (inside `LedgerPanel.tsx`) → `components/admin/ledger/LedgerModal.tsx`, scoped by project | `OverviewTab.tsx` (1312 lines, owner-perspective marketing of the budget) |
| `BudgetView` (read-only costing) | `RecordDecisionModal` (on-behalf verification) and `ReworkModal` from `reviews.tsx` → `components/admin/stages/` | `StageTracker` / `SubstageRow` (owner actions baked in: mark complete, upload) |
| `TimelineTab` (planned schedule, read-only) | Assign-verifier modal from `admin/projects.tsx` → `components/admin/team/AssignVerifierModal.tsx` | `ProjectChat` (one flat thread, owner bubbles; the workspace thread is per conversation with direction and internal notes) |
| `StatusBadge`, `EmptyState`, `ConfirmModal`, `formatRelative`, `formatUSDFull`, `useStageLabels` | `EvidenceGrid` from `reviews.tsx` → signed URLs, once §11 lands | `DocumentVault` upload/delete (storage policies are owner-only; read-only listing is reusable) |
| `listSiteUpdates`, `listProjectVerifications`, `listProjectVerifiers`, `listProjectPayments`, `listConversations`, `listDecisions`, `fetchDocuments`, `fetchProjectFees` | | |

## 4. Legacy UI: what changes, what does not

- `admin/projects.tsx`: the row link becomes `/admin/projects/:id`. The assign-contractor / assign-verifier / delete modals **stay on the list** (they are quick actions the IA keeps there) and are also reachable from the workspace Team tab via the extracted components. No deletion.
- `admin/reviews.tsx`: unchanged in Phase 5 except one addition — each card gets an *Open workspace → Stages* link. Re-pointing the queue is Phase 7 per the plan.
- `admin/budgets.tsx`: unchanged; `LedgerPanel` keeps serving the cross-project view; the modal is extracted, not moved.
- Client `projects/detail.tsx` and all `components/project/*`: **untouched.** Contractors and owners keep their page.
- `nav-config.ts`: **untouched** — IA §5: the workspace is not a sidebar item.

Nothing is removed in Phase 5. Removal of duplicated admin actions from the list page and the re-pointing of queues belong to Phase 7.

## 5. Information architecture of the workspace

```
/admin/projects/:id?tab=<overview|stages|financials|site-updates|documents|conversations|activity|team>[&stage=<stageId>][&conversation=<id>]

┌ Header ──────────────────────────────────────────────────────────────┐
│ ← Projects   Project name · owner (→ person) · tier · country/city    │
│ status · current stage n/10 · tracking since · last activity           │
│ current-stage lifecycle badge + first blocker                          │
│ quick actions (admin): Assign contractor · Assign verifier · Open      │
│ client view (new tab)                                                  │
├ Tabs ────────────────────────────────────────────────────────────────┤
│ Overview · Stages · Financials · Site Updates · Documents ·            │
│ Conversations · Activity · Team                                        │
└──────────────────────────────────────────────────────────────────────┘
```

Deep links are search params, so every queue row and Action Center item can open the right tab and the right stage (`?tab=stages&stage=…`) — IA §6 rule 1, "no dead ends". Tab state is in the URL, not component state.

## 6. Tab responsibilities

| Tab | Shows (read) | Admin acts (write, existing RPC) | Reads via |
|---|---|---|---|
| **Overview** | Header facts; stage ladder (10 chips, each its derived state); budget vs funded vs released vs disbursed (`availableFunds`); planned schedule (`TimelineTab`); open blockers list across stages; last 5 activity rows | none | everything in §2, computed in the loader |
| **Stages** | One row per stage: derived state + blockers, substages with evidence thumbnails (signed URLs), site updates for the stage, verification history (requests, visits, decisions, findings, certificate link), the ledger row for the stage | Request verification (087), Record decision on behalf (087), Approve (087 `approve_stage`), Request rework (089), Authorise release (090) when `payment_eligible`, Confirm received on the stage's tranche (090) | `verifications.ts`, `site-updates.ts`, `payments.ts`, `approvals.ts`, `activity.ts` |
| **Financials** | Tranches in/out for this project with states and sources; available funds; per-stage: milestone · funded · projection (`payment_status`, labelled *legacy projection*) · release state; fees (`project_fees`, read-only); costing (`BudgetView`) | Confirm received, Authorise release, Open reconciliation — the extracted `LedgerModal` | `payments.ts`, `projects.ts` |
| **Site Updates** | Chronological feed of `site_updates` with author, stage/substage, description, evidence thumbnails | none (evidence is submitted by owner/contractor/admin from the client page; an admin "submit on behalf" is a later decision) | `site-updates.ts` |
| **Documents** | `project_documents` grouped by category, signed download links | none in Phase 5 (upload/delete need owner-only storage policies widened — §11) | `documents.ts` |
| **Conversations** | This project's threads (`listConversations({projectId})`), selected thread's messages with direction rendering (inbound left / outbound right / internal as a grey note), status & assignee; Decisions recorded on the project | Send outbound · Add internal note (`send_message`), Assign · Resolve (091), **Record decision** (091 `record_decision`, with the selected message as source) | `conversations.ts`, `messages.ts` (realtime by project) |
| **Activity** | `project_audit_log` for this project, newest first, action label (`admin.ops.action.*`), actor, person, entity chip that deep-links (stage → Stages, payment → Financials, conversation → Conversations, decision → Conversations) | none | new `listProjectActivity` |
| **Team** | Owner (profile), contractors (`contractor_invites` with status and `contractor_user_id`), verifiers (`project_verifiers` + `verifier_profiles`: discipline, status) | Assign contractor (029), Assign verifier · Remove verifier (086) | `invites.ts`, `verifiers.ts`, `admin-users.ts` |

Rule from 03 §6, applied verbatim: every button calls an existing SECURITY DEFINER RPC that re-checks the actor; the workspace never decides eligibility or authority, it displays the database's refusal (`not_eligible:<reason>`, `not_verified:`, `wrong_state:` …) through the same reason-to-label map `LedgerPanel` already has.

## 7. Stage lifecycle presentation

One component, `StageLifecycleBadge({ lifecycle })`, renders the fourteen derived states from `stageLifecycle()` and the first blocker; used in the header, the Overview ladder, the Stages tab and (Phase 7) the queues. Colour is status accent only:

| Derived state | Accent | Blocker shown |
|---|---|---|
| `locked` | grey | — |
| `in_progress`, `evidence_submitted` | neutral | — |
| `verification_pending` | amber | `verifier_not_selected` when present |
| `verification_in_progress`, `verified` | amber / green | — |
| `rejected`, `payment_failed` | red (`state-held`) | — |
| `approved` | green | `awaiting_funding`, `on_hold` |
| `payment_eligible` | green, emphasised | — |
| `release_authorised`, `disbursement_initiated`, `disbursed`, `completed` | green | — |

The loader assembles the inputs per stage: latest `stage_verifications`, latest `site_updates.submitted_at` for the stage, the project's `payments`, `nextStageStarted` (next stage's status ≠ `locked`), project status. `payment_status` is never an input (pinned by `payments.test.ts`); it is displayed on the Financials tab only, labelled as the legacy projection.

Actions offered per state (Stages tab), all gated by the RPC not the UI: `pending_review` ∧ required ∧ no verification → *Request verification*; verification `pending` → *Record decision on behalf* (087 rules); `verified` (or not required) → *Approve*; `pending_review` → *Request rework*; `payment_eligible` → *Authorise release* (beneficiary = accepted contractor with a user id; none today — the button explains why, 090 pre-flight G); `approved` + `awaiting_funding` → *Confirm received* on the tranche.

## 8. Project timeline / activity model

The Activity tab is a projection of `project_audit_log` (089) and nothing else — no second table, no cache. Reader: `listProjectActivity(projectId, limit = 200)` in `activity.ts`, selecting `id, action, actor_id, person_id, entity_type, entity_id, stage_id, details, created_at` with the 42703 fallback pattern already used in `admin-overview.ts`. Rendering: action label from `admin.ops.action.*` (add the 088–091 actions: `site_update_submitted`, `funding_received`, `payment_release_authorised`, `payment_initiated`, `payment_disbursed`, `payment_failed`, `payment_reconciling`, `conversation_created/assigned/linked/resolved`, `decision_recorded/approved`, `ticket_linked`, `message_internal_note`), actor name via `ownerLookup`, person name likewise, entity chip → deep link. Amounts and stage numbers come from `details`. Person-level rows (`project_id NULL`) never appear here — they have no project.

The Overview's "last 5" is the same list, sliced. Decisions appear twice by design: as `decision.recorded` rows here (the fact that it happened) and as records on the Conversations tab (the decision itself).

## 9. Conversation integration

- Threads: `listConversations({ projectId })`; a project has at least its `jalla` thread once anyone has written (or when the admin opens the composer, via `ensure_project_conversation`).
- Messages: new `listConversationMessages(conversationId)` in `conversations.ts` (select by `conversation_id`, RLS hides nothing from admin); realtime reuses `subscribeToMessages(projectId)` — every message on a project's threads carries `project_id` (091 trigger), so the existing channel filter works.
- Composer: two buttons — *Send* (`outbound`) and *Internal note* (`internal`) — both `sendConversationMessage`. The mirror to GHL is fire-and-forget as today and skips internal notes (deployed in 091).
- Staff acts: assign (staff picker from `listAdminUsers`), resolve; status chip `open · waiting on us · waiting on them · resolved` from the row, never computed in the UI; *Record decision* opens a small modal (subject, decision, related ∈ budget/stage/design/payment/other, related stage/tranche picker, cost/schedule impact, "approved by the client" checkbox) → `recordDecision` with `conversationId` + `messageId`.
- Pre-project threads are the Inbox's (Phase 6); the workspace shows only `project_id = :id`.

## 10. Financial presentation (090 ledger)

**Custody rule (13 Sep, binding):** Groundwork records and governs the financial business process; the provider (SwyChr) holds and moves the money. The tab never shows a Groundwork "wallet", "escrow" or "balance held" — it shows what the client has funded (client → provider), what has been released (provider → contractor), what was disbursed, and how each record reconciles to a provider transaction. When the provider is integrated, "record this event" becomes "receive/verify this event from the provider"; the rows do not change.

Sections, in this order, so the tab already reads correctly before the provider exists:

1. **Funding** — client → provider: tranches, state, source (`staff_confirmed` by whom/when · `provider` + reference), note.
2. **Milestone releases** — provider → contractor: per stage, beneficiary, amount, authorised by/when, state.
3. **Disbursements** — the release history as money movement: initiated · disbursed · failed, provider reference, failure reason.
4. **Compensation** — *placeholder only in Phase 5*: a section header with an honest empty state. Compensation (verifier / contractor / client / agent / other; basis percentage / fixed / milestone / referral / performance) is **not modelled** and gets its own design gate before any table; it must extend the one ledger, not sit beside it. Nothing is hard-coded as "commission = X%".
5. **Reconciliation** — Groundwork record ↔ provider transaction: `payment_events` for the project's rows (admin-readable), unmatched/illegal outcomes surfaced.
6. **Budget** — costing (`BudgetView`), fees (`project_fees`, read-only).

Reads `listProjectPayments(projectId)` once; derives:

- **Funding**: Σ `in` funded/reconciled; per tranche: stage, amount, state, source (`staff_confirmed` by whom/when · `provider`), note.
- **Releases**: per `out` row: stage, beneficiary, amount, state, authorised by/when, provider ref, failure reason.
- **Available** = `availableFunds(payments)` — the same function the lifecycle uses.
- **Per stage**: milestone · funded (its tranche) · `payment_status` (labelled *legacy projection — written by the ledger*) · lifecycle state.
- **Fees**: `project_fees` rows read-only with their own `payment_status` (outside the ledger, flagged in 090).
- **Costing**: `BudgetView` as-is.

Actions are the three ledger acts through the extracted `LedgerModal`; refusals surface the database's reason. No number is computed that the database does not also compute (`stage_release_blocker` is the arbiter; the UI's `stageLifecycle` is the preview).

## 11. RLS / data-access implications

**Tables: nothing to change.** Every read above is covered by an existing admin SELECT policy; every write is an existing RPC. The workspace adds no browser write path and no policy.

**Storage: one gap, and it predates Phase 5.** `storage.objects` policies on the `evidence` and `documents` buckets have owner and (for evidence) accepted-contractor arms only (011/012/20260714). There is **no admin arm and no verifier arm**. Consequences today: `reviews.tsx` hands bare paths to `<a href>` (they do not open); `OverviewTab`'s signed URLs work only for the owner; a verifier assigned in 086 can see the stage rows but not the photos. The workspace's Stages, Site Updates and Documents tabs cannot show a file to staff until this is fixed.

Proposed **migration 092 — storage read for staff and members** (small, its own pipeline: local proof → review → pre-flight → apply → verify → commit):
- `evidence` bucket SELECT: `is_admin() OR project_member(path_tokens[1]::uuid)` — verifiers included, per 03 §6 membership.
- `documents` bucket SELECT: `is_admin() OR project_member(path_tokens[1]::uuid)`.
- No INSERT/DELETE widening in 092 (Documents tab stays read-only for staff; admin upload is a later decision).
- Note: `storage.objects` is owned by `supabase_storage_admin`; policies are created the way 028 did it (CREATE POLICY works; ALTER TABLE does not).

Membership vs. authority (03 §6) holds throughout: the workspace shows an admin everything and lets each RPC decide what they may do.

## 12. Responsive / mobile

The admin pages today carry no responsive classes; the client detail page has a few. The workspace is built to the same rules as the client app (16 px side gutter, phone width ~400 px):

- Header: facts wrap into two rows; quick actions collapse into an overflow menu under `md`.
- Tabs: a horizontally scrollable strip with the active tab kept in view; labels only (icons black-and-white, no emoji).
- Stages: two-column (stage list · stage detail) above `lg`; one column with the list as a select/accordion below.
- Tables (financials, team, activity) → stacked cards under `md`, each card carrying the same fields.
- Thread: full-height list with the composer pinned to the bottom on phones.
- Modals: full-width sheets under `sm`; the existing `LedgerModal`/`RecordDecisionModal` markup already fits.
- No `min-width` wider than the viewport; images `max-width:100%`; only tables scroll horizontally inside their own container.

## 13. Files proposed

**New**
- `src/app/routes/admin/projects.detail.tsx` — route, header, tab switch, deep-link handling.
- `src/lib/supabase/workspace.ts` — `loadWorkspace(projectId)`: one `Promise.all` over the readers in §2, assembling per-stage lifecycle inputs; fail-soft per domain (`available` flags, as 086–091 modules do) so a lagging migration hides a tab's content, not the page.
- `src/components/admin/workspace/WorkspaceHeader.tsx`, `StageLifecycleBadge.tsx`, `OverviewTab.tsx`, `StagesTab.tsx`, `FinancialsTab.tsx`, `SiteUpdatesTab.tsx`, `DocumentsTab.tsx`, `ConversationsTab.tsx`, `ActivityTab.tsx`, `TeamTab.tsx`.
- `src/components/admin/ledger/LedgerModal.tsx` (extracted from `LedgerPanel.tsx`), `src/components/admin/stages/RecordVerificationModal.tsx` + `ReworkModal.tsx` (extracted from `reviews.tsx`), `src/components/admin/team/AssignVerifierModal.tsx` (extracted from `admin/projects.tsx`), `src/components/admin/conversations/RecordDecisionModal.tsx` (new, 091).
- `src/lib/admin/action-labels.ts` — one map from audit action → `TKey`, shared by the overview and the Activity tab.
- `supabase/migrations/092_storage_member_read.sql` — §11.
- Tests: `src/lib/supabase/workspace.test.ts` (loader assembles lifecycle inputs correctly; fail-soft flags), `src/components/admin/workspace/lifecycle-badge.test.ts` (state → accent/blocker table), static pins (no browser writes, no `payment_status` input, deep-link params, both dictionaries), `092` shape test.

**Modified**
- `src/app/routes.ts` — `route("admin/projects/:id", "routes/admin/projects.detail.tsx")`.
- `src/app/routes/admin/projects.tsx` — row link → workspace; modal extracted.
- `src/app/routes/admin/reviews.tsx` — modals extracted; "Open workspace" link per card; `EvidenceGrid` uses signed URLs.
- `src/app/routes/admin/index.tsx` — recent-activity labels from `action-labels.ts` (no behaviour change).
- `src/components/admin/LedgerPanel.tsx` — uses the extracted modal.
- `src/lib/supabase/activity.ts` — `listProjectActivity`; `src/lib/supabase/conversations.ts` — `listConversationMessages`; `src/lib/supabase/approvals.ts` — `getSignedEvidenceUrl` unchanged (works once 092 lands).
- `src/lib/i18n/en.ts`, `fr.ts` — `admin.workspace.*`, `admin.ops.action.*` additions, `admin.decision.*`.

**Untouched:** `components/project/*`, `routes/projects/*`, `nav-config.ts`, migrations 084–091, `api/*`.

## 14. Order of work (each step reviewable on its own)

1. **092** storage read policies — the one database change; the usual pipeline.
2. Extractions (`LedgerModal`, review modals, assign-verifier modal) with no behaviour change; tests stay green.
3. `workspace.ts` loader + `StageLifecycleBadge` + tests.
4. Route + header + Overview + Stages + Team (the operational core).
5. Financials + Site Updates + Documents.
6. Conversations + Activity + Record decision.
7. Row link in `admin/projects.tsx`, workspace link in `reviews.tsx`; both dictionaries; gate; review.

## 15. Decisions requested

1. **092 storage policies** — approve the small migration before the Stages/Documents tabs can show files to staff and verifiers (and to fix the broken evidence links on Stages & Reviews today).
2. **Admin upload/delete of documents from the workspace** — proposed *no* for Phase 5 (read-only); revisit in Phase 7.
3. **Admin "submit site update on behalf"** — proposed *no*; the admin path already exists on the client page and 088 allows it.
4. **Assign-contractor/verifier modals** — keep on the list *and* offer in Team (proposed), or Team only.
5. **Deep-link shape** — `?tab=&stage=&conversation=` (proposed) vs. nested routes.
