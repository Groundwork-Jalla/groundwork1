# Groundwork admin — migration and implementation plan (Phase 4)

**Date:** 12 September 2026 · **Status:** directionally approved 12 Sep 2026; §7 resolved; 085 cleared to write · **Inputs:** `02` (entities), `03` (workflows, contracts, decisions) · **Changes no code** — this is the plan the code is written from

## 0. What this is

Phases 0–3 established what exists, where things live, what they are, and how they behave. This turns that into a build order with enough precision that migration 085 can be written without reopening a decision. Database first; every screen is a projection of what the database can then answer.

**Order after this document is approved:** 085 → 086 → 087 → 088 → 089 → 090 → 091, each with its app-side change, each on a local PostgreSQL 16 cluster before it ships (the way 070 and 084 were), each applied by hand in the SQL editor. Then the Project Workspace (Phase 5), the Inbox (Phase 6), the Overview and Action Center as projections, the remaining modules (7), then roles, SwyChr and QA (8).

**Repo constraints every step obeys.** Vercel Hobby: 11 of 12 functions — *all new server logic is a Postgres RPC*; the one handler change (R1) is inside an existing function. Relative imports under `api/` carry `.js`. Every string in `en.ts` and `fr.ts`. No emoji; black-and-white icons; colour as accent. Work on `main`, leave it uncommitted; Favour commits. Fail-soft wherever a lagging migration would otherwise blank a page.

## 1. Conventions shared by every migration

**Header.** The repo's long comment: *why*, what was wrong, what this changes, "Run in: SQL Editor (after NNN)". Nothing ships without it.

**RPCs.** `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`; first statement re-checks the specific actor (never membership alone — 03 §6); `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated`; raise with a `code:` prefix the client can match (`not_admin:`, `not_verifier:`, `not_eligible:`, `contractor_cannot_verify:`), the way `self_verify_limit:` is matched today.

**Two helpers, once (086).**
```sql
project_member(p_project uuid) → boolean   -- owner ∨ accepted contractor ∨ active verifier
is_contractor_on(p_project uuid, p_user uuid) → boolean
log_activity(p_project uuid, p_action text, p_entity_type text, p_entity_id uuid,
             p_person uuid, p_details jsonb) → void   -- one writer for project_audit_log
```
Every RPC below writes its audit row through `log_activity`, inside the same transaction, so the log cannot be skipped from a browser and cannot disagree with the change.

**RLS on new tables.** Enable before any policy. `SELECT USING (project_member(project_id) OR is_admin())`, narrowed per table as 03 §4 states. No INSERT/UPDATE/DELETE policy for `authenticated` — RPCs only. Locked tables (`payment_events`) follow the `app_config` pattern: RLS on, no policy, `REVOKE ALL FROM authenticated`.

**Fail-soft.** The app checks for a missing table or function with `isMissingTable()` (`src/lib/errors.ts`) and renders the pre-migration behaviour plus a one-line note — the 084 pattern.

**Local proof.** For each migration: stub `auth.users`, the roles, `is_admin()`, and the tables it touches; apply; exercise every RPC's guard (the refusals as much as the happy path); tear down. The transcript of that run goes in the PR description Favour writes.

## 2. The migrations

### 085 — inbound message idempotency (R1)
**Objects.** `CREATE UNIQUE INDEX project_messages_ghl_message_id_key ON public.project_messages (ghl_message_id);` — **plain, not partial** — preceded by a de-dup that keeps the earliest row per `ghl_message_id` and records how many it removed in a `RAISE NOTICE`.

> **Corrected 12 Sep, proven on a local PostgreSQL 16.** The first draft proposed a *partial* index (`WHERE ghl_message_id IS NOT NULL`). supabase-js `.upsert(row, { onConflict: 'ghl_message_id', ignoreDuplicates: true })` makes PostgREST emit `INSERT … ON CONFLICT (ghl_message_id) DO NOTHING` with **no predicate**, and Postgres answers `there is no unique or exclusion constraint matching the ON CONFLICT specification` — the upsert would have failed on every inbound message. A plain unique index matches the clause, and because Postgres treats NULLs as distinct it still allows any number of platform messages with no GHL id (three inserted, three kept, in the proof). The replayed id was a no-op.
**App.** `api/_handlers/conversation-delivery.ts`: `.insert(row)` → `.upsert(row, { onConflict: 'ghl_message_id', ignoreDuplicates: true })`; the handler returns `{ filed: true, duplicate: true }` on conflict so the delivery log says so.
**Tests.** Local PG: insert the same `ghl_message_id` twice → one row. Vitest: `src/lib/contractor/delivery-payload.test.ts` gains a case that the upsert options are set (the handler is otherwise untestable without GHL).
**Rollback.** Drop the index. The upsert degrades to a plain insert.
**Done when** a replayed webhook produces no second message, proven locally.

### 086 — roles helpers, verifier profiles, assignments, `verification_required`
**Objects.**
- `project_member`, `is_contractor_on`, `log_activity` (above).
- `verifier_profiles(user_id PK → auth.users CASCADE, disciplines text[] NOT NULL DEFAULT '{}', registration_body text, registration_no text, city text, available boolean NOT NULL DEFAULT true, created_at, updated_at)`. Trigger: `user_id` must hold `user_roles.role = 'verifier'` (the value 001 already permits).
- `project_verifiers(id, project_id → projects CASCADE, user_id → auth.users, discipline text NOT NULL, assigned_by → auth.users SET NULL, assigned_at, status text CHECK IN ('active','removed') DEFAULT 'active', UNIQUE (project_id, user_id, discipline))`. Trigger BEFORE INSERT/UPDATE: `RAISE 'contractor_cannot_verify:'` when `is_contractor_on(project_id, user_id)`.
- `ALTER TABLE project_stages ADD COLUMN verification_required boolean NOT NULL DEFAULT false;` backfill `true` where the project's tier ≠ `self_verify`/`starter`. `start_project_tracking` (072) sets it the same way for new activations.
- RPCs: `assign_verifier(p_project, p_user, p_discipline)`, `remove_verifier(p_assignment)` — admin only, audited `verifier.assigned` / `verifier.removed`.
- RLS: `verifier_profiles` — admin all; own row SELECT/UPDATE; SELECT for members of any project the verifier is active on. `project_verifiers` — admin all; owner SELECT; the verifier SELECT own. **Existing stage tables** gain a verifier SELECT arm: `project_stages`, `project_substages`, `project_documents`, `site_updates` (088) — `USING (project_member(project_id) OR is_admin())` replaces the two-arm owner/contractor policies from `20260714…`, which are dropped by name.
**App.** `admin/projects.tsx`: an *Assign verifier* action beside *Assign contractor*, listing `verifier_profiles`. `src/lib/supabase/verifiers.ts` (new): `listVerifiers`, `assignVerifier`, `removeVerifier`. i18n.
**Tests.** Local PG: assigning an accepted contractor as verifier raises; a non-verifier user raises; UNIQUE holds. Vitest: none new — no pure logic.
**Rollback.** Drop tables, column, functions; recreate the `20260714…` two-arm policies from their text.
**Fail-soft.** Missing `project_verifiers` → the assign action is hidden with a note.

**Business-rule verification — 12 Sep, before production application.**

*Tier values.* `projects.tier` was created (003) as `self_verify | jalla_verify | jalla_management`. Migration 004 renamed them to `starter | pro | enterprise` with a backfill; 008's header then states the table "was created with new tier names from the start — no backfill needed", and every migration since (021, 053, 060–062, 072, 082) writes the canonical three — writes that would violate 004's CHECK. So 004's tier block never took effect on production, and the live values are `self_verify | jalla_verify | jalla_management`. `normalizeTier()` maps the legacy names (`starter → self_verify`, `pro → jalla_verify`, `enterprise → jalla_management`) as tolerance, not because rows carry them.

*Meaning.* Dictionary (`tierBilling`): Self Verify — "You review every stage yourself"; Jalla Verify — "Independent verification by Jalla professionals on every stage"; Jalla Management — "Jalla manages your entire project". Beta notes 3 Sep p.12: for Jalla Verify an independent professional must visit the site.

*086's rule* — `verification_required ⇔ tier NOT IN ('self_verify','starter')` — is **the identical predicate the codebase already uses in three places** to decide who approves: `approvals.ts` L21 and L48 (`isSelfVerify = tier === 'self_verify' || tier === 'starter'` → self-approve, else `pending_review`), `plan-limits.ts` L38, `admin/projects.tsx`. Under legacy values it also holds (`pro`/`enterprise` → required). 086 lifts an existing fork into a column; 087 changes who does the approving, not when it is required. **Consistent; no change made.** One refinement is Product's, not a contradiction: whether Jalla Management — where Jalla's own professionals are on site — is verified by them or by an independent third party. 086's default (required) is the superset and can be narrowed per stage by the verification standard.

*Tier-change asymmetry* — completed stages keep their requirement; non-complete stages follow the new tier. Searched for any path that reopens or re-qualifies a completed stage: 021's subscription sync and the 060–062 guards never touch `project_stages`; 022 activates *locked* stages of gated projects; 079 revokes certificate *artefacts* for Self Verify, not stage state; nothing anywhere moves a stage out of `complete`. A stage's approval stands on the rule it was approved under. **Consistent; no change made.**

### 087 — stage verifications
**Objects.**
- `stage_verifications(id, stage_id → project_stages CASCADE, project_id → projects CASCADE, verifier_id → auth.users, requested_by → auth.users, site_update_id → site_updates SET NULL [FK added in 088], requested_at, visited_at, decision text CHECK IN ('pending','verified','rejected','needs_more_evidence') DEFAULT 'pending', findings text, checklist jsonb, decided_at, recorded_by → auth.users, recorded_on_behalf_of → auth.users, reason text, certificate_id → certificates SET NULL, created_at)`.
  CHECKs: `(decision = 'pending') = (decided_at IS NULL)`; `recorded_on_behalf_of IS NULL OR (recorded_on_behalf_of = verifier_id AND reason IS NOT NULL AND reason <> '')`. Trigger: `verifier_id` not a contractor on the project.
- RPCs: `request_verification(p_stage, p_verifier)` — admin; stage `pending_review` ∧ `verification_required` ∧ verifier active on the project; **one open `pending` row per stage** (partial UNIQUE on `(stage_id) WHERE decision = 'pending'`); audit `verification.requested`. `record_verification(p_verification, p_decision, p_findings, p_checklist, p_visited_at, p_on_behalf_of, p_reason)` — caller is `verifier_id`, **or** admin with `p_on_behalf_of = verifier_id` and reason; sets `recorded_by = auth.uid()`; on `rejected`/`needs_more_evidence` calls the existing rework path (stage → `active`, substages → `in_progress`); audit `verification.decided` with decision and `on_behalf_of`.
- `adminApproveStage` moves into SQL as `approve_stage(p_stage)`: refuses `not_verified:` when `verification_required` and the latest decision ≠ `verified`. The TypeScript in `approvals.ts` becomes a thin caller — this is the one place the four-value enum is written, and it must not be bypassable from the client.
- RLS: admin all; verifier own rows; owner and contractor SELECT `decision, findings, decided_at, verifier_id` (a view or column-level grant hides `checklist`).
**App.** `reviews.tsx`: a *Request verification* picker (active verifiers on the project) and the verification status per stage; approve disabled until `verified`. Verifier-facing: the Workspace Stages tab (Phase 5) — until then, a minimal `/admin/verifications` list is **not** built; verifiers act from the project page.
**Tests.** Local PG: contractor as verifier raises; approve before verified raises `not_verified:`; on-behalf without reason raises; two pending rows on one stage raise; rejection resets substages. Vitest: `stageLifecycle()` (§3) reads these rows.
**Rollback.** Drop table and RPCs; restore `adminApproveStage`'s TypeScript body — a documented regression to admin-from-photos.
**Fail-soft.** Missing table → reviews page behaves as today.

### 088 — site updates
**Objects.** `site_updates(id, project_id → projects CASCADE, stage_id → project_stages CASCADE, substage_id → project_substages SET NULL, submitted_by → auth.users, submitted_at, description text, evidence_paths jsonb NOT NULL DEFAULT '[]', location jsonb, created_at)`. Add the 087 FK `stage_verifications.site_update_id`. RPC `submit_site_update(p_stage, p_substage, p_description, p_paths jsonb, p_location)` — member; stage `active` or `pending_review`; appends `p_paths` to `project_substages.evidence_urls` in the same transaction; audit `site_update.submitted`. RLS: `project_member(project_id) OR is_admin()` SELECT.
**App.** `EvidenceUpload.tsx` calls the RPC after the storage upload instead of writing `evidence_urls` directly (`updateSubstageEvidenceUrls` retires). `reviews.tsx` shows updates per stage.
**Tests.** Local PG: paths land in both places atomically; a locked stage refuses. Vitest: the upload component's path builder is already tested (`footprint.test.ts` pattern) — add the RPC call shape.
**Rollback.** Drop table and RPC; `evidence_urls` is complete without it.
**Fail-soft.** Missing RPC → direct array write, as today.

### 089 — activity model
**Objects.** `ALTER TABLE project_audit_log ALTER COLUMN project_id DROP NOT NULL; ADD COLUMN entity_type text, ADD COLUMN entity_id uuid, ADD COLUMN person_id uuid;` index on `(entity_type, entity_id)` and `(person_id, created_at DESC)`. `log_activity` (086) starts writing them. Backfill `entity_type = 'stage', entity_id = stage_id` where present. Existing writers in `approvals.ts` switch to `log_activity` via their RPCs (087 already did the stage ones); `admin_assign_contractor` (029) and `admin_provision_user` gain a call.
**App.** `admin-overview.ts` recent-activity reads the new columns to resolve names; a person-level feed becomes possible for Clients (Phase 7).
**Tests.** Local PG: NULL `project_id` row is invisible to owners (policy unchanged), visible to admin.
**Rollback.** Drop the three columns; delete NULL-project rows; restore NOT NULL.

### 090 — the financial ledger
**Objects.**
- `payments(id, project_id → projects CASCADE, stage_id → project_stages SET NULL, direction text CHECK IN ('in','out'), amount numeric(14,2) CHECK (amount > 0), currency text CHECK IN ('USD','XAF'), fx_rate numeric, beneficiary_id → auth.users SET NULL, state text, funding_source text CHECK IN ('provider','staff_confirmed'), confirmed_by → auth.users, confirmed_at, authorised_by → auth.users, authorised_at, provider text, provider_ref text, provider_status text, provider_payload jsonb, settled_at, failure_reason text, created_at, updated_at)`. State CHECK by direction: `in ∈ expected·funded·reconciled`, `out ∈ eligible·release_authorised·initiated·disbursed·failed·reconciling`. CHECKs from 03 §4: authorised needs actor+time; staff-confirmed needs actor+time and `provider IS NULL`; `out` with a stage: `amount ≤ payment_milestone_usd`. UNIQUE `(provider, provider_ref)` where not null. *Provider columns are provisional* — a comment on each says so.
- `payment_events(id, payment_id → payments SET NULL, provider text, provider_event_id text UNIQUE, event_type text, payload jsonb, received_at, processed_at)`. Locked (no policies).
- RPCs: `confirm_funding(p_payment, p_note)` — admin; `expected → funded` with `funding_source = 'staff_confirmed'`; audit. `authorise_release(p_stage, p_amount, p_beneficiary)` — admin; **recomputes eligibility in SQL** (stage `complete`; latest verification `verified` if required; `Σ funded − Σ disbursed − Σ authorised ≥ p_amount`; project not `on_hold`) and raises `not_eligible:<reason>` otherwise; inserts `out` row `release_authorised`; audit. `expected` `in` rows are created by `start_project_tracking` per milestone tranche.
- `project_stages.payment_status` is reclassified as a **legacy compatibility projection** — not derived state, not a source of truth. *(Reconsidered 12 Sep.)* The authoritative financial state is `payments`; `stageLifecycle()` reads `payments` and **never reads this column**. The column is kept only because fourteen files read it today (`dashboard.tsx`, `projects/detail.tsx`, `EscrowWallet`, `PaymentHistory`, `PayoutStatusModal`, `OverviewTab`, `PaymentsTab`, `StageTracker`, `export-budget.ts`, … — audit list in Phase 3 §0) and rewriting them belongs to Phase 7, not to a financial migration. So: one trigger on `payments` writes it (`paid` ⇔ an `out` row `disbursed`; `partial` ⇔ `release_authorised`/`initiated`; else `unpaid`); it has **exactly one writer**; the manual writer `updatePaymentStatus` and its toggle are removed in this migration; a `COMMENT ON COLUMN` says *legacy projection of payments — do not read in new code*. **Retirement:** when Phase 7 has moved every reader to `stageLifecycle()`, migration 09x drops the trigger and the column; that migration is listed in Phase 7's definition of done, so the column cannot outlive its readers.
- RLS: `payments` — admin all; owner SELECT own project's; contractor SELECT where beneficiary; no writes. `payment_events` — locked.
**App.** `budgets.tsx` → shows `expected`/`funded` tranches with *Confirm funding*; a *Authorise release* action on eligible stages. The payments components (`EscrowWallet`, `PaymentHistory`, `PayoutStatusModal`) stay in preview mode until Phase 7 rewires them to real rows; `MILESTONE_PAYMENTS_ARE_PREVIEW` stays `true`.
**Tests.** Local PG: authorise before verified raises; authorise beyond funds raises; two authorisations exceeding funds — the second raises; `payment_status` follows the row; staff-confirm without actor raises. Vitest: `stageLifecycle()` funding cases.
**Rollback.** Drop tables, trigger, RPCs; restore `updatePaymentStatus` and the manual toggle.
**Fail-soft.** Missing `payments` → budgets page as today; eligibility computed as "unknown" and the Action Center shows no payment items.

### 091 — conversations, decisions, support links
**Objects.**
- `conversations(id, person_id → auth.users SET NULL, project_id → projects SET NULL, channel text CHECK IN ('jalla','whatsapp','email','call') DEFAULT 'jalla', subject text, status text CHECK IN ('open','waiting_on_us','waiting_on_them','resolved') DEFAULT 'open', assigned_to → auth.users SET NULL, ghl_conversation_id text, ghl_contact_id text, last_message_at, created_at, updated_at)`. UNIQUE `ghl_conversation_id` where not null.
- `ALTER TABLE project_messages ADD COLUMN conversation_id → conversations SET NULL, ADD COLUMN direction text CHECK IN ('inbound','outbound','internal') DEFAULT 'outbound', ADD COLUMN channel text DEFAULT 'jalla', ADD COLUMN status text, ADD COLUMN attachments jsonb; ALTER COLUMN project_id DROP NOT NULL;` **Backfill:** one `conversations` row per distinct `project_id` (person = owner, channel `jalla`, `last_message_at` = max created); set every message's `conversation_id`; then `SET NOT NULL` on `conversation_id`. Backfill `direction`: `origin = 'ghl'` → `inbound`, else `outbound`.
- `decisions(id, project_id → projects CASCADE, conversation_id → conversations SET NULL, message_id → project_messages SET NULL, subject text, decision text, related text CHECK IN ('budget','stage','design','payment','other'), related_id uuid, recorded_by → auth.users, approved_by → auth.users, cost_impact_usd numeric, schedule_impact_days integer, recorded_at)`.
- `ALTER TABLE support_tickets ADD COLUMN project_id → projects SET NULL, ADD COLUMN conversation_id → conversations SET NULL;`
- RPCs: `send_message(p_conversation, p_content, p_direction, p_attachments)` — member, or admin; `internal` admin only. `assign_conversation`, `link_conversation(p_conversation, p_project)`, `resolve_conversation`, `record_decision(…)`, `link_ticket(…)` — admin, audited.
- RLS: `conversations` — admin all; `person_id = auth.uid()`; `project_member(project_id)`. `project_messages` — existing policies keep their `project_id` arm; add `OR EXISTS (conversation where person_id = auth.uid())`; `direction = 'internal'` restricted to `is_admin()` in every SELECT policy. `decisions` — admin all; owner SELECT.
- The 077 mirror trigger and `crm-chat-mirror` gain `WHERE direction <> 'internal'`.
- `app_config`: `unanswered_conversation_hours = '4'`, `unanswered_bands = '{"medium":4,"high":8,"critical":24}'`.
**App.** `conversation-delivery.ts`: resolve by `ghl_conversation_id` (create if absent, `project_id` null, person from contact); stop reading `ghl_thread_project_id`. `project-message.ts` (`crm-chat-mirror`): use the conversation's `ghl_conversation_id`; stop stamping `ghl_thread_project_id`. `messages.ts` / `ProjectChat.tsx`: read by `conversation_id` with `project_id` fallback. `support.tsx`: reply opens the linked conversation once the Inbox exists (Phase 6); until then the `mailto:` stays.
**Tests.** Local PG: backfill covers every message; internal rows invisible to a member; a pre-project conversation visible to its person only. Vitest: `delivery-payload.test.ts` for the resolve-by-conversation shape.
**Rollback.** Drop `decisions`, the new columns, `conversations`; every message still has its `project_id` from before the backfill. Restore the heuristic in the two handlers from git.
**Fail-soft.** Missing `conversation_id` → chat reads by `project_id` as today.

### 092+ (Phase 7–8, not planned here)
`tasks`, `issues` (03 §4 deferred); `ALTER … user_roles CHECK` for `ops·finance·growth` + `has_role(text)`; SwyChr integration handler against real documentation.

## 3. The lifecycle function — `src/lib/lifecycle/stage.ts`

Ships with 087 (it needs verifications) and grows with 090 (payments). Pure; signature from 03 §2; returns `{ state, blockers }`. A sibling `projectHealth()` in the same module replaces the uncommitted `health.ts` *rules* — bands become projections of stage states and blockers (at risk ⇔ any stage `payment_failed` or `rejected` older than *n* days or `verification_pending` older than *n* days; attention ⇔ any blocker; on track otherwise), thresholds in `app_config`. The uncommitted `health.test.ts` cases are ported where the rule survived and deleted where it did not; the 24 tests become the seed of the new suite, not its ceiling.

## 4. What the uncommitted slice becomes

| Piece | Fate |
|---|---|
| `health.ts` rules | replaced by `lifecycle/stage.ts` + `projectHealth()` (§3) |
| `admin-overview.ts` loader | kept; gains verifications, payments, conversations |
| 084 `admin_project_activity` | kept as is; still the cheapest "last activity" |
| `NavItem.section`, `AppSidebar` headings | kept; re-grouped to the 01 §2 sidebar in Phase 7 |
| admin bell, `destinationFor()` | kept; gains `verification_id`, `payment_id`, `conversation_id` destinations |
| `nav-config.test.ts` | kept; tests the new nav unchanged |
| the rewritten `index.tsx` | kept as the shell of the Overview projection; its cards and list re-read from the lifecycle in Phase 4-UI |

None of it is committed until its phase; nothing in 085–091 depends on it.

## 5. After the database

| Step | Builds | Reads |
|---|---|---|
| Phase 5 — Project Workspace `/admin/projects/:id` | header, tabs: Overview · Stages (with evidence, verification, approve/request/rework) · Financials (tranches, eligibility, authorise) · Site Updates · Documents · Conversations · Activity · Team (contractors + verifiers) | everything above |
| Phase 6 — Inbox `/admin/inbox`, `/:id` | list with person + project context, thread, reply / internal note, Record Decision, assign, link, resolve, channel filters, GHL state | 091 |
| Overview + Action Center | projections per 03 §5; `/admin/action-center` new; Overview rebuilt | the lifecycle module |
| Phase 7 — modules | queues re-pointed at the Workspace; Clients view; contractor performance; Users → Team; sidebar re-grouped to 01 §2; contractor Overview-tab bug; `tasks`, `issues` (092) | |
| Phase 8 — hardening | roles + `has_role`; Audit Log page; SwyChr handler against docs; realtime on new tables; migration ledger; QA | |

## 6. Definition of done, per migration

Applied locally with every guard exercised · header explains why · RPCs revoked from `PUBLIC, anon` · RLS on before policies · `log_activity` called in-transaction · app change ships with a fail-soft path · `pnpm typecheck`, `pnpm test`, `pnpm build` clean · both dictionaries · left uncommitted for Favour with the local-PG transcript.

## 7. Decisions — resolved 12 September 2026

| # | Decision | Applied |
|---|---|---|
| 1 | **Verifier SELECT arm: one `project_member()` policy per stage table**, replacing the two-arm owner/contractor policies from `20260714…` by name — not a third overlapping policy. One membership definition across the project domain. | 086 |
| 2 | **`approve_stage()` moves into SQL.** The client requests approval; the database decides whether it is legal (verification prerequisite, tier, stage state). No `if (verified) updateStage()` in TypeScript. | 087 |
| 3 | **`project_stages.payment_status` is a legacy compatibility projection**, single-writer, never read by the lifecycle, retired by a named migration once Phase 7 has migrated its fourteen readers. Not a second derived source of truth. | 090 |
| 4 | **085's index is plain, not partial** — proven locally that PostgREST's `ON CONFLICT` cannot target a partial index, and that a plain unique index still permits unlimited NULLs. | 085 |

**Implementation rule from here:** one migration at a time. 085 is implemented, proven locally, typechecked, tested, built, and reviewed before 086 is written. Never batched.
