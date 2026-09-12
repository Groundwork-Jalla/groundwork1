# Groundwork admin — data relationships (Phase 2)

**Date:** 12 September 2026 · **Status:** proposed, pending sign-off · **Inputs:** `00-architecture-audit.md` (facts), `01-information-architecture.md` (locked IA) · **Changes no code, no migration**

## 0. What this is

Phase 1 named 32 sidebar items and classified their backing as *Exists / Partially / Does not exist*. This document takes every concept behind a *Partially* or *Does not exist* item and decides what the database should do about it — in five buckets, as instructed:

| Bucket | Meaning |
|---|---|
| **existing and sufficient** | use as is |
| **existing but insufficient** | extend in place — columns, a related table, or both; the table and its FKs stay |
| **derivable without a new entity** | a query or a view over existing rows; nothing stored |
| **requires a new entity** | a new table, with its relationships named |
| **should not be created** | there is no business process to store yet; leave it out |

Nothing here is invented to satisfy the IA. Where the IA wants an item and the business has not yet defined the process (inspections, sales agents), the answer is *should not be created*, and the IA item keeps its honest empty state.

Two rules bind everything below:

1. **Groundwork owns the financial business state and the authorisation; SwyChr executes.** Groundwork records what a project should cost, what has been funded, which milestone is eligible, what amount was approved for release and by whom, what was disbursed, what failed or awaits reconciliation. SwyChr's side — how the money moved, its reference, its status, its callbacks — is recorded *about* a Groundwork row, never *as* one. SwyChr is never the system of record for project finances. Every SwyChr-specific column below is marked **provisional** until its API documentation and sandbox exist.
2. **Extend, don't replace.** Every existing table keeps its name, its FKs and its RLS. The two exceptions are additive columns and one nullable change (`project_messages.project_id`), each justified where it appears.

## 1. Corrections carried in from Phase 0

Two audit facts changed while preparing this document and are corrected there:

- `user_roles.role` is constrained by **migration 001** to `homeowner | contractor | admin | verifier`. The narrower CHECK in `20260714…` never applied. **`verifier` is already a permitted value.** R6 therefore needs no constraint change for verifiers; it needs one only for roles beyond them.
- The verifier gap is narrower than "no representation": the role value exists; the profile, the assignment, the verification record and every code path do not.

## 2. Classification, entity by entity

### 2.1 Construction domain

| Concept | Bucket | Today | Decision |
|---|---|---|---|
| Project | **existing and sufficient** | `projects` + cascade family | as is |
| Substage | **existing and sufficient** | `project_substages` | as is |
| Approval | **existing and sufficient** | stage → `complete`, `approved_by`, audit row, certificate | as is; the *input* to approval changes (verification), not approval itself |
| ProjectStage | **existing but insufficient** | `status ∈ locked · active · pending_review · complete`; milestone and payment columns | **Keep the four-value enum.** It is read by `approvals.ts`, contractor RLS, certificates and the client UI; widening it to an eleven-state lifecycle would touch all of them at once. Instead the finer lifecycle is **derived** (§3) from `status` + the latest verification row + the payment row. One additive column: `verification_required boolean` (from the tier and, later, the verification standard). |
| Evidence | **existing but insufficient** | `project_substages.evidence_urls` — bare storage paths, no who/when; the path encodes project/stage/substage | Keep the array — it is the index the client reads and the RLS on the bucket depends on the path shape. The missing who/when/description belongs to the *update*, not the file. |
| SiteUpdate | **requires a new entity** | none | **`site_updates`** — one row per submission of evidence: `project_id`, `stage_id`, `substage_id?`, `submitted_by → auth.users`, `submitted_at`, `description`, `evidence_paths jsonb` (the paths this update added), `location jsonb?`. `evidence_urls` continues to be appended for the client; `site_updates` is the record. This is the row the Site Updates feed, the Action Center and the activity model read. |
| Verifier assignment | **requires a new entity** | none | **`project_verifiers`** — `project_id`, `user_id → auth.users` (must hold `verifier` in `user_roles`), `discipline` (e.g. civil, electrical, architect, land — text, from configuration not a CHECK, because the standard is not yet defined), `assigned_by`, `assigned_at`, `status ∈ active · removed`. UNIQUE `(project_id, user_id, discipline)`. Mirrors `contractor_invites` in shape so the Team tab lists both. |
| Verification | **requires a new entity** | none; an admin approves from photos | **`stage_verifications`** — `stage_id`, `project_id`, `verifier_id → auth.users`, `site_update_id?` (what was inspected), `requested_at`, `visited_at?`, `decision ∈ pending · verified · rejected · needs_more_evidence`, `findings text`, `checklist jsonb?`, `decided_at`, `certificate_id?`. One stage may have several rows (a rejection, then a pass). **The contractor cannot be the verifier**: a CHECK or trigger refuses `verifier_id` that appears in `contractor_invites` for the same project. |
| Payment eligibility | **derivable without a new entity** | implied by `status = 'complete'` | *eligible* ⇔ stage `complete` ∧ (no `verification_required` ∨ latest `stage_verifications.decision = 'verified'`). Not stored as a flag — storing it would let it drift from its inputs. The **act of authorising release** is stored, as a `payments` row (§2.5). |

### 2.2 People

| Concept | Bucket | Today | Decision |
|---|---|---|---|
| Client | **derivable without a new entity** | `profiles` + owned `projects` | a query: profiles that own ≥1 project, joined to counts and last activity. No table. |
| Contractor | **existing and sufficient** | `contractors`, `contractor_applications`, `contractor_invites` | as is; performance is derivable (§3) |
| Verifier | **existing but insufficient** | the enum value only | Use `user_roles.role = 'verifier'` as the role. Add **`verifier_profiles`** (`user_id` PK → auth.users, `discipline[]`, `registration_body` e.g. ONIGC/ONAC, `registration_no`, `city`, `available boolean`) — the credential and reach data the People → Verifiers page needs and `profiles` should not carry. |
| Team member | **existing but insufficient** | one `admin` role | Roles beyond `admin` (`ops`, `finance`, `growth`) need `ALTER TABLE user_roles DROP CONSTRAINT … ; ADD CONSTRAINT … CHECK (role IN (…))` — the R6 change proper — plus a `has_role(text)` sibling of `is_admin()`. **Deferred to Phase 8**; nothing before it needs a second staff role. |
| Agent | **should not be created** | nothing | No business process, no data, no owner. The IA item stays a placeholder. |

### 2.3 Communication

| Concept | Bucket | Today | Decision |
|---|---|---|---|
| Conversation | **requires a new entity** | implicit: one thread per `project_id` | **`conversations`** — `id`, `person_id → auth.users?` (the external party; nullable for a group thread), `project_id → projects` **nullable** (a lead has no project yet — IA §19 of the plan), `channel ∈ jalla · whatsapp · email · call`, `subject?`, `status ∈ open · waiting_on_us · waiting_on_them · resolved`, `assigned_to → auth.users?`, `ghl_conversation_id?`, `ghl_contact_id?`, `last_message_at`, timestamps. UNIQUE on `ghl_conversation_id` where not null. |
| Message | **existing but insufficient** | `project_messages` flat per project | **Extend in place**: add `conversation_id → conversations` (NOT NULL after backfill), `channel`, `direction ∈ inbound · outbound · internal`, `status ∈ sent · delivered · failed?`, `attachments jsonb?`. Make `project_id` **nullable** — it becomes derived from the conversation. **Backfill**: one `conversations` row per existing `project_id`, every message attached. RLS on `project_messages` keys on `project_id` today; the policies gain an `OR conversation → person_id = auth.uid()` arm so pre-project conversations are readable by their person. |
| Channel, Direction | **derivable without a new entity** | — | columns above, not tables |
| Internal note | **existing but insufficient** | none | `direction = 'internal'` on `project_messages`; RLS hides `internal` rows from non-staff. Never mirrored to GHL — the mirror (077) gains `WHERE direction <> 'internal'`. |
| Decision | **requires a new entity** | none | **`decisions`** — `project_id`, `conversation_id?`, `message_id?` (the message it was recorded from), `subject`, `decision text`, `related ∈ budget · stage · design · payment · other`, `related_id?`, `recorded_by`, `approved_by?` (the client, when it is theirs), `cost_impact_usd?`, `schedule_impact_days?`, `recorded_at`. This is "Record Decision" from the plan §22 and the answer to off-platform approvals. |
| GHL synchronisation | **existing but insufficient** | ids on profiles/applications/messages; outbox | see R1 below; `conversations.ghl_conversation_id` replaces the `profiles.ghl_thread_project_id` heuristic (audit R2) — a reply lands on the conversation whose GHL id it carries, not on "the last project mirrored". |

### 2.4 Operations

| Concept | Bucket | Today | Decision |
|---|---|---|---|
| Activity / Event | **existing but insufficient** | `project_audit_log(project_id NOT NULL, stage_id, action, actor_id, details, created_at)` — five actions; three other partial logs | **Extend in place**, do not add a second log: make `project_id` nullable (person-level events), add `entity_type text`, `entity_id uuid`, `person_id uuid?`; widen `action` by convention (`site_update.submitted`, `verification.decided`, `payment.release_authorised`, `conversation.message_received`, `decision.recorded`, …). Every new entity above writes one row on create and on state change — from the SECURITY DEFINER RPC that makes the change, so the log cannot be skipped from the browser. `owner_read_audit_log` (004) is unaffected: NULL `project_id` never matches an owner. |
| Task | **requires a new entity — deferred** | none | **`tasks`** — `project_id?`, `stage_id?`, `issue_id?`, `conversation_id?`, `assigned_to`, `created_by`, `created_from ∈ manual · conversation · verification · inspection`, `title`, `status ∈ open · done · cancelled`, `priority`, `due_at`. Created in the same migration as issues, **after** the Project Workspace exists (Phase 7); the Action Center reads it. |
| Issue / Risk | **requires a new entity — deferred** | none | **`issues`** — `project_id`, `stage_id?`, `title`, `description`, `severity ∈ low · medium · high · critical`, `status ∈ open · investigating · resolved · closed`, `owner_id`, `due_at?`, `resolution?`, `raised_by`, `raised_from ∈ manual · verification · inspection · conversation`. With tasks, Phase 7. |
| Inspection | **should not be created (yet)** | none | The verification standard (Vanessa's open item) decides whether an inspection is distinct from a verification. Until then `stage_verifications.checklist` and `visited_at` carry what an inspection would; a separate table would duplicate it. Revisit when the standard lands. |
| Support ticket | **existing but insufficient** | `support_tickets` (074); no project link; reply is `mailto:` | add `project_id?`, `conversation_id?`; replies become `project_messages` on that conversation with `channel = 'email'`. No new table. |

### 2.5 Finance — Groundwork's side of the boundary

| Concept | Bucket | Today | Decision |
|---|---|---|---|
| Budget | **existing and sufficient** for *estimate* | `budget_usd`, `project_fees`, take-offs | as is |
| Milestone | **existing but insufficient** | `project_stages.payment_milestone_usd`, `payment_status` (hand-set) | Keep both columns. `payment_status` becomes **derived** from the ledger below rather than written by hand (`updatePaymentStatus` retires); until the ledger exists it stays manual. |
| Funding (client → Groundwork) | **requires a new entity** | none | part of `payments` below, `direction = 'in'` |
| Release authorisation, disbursement (Groundwork → contractor) | **requires a new entity** | none | **`payments`** — one ledger, both directions: `project_id`, `stage_id?` (a funding tranche may cover several), `direction ∈ in · out`, `amount`, `currency ∈ USD · XAF`, `fx_rate?`, `beneficiary_id → auth.users?` (out), `state`, `authorised_by → auth.users?`, `authorised_at?`, `provider text?`, **provisional:** `provider_ref?`, `provider_status?`, `provider_payload jsonb?`, `settled_at?`, `failure_reason?`, timestamps. **States** — `in`: `expected · funded · reconciled`; `out`: `eligible · release_authorised · initiated · disbursed · failed · reconciling`. `release_authorised` requires `authorised_by` — the row that answers "who released this money". UNIQUE `(provider, provider_ref)` where not null. |
| Provider reference | **derivable / column** | — | `payments.provider_ref`, provisional |
| Reconciliation | **requires a new entity** | none | **`payment_events`** — the provider's callbacks, verbatim: `payment_id → payments?`, `provider`, `provider_event_id` UNIQUE, `event_type`, `payload jsonb`, `received_at`, `processed_at?`. Mirrors `billing_events` (021), which already does exactly this for Stripe. Reconciliation is *derivable* from `payments.state` vs the latest `payment_events` row. |
| Subscription revenue | **existing and sufficient** | `billing_events`, Stripe | as is; separate from project money by design |

**The boundary, as tables.** Everything a person decides — eligibility, authorisation, beneficiary, amount — is a `payments` column written by a Groundwork RPC under `is_admin()` (later `has_role('finance')`). Everything the provider reports is a `payment_events` row and three provisional columns on `payments`. If SwyChr's contract turns out to need different fields, only the provisional columns and `payment_events.payload` change; nothing about eligibility or authorisation does.

## 3. Derived state — computed, never stored

| Derived | From |
|---|---|
| **Stage lifecycle state** (the plan's eleven-state ladder) | `status` × latest `stage_verifications.decision` × latest `payments(out)` for the stage: `locked` → `in_progress` (active) → `evidence_submitted` (active + a `site_update` since last decision) → `verification_pending` (pending_review ∧ no decision) → `verified` / `rejected` (decision) → `approved` (complete) → `payment_eligible` (§2.1) → `release_authorised` / `disbursed` / `failed` (payment state) → `completed` (disbursed ∧ next stage active). Lives in `src/lib/` as a pure function with tests — the `health.ts` pattern, with rules that now come from the model. |
| Payment eligibility | §2.1 |
| Client record | §2.2 |
| Contractor performance | stages complete where the contractor was invited; `planned_end` vs `completed_at`; count of `rework_requested` audit rows |
| Project financial summary | Σ `payments(in, funded)`, Σ `payment_milestone_usd`, Σ `payments(out, disbursed)`, available = funded − disbursed − authorised |
| Reconciliation status | `payments.state` vs latest `payment_events` |
| Unanswered conversations | `conversations.status = 'waiting_on_us'` or last message `inbound` older than *n* hours |
| Health bands and the Action Center | projections over all of the above — Phase 3 defines the rules, Phase 4 builds |

## 4. The two schema dependencies

**R1 — inbound message idempotency (before any Inbox work).** `CREATE UNIQUE INDEX project_messages_ghl_message_id_key ON project_messages (ghl_message_id) WHERE ghl_message_id IS NOT NULL;` and `conversation-delivery.ts` switches to `upsert(…, { onConflict: 'ghl_message_id', ignoreDuplicates: true })`. Existing duplicates, if any, are de-duplicated in the same migration (keep the earliest). Independent of everything else; can ship first.

**R6 — roles.** For `verifier`: nothing — the value is permitted. For `ops`/`finance`/`growth`: one `ALTER TABLE … CHECK` plus `has_role(text)` (SECURITY DEFINER, same shape as `is_admin()`), Phase 8. The `20260714…` migration's narrower CHECK should get a comment saying it never applied, so the next reader does not repeat the audit's mistake.

## 5. Relationship map — after Phase 2

```
auth.users ─┬─ profiles ─── verifier_profiles (verifier only)
            ├─ user_roles (homeowner · contractor · admin · verifier · [ops · finance · growth])
            └─ projects ─┬─ project_stages ─┬─ project_substages ── evidence_urls
                         │                  ├─ stage_verifications ── certificates
                         │                  └─ payments (out, per stage)
                         ├─ site_updates ── (stage, substage, evidence_paths)
                         ├─ project_verifiers ── auth.users (verifier)
                         ├─ contractor_invites ── auth.users (contractor)
                         ├─ payments (in, funding tranches) ── payment_events (provider)
                         ├─ conversations ─── project_messages (+ direction, channel)
                         │        │           └─ decisions
                         │        └─ person_id (nullable project_id: pre-project leads)
                         ├─ project_fees · project_takeoffs · project_documents
                         ├─ [tasks] · [issues]                    (Phase 7)
                         └─ project_audit_log (nullable project_id; entity_type/id)

support_tickets ── (project_id?, conversation_id?)
```

Tables added: `site_updates`, `project_verifiers`, `verifier_profiles`, `stage_verifications`, `conversations`, `decisions`, `payments`, `payment_events`; later `tasks`, `issues`. Tables changed in place: `project_stages` (+1 col), `project_messages` (+5 cols, one nullable), `project_audit_log` (+3 cols, one nullable), `support_tickets` (+2 cols). Tables untouched: everything else. Tables not created: `inspections`, `agents`.

## 6. Ordering inside Phase 2 → 3, from the dependencies

1. **R1** — standalone, first.
2. **Roles + verification**: `verifier_profiles`, `project_verifiers`, `stage_verifications`, `project_stages.verification_required`, the contractor-cannot-verify guard. Unblocks the Project Workspace's Stages tab and the Verification item.
3. **Site updates** — small; the Workspace and Action Center read it.
4. **Activity** — extend `project_audit_log`; every RPC from step 2 onward writes to it.
5. **Finance ledger** — `payments`, `payment_events`; `payment_status` becomes derived. Independent of SwyChr's contract; provisional columns marked.
6. **Conversations** — `conversations`, message columns, backfill, `decisions`, support links. Unblocks the Inbox (Phase 6).
7. **Tasks, issues** — Phase 7, once the Workspace exists.
8. **Staff roles** — Phase 8.

Each step is its own migration with the repo's long-header convention, applied by hand, with a fail-soft path in the app where a lagging migration would otherwise break a page (audit R7). Every new table gets RLS on, admin policies through `is_admin()`, and owner/contractor/verifier policies scoped by project — the same shape as `project_stages` today.

## 7. Decisions requested before Phase 3

1. Confirm **keep the four-value `project_stages.status`** and derive the lifecycle, rather than widening the enum.
2. Confirm **`site_updates` as a record alongside `evidence_urls`**, not a migration of the array into rows.
3. Confirm **one `payments` ledger for both directions** with `payment_events` for provider callbacks — the Stripe/`billing_events` shape reused.
4. Confirm **`project_messages` extended in place** (+`conversation_id`, nullable `project_id`) rather than a new messages table.
5. Confirm **inspections not created** until the verification standard says they are distinct.
6. Confirm the **contractor-cannot-verify** guard is a database rule, not a UI check.
