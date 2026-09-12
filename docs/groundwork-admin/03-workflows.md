# Groundwork admin — workflows and implementation contract (Phase 3)

**Date:** 12 September 2026 · **Status:** approved 12 Sep 2026 — §8 records the five decisions · **Inputs:** `00` (facts), `01` (IA), `02` (data model, all six §7 decisions binding) · **Changes no code, no migration**

## 0. What this is

Phase 1 said where things live; Phase 2 said what they are. This says **how they behave over time**: who may do what, what each action writes, what the system derives from it, and the contract every migration must satisfy before it is written. Screens come after this, as projections of it.

Rules carried in and not reopened: four-value `project_stages.status`; `site_updates` beside `evidence_urls`; one `payments` ledger with `payment_events` for the provider; `project_messages` extended in place; no `inspections`; contractor-cannot-verify enforced in the database; `user_roles` already permits `verifier` (001) so no CHECK change is needed for it; **Groundwork owns financial state and authorisation, SwyChr executes**.

One rule added here, and it is the point of the phase: **there is exactly one derived lifecycle and it is never stored.** No `lifecycle_status` column, no cached band, no "eligible" flag. The lifecycle is a pure function of stage status, verification, approval, funding and payment rows. If a screen needs it, it computes it. If a query needs it, it joins the inputs. Storing it would be a second source of truth the moment any input changed without it.

## 1. Who does what

| Role (`user_roles`) | May | May not |
|---|---|---|
| **homeowner** (client) | see own projects; upload evidence; submit a stage for review; on self-verify, approve own stage; message on own projects; record a decision *as approver*; fund (via SwyChr, later) | assign verifiers; verify; authorise a release |
| **contractor** (invited) | see invited projects' stages; upload evidence; submit a site update; message; submit a take-off | submit a stage for review on the owner's behalf; verify *any* stage on a project they are invited to (DB guard); see budget |
| **verifier** (assigned) | see assigned projects' stages, evidence, site updates; record a visit, findings, decision on stages they are assigned to; message on those projects | approve a stage; authorise a release; see other projects |
| **admin** (staff) | everything above on every project; assign contractors and verifiers; approve/rework on Jalla Verify; authorise release; assign conversations; record decisions; all queues | verify — an admin is not an independent professional (see §3.7: an admin may *record* a verifier's decision only with `recorded_on_behalf_of` set, and the audit row says so) |
| finance · ops · growth | *Phase 8.* Until then `admin` covers all staff. | |

Access is by **project membership**, resolved the same way for every new table: owner (`projects.user_id`), invited contractor (`contractor_invites.contractor_user_id`, accepted), assigned verifier (`project_verifiers.user_id`, active), or `is_admin()`. §6 gives the one policy shape.

## 2. The derived stage lifecycle

**Function.** `stageLifecycle(stage, verifications[], payments[], project, siteUpdates[]) → { state, blockers[] }` in `src/lib/` — pure, deterministic, no clock except one passed in, unit-tested against every row of the table below. It replaces the *rules* in the uncommitted `health.ts`; the plumbing pattern there survives.

**Blockers are how the lifecycle explains itself without a second state.** A stage that is approved but cannot yet be paid is `{ state: 'approved', blockers: ['awaiting_funding'] }` — not a new state, and never a stored one. `payment_eligible` is reached only when the blocker list is empty. The same mechanism carries `verifier_not_selected`, `on_hold`, and (Phase 7) `open_critical_issue`. The UI shows the state and the first blocker; it never infers either.

**Inputs, and which is authoritative for what:**

| Input | Source of truth for |
|---|---|
| `project_stages.status` | structural position: `locked · active · pending_review · complete` |
| `project_stages.verification_required` | whether independent verification gates approval (tier ≠ self_verify, or the verification standard) |
| latest `stage_verifications` row | verification: `pending · verified · rejected · needs_more_evidence` |
| `site_updates` since the latest decision | whether new evidence exists |
| `payments` for the stage, `direction = out` | authorisation and disbursement |
| `payments` for the project, `direction = in`, `state = funded` | funding available |
| `projects.status` | `on_hold` overlay |

**States and how each is derived:**

| Derived state | When |
|---|---|
| `locked` | status `locked` |
| `in_progress` | status `active`, no site update since stage activation |
| `evidence_submitted` | status `active`, ≥1 site update since the latest verification decision (or since activation) |
| `verification_pending` | status `pending_review` ∧ `verification_required` ∧ no decision after the latest site update. Blocker `verifier_not_selected` while no `stage_verifications` row exists yet (§3.6) |
| `verification_in_progress` | as above ∧ latest verification row has `visited_at` and no `decided_at` |
| `rejected` | latest decision `rejected` or `needs_more_evidence` ∧ status not yet back to `active` |
| `verified` | latest decision `verified` ∧ status still `pending_review` (awaiting approval) |
| `approved` | status `complete` ∧ no `payments(out)` row. Blocker `awaiting_funding` when funding is short; blocker `on_hold` when the project is |
| `payment_eligible` | `approved` ∧ **eligibility** (below) true ∧ blockers empty |
| `release_authorised` | latest `payments(out)` state `release_authorised` |
| `disbursement_initiated` | `initiated` |
| `disbursed` | `disbursed` |
| `payment_failed` | `failed` or `reconciling` |
| `completed` | `disbursed` ∧ next stage `active` (or last stage) |
| overlay `on_hold` | `projects.status = 'on_hold'` — reported as a blocker on every state |

**Eligibility** (never stored):

```
eligible ⇔ status = 'complete'
         ∧ (¬verification_required ∨ latest decision = 'verified')
         ∧ funded_total − disbursed_total − authorised_total ≥ payment_milestone_usd
         ∧ projects.status ≠ 'on_hold'
         ∧ no blocking issue        (always true until issues exist — Phase 7)
```

Eligibility is a fact the system computes. **Authorisation is an act a person performs**, and it is the `payments` row that records who, when, how much, to whom.

**Tests the function must carry:** one case per row above; the self-verify path (`verification_required = false` skips straight from `complete` to eligibility); a rejection followed by a pass; **funding short by one unit yields `approved` + `awaiting_funding`, never `payment_eligible`**; `pending_review` with no verification row yields `verification_pending` + `verifier_not_selected`; `on_hold` as an overlay on every state; and a property test that no combination of inputs yields two states.

## 3. Workflows — what happens when

Each entry: trigger → actor → preconditions → writes → audit row → notifications → Action Center effect → failure handling. "RPC" means a SECURITY DEFINER function that re-checks the actor's membership; browsers never write these tables directly.

### 3.1 Client provisioned
Exists (083). Admin → `auth.admin.createUser` + `profiles.must_change_password`. Writes an audit row (`client.provisioned`, `person_id`, no project) — *new*. No Action Center item. Failure: the handler already deletes a half-made account.

### 3.2 Project created and configured
Exists for creation (082); **configuration is new**. Admin (or owner via wizard) → project row → **assign contractor** (`admin_assign_contractor`, exists) → **assign verifiers** (`assign_verifier` RPC, new: inserts `project_verifiers`, requires `user_roles` has `verifier` for that user, refuses if the user is an accepted contractor on the project) → set `verification_required` per stage from tier (self_verify → false; else true) — *the verification standard, when it lands, refines this per stage*. Audit: `project.created`, `contractor.assigned`, `verifier.assigned`. Action Center: **"Verifier assignment missing"** for every tracked, non-self-verify project with zero active verifiers. Failure: assignment is idempotent (`ON CONFLICT` on the UNIQUE).

### 3.3 Project activated
Exists (`start_project_tracking`, 072). No change except an audit row `project.activated` and the Action Center dropping its "budget unconfirmed" item.

### 3.4 Stage starts
Exists: previous stage `complete` → this stage `active`, substages unlocked (`approvals.ts`). Audit `stage.started` — *new row, existing path*.

### 3.5 Work done — site update submitted
**New.** Contractor or owner → `submit_site_update` RPC: inserts `site_updates` (who, when, stage, substage?, description, the paths just uploaded), appends the same paths to `evidence_urls` (so every existing reader keeps working). Precondition: membership; stage `active` or `pending_review` (more evidence after a rejection). Audit `site_update.submitted`. Notify: owner (if contractor submitted), assigned verifiers. Action Center: none yet — evidence alone is not a request. Failure: the storage upload happens first in the browser (existing pattern); the RPC records only paths that exist.

### 3.6 Stage submitted for review
Exists (`approveStage` → `pending_review` on non-self-verify). Precondition added: ≥1 site update on the stage. Audit exists (`stage_submitted_for_review`). **New:** if `verification_required`, nothing is auto-requested. The stage sits at `verification_pending` with blocker `verifier_not_selected`, and the Action Center shows **"Verifier selection needed"** to staff. An admin then calls `request_verification(stage_id, verifier_id)`: inserts one `stage_verifications` row with `decision = 'pending'`, `requested_by = auth.uid()`; the verifier must be an active `project_verifiers` row on that project. **Decision 12 Sep:** one verifier, chosen by the admin — requesting all active verifiers would send a foundation stage to the electrical engineer and multiply Action Center noise. `project_verifiers.discipline` and a future `stage_discipline_rules` table (from the verification standard) let selection be automated later without touching `stage_verifications`. Notify that verifier. Action Center: **"Verification due"** (verifier-facing). Self-verify projects skip to 3.9.

### 3.7 Verification
**New.** Verifier → `record_verification` RPC: sets `visited_at`, `findings`, `checklist`, `decision`, `decided_at`, `site_update_id` (what was inspected). Preconditions: caller is `verifier_id` on that row ∧ `project_verifiers` active ∧ **caller is not an accepted contractor on the project** (CHECK via a function `is_contractor_on(project_id, user_id)` — the DB rule from 02 §7.6) ∧ stage `pending_review`. **Decision 12 Sep — admin-on-behalf is allowed, strictly.** An admin may call it only with `recorded_on_behalf_of = <the verifier's user_id>` (must equal the row's `verifier_id`) and a non-empty `reason` — the RPC refuses otherwise. The row then reads: verifier = the professional; `recorded_by` = the admin; `recorded_on_behalf_of` = the professional; reason = e.g. "decision given by phone after photo review". The audit row carries both identities. **The admin is never represented as the verifier** anywhere — not in the row, the audit, the certificate, or the UI. Audit `verification.decided` with the decision. Notify owner, staff. Action Center: the "verification due" item clears; on `verified` a **"Stage ready to approve"** item appears for staff.

### 3.8 Rejected / needs more evidence
Decision `rejected` or `needs_more_evidence` → stage returns to `active` (existing `adminRequestRework` path, now callable by the RPC in 3.7), substages back to `in_progress`, reason from `findings`. Audit exists (`rework_requested`), gains `verification_id`. Notify owner and contractor. Action Center: **"Evidence requested"** for the contractor.

### 3.9 Approved
Exists (`adminApproveStage`, or self-approve). **Precondition added:** if `verification_required`, latest decision must be `verified` — enforced in the RPC, so an admin cannot approve past a rejection. Certificate issued as today (079 rules). Audit exists. Next stage activates (3.4). Action Center: "ready to approve" clears; if eligible, **"Payment ready"** appears.

### 3.10 Payment — eligibility → authorisation → disbursement → reconciliation
Eligibility is computed (§2). **Authorisation is new**: admin (later `finance`) → `authorise_release` RPC: inserts `payments(out)` with `state = 'release_authorised'`, `amount ≤ payment_milestone_usd`, `beneficiary_id` (the contractor, or a named beneficiary), `authorised_by = auth.uid()`, `authorised_at`. Precondition: eligible, computed inside the RPC from the same inputs — the function refuses if the derived state disagrees. Audit `payment.release_authorised`. Then the **integration layer** (Phase 8, against SwyChr's real contract) moves the row `initiated` and records provider fields; provider callbacks land in `payment_events` (UNIQUE `provider_event_id` — idempotent by construction) and a worker advances `payments.state` to `disbursed` / `failed`. `project_stages.payment_status` is **derived** from the row (`paid` ⇔ `disbursed`) — `updatePaymentStatus` retires. Action Center: **"Disbursement failed / unreconciled"** on `failed` or a callback with no matching row. Nothing in this workflow depends on which provider executes.

### 3.11 Funding received
**New.** A `payments(in)` row `expected` is created when tracking starts (per tranche, from the milestone schedule). It moves to `funded` by one of two paths, and the row says which: **`funding_source = 'provider'`** — a `payment_events` callback, the authoritative evidence of receipt once SwyChr exists; or **`funding_source = 'staff_confirmed'`** with `confirmed_by`, `confirmed_at`, `provider = null` — **the interim path, approved 12 Sep as temporary**, an audited authorised act by a named person, explicitly distinct from provider confirmation. Audit `funding.received` carries the source. When SwyChr is integrated the staff path is limited to exceptions (or retired) by a one-line change in the RPC's guard; nothing else moves.

### 3.12 Communication
**New.** Inbound (GHL webhook, `crm-delivery`): resolve `conversations` by `ghl_conversation_id` — **not** by `profiles.ghl_thread_project_id`; create one if absent with `person_id` from the contact and `project_id` null; upsert the message on `ghl_message_id` (R1). Status → `waiting_on_us`. Notify assignee or all staff. Action Center: **"Unanswered conversation"** once `waiting_on_us` exceeds `app_config.unanswered_conversation_hours` (**default 4**), escalating by age — see §5. The threshold and bands live in `app_config`, never in Inbox code. Outbound (staff reply from the Inbox): insert `direction = 'outbound'`, mirror to GHL through `crm-chat-mirror` using the conversation's `ghl_conversation_id`; status → `waiting_on_them`. **Internal note:** `direction = 'internal'`, never mirrored, hidden from non-staff by RLS. Linking a conversation to a project is a staff action (`link_conversation` RPC), audited. Existing platform chat keeps working unchanged: the backfill gives every project one conversation.

### 3.13 Decision recorded
**New.** Staff, from a message → `record_decision` RPC: inserts `decisions` with the message, subject, decision, related entity, cost/schedule impact, `approved_by` (the client, when it is their approval). Audit `decision.recorded`. Appears on the project timeline and, when `related = payment` or `budget`, beside the financial row it concerns. This is how an approval given on WhatsApp becomes part of the record.

### 3.14 Issues and tasks — deferred (Phase 7)
Contracted in §4 so the Action Center and eligibility can name them; not built until the Workspace exists.

## 4. Entity contracts

Eight items each, as instructed. "Actor" means who may create/update; every write goes through a SECURITY DEFINER RPC that re-checks it.

### R1 — `project_messages_ghl_message_id_key`
1 **Source of truth:** GHL's message id, on our row. 2 **Relationship:** partial UNIQUE on `project_messages(ghl_message_id) WHERE NOT NULL`. 3 **Actor:** `crm-delivery` handler (service role) via upsert. 4 **Transitions:** none. 5 **RLS:** unchanged. 6 **Audit:** none. 7 **Depends:** `api/_handlers/conversation-delivery.ts` (switch insert → upsert). 8 **Rollback:** drop the index; de-dup existing rows first (keep earliest), recorded in the migration.

### `project_stages.verification_required`
1 tier at activation, later the standard. 2 column, boolean NOT NULL DEFAULT false; backfill `tier ≠ self_verify`. 3 `start_project_tracking` sets it; admin RPC may change it with audit. 4 n/a. 5 unchanged. 6 `stage.verification_requirement_changed`. 7 `approvals.ts` (3.6, 3.9 read it), lifecycle function. 8 drop column; readers treat absence as `false`.

### `site_updates`
1 the update itself. 2 → `projects`, `project_stages`, `project_substages?`, `submitted_by → auth.users`. 3 owner, contractor, admin via `submit_site_update`. 4 immutable once written (a correction is a new update). 5 project-membership SELECT; INSERT only via RPC. 6 `site_update.submitted`. 7 `EvidenceUpload.tsx` (calls the RPC instead of writing `evidence_urls` directly), `SubstageRow.tsx`, `reviews.tsx` (reads updates for the reviewer). 8 drop table; `evidence_urls` still holds every path, nothing is lost.

### `verifier_profiles`
1 the verifier's credentials. 2 `user_id` PK → `auth.users`; requires `user_roles(user_id, 'verifier')`. 3 admin creates; the verifier may update contact/availability. 4 `available` toggles. 5 admin all; verifier own row; owners of projects the verifier is assigned to may SELECT name/discipline. 6 `verifier.profile_created`. 7 none today. 8 drop table.

### `project_verifiers`
1 the assignment. 2 → `projects`, `user_id → auth.users`, `assigned_by`. UNIQUE `(project_id, user_id, discipline)`. **CHECK via trigger:** `NOT is_contractor_on(project_id, user_id)`. 3 admin via `assign_verifier` / `remove_verifier`. 4 `active → removed` only. 5 admin all; owner SELECT; the verifier SELECT own. 6 `verifier.assigned`, `verifier.removed`. 7 `admin/projects.tsx` (assign action beside contractor), the Workspace Team tab, RLS on stage tables gains a verifier arm. 8 drop table; removing it removes verifier access to those projects — nothing else references it.

### `stage_verifications`
1 the verification event. 2 → `project_stages`, `projects`, `verifier_id → auth.users`, `requested_by → auth.users`, `site_update_id?`, `certificate_id?`, `recorded_by`, `recorded_on_behalf_of?`, `reason?`. 3 created by an admin via `request_verification` (3.6 — one verifier, admin-selected); decided by that verifier (3.7) or admin-on-behalf, where the RPC requires `recorded_on_behalf_of = verifier_id` and a non-empty `reason`. **Trigger:** `verifier_id` must not be a contractor on the project. 4 `pending → verified | rejected | needs_more_evidence`; terminal. A new row for a re-verification. 5 admin all; verifier own rows; owner and contractor SELECT decision/findings (not checklist internals) on their project. 6 `verification.requested`, `verification.decided` (with `on_behalf_of` when set). 7 `approvals.ts` (`adminApproveStage` reads the latest decision; `adminRequestRework` gains `verification_id`), lifecycle function, `reviews.tsx`. 8 drop table; approval reverts to today's admin-from-photos path — a regression to document, not a break.

### `project_audit_log` extension
1 the event. 2 `project_id` nullable; `+entity_type`, `+entity_id`, `+person_id`. 3 RPCs only (the existing owner INSERT policy stays for the client paths that write today). 4 append-only. 5 unchanged (`owner_read` matches only rows with a project); admin all. 6 it *is* the audit. 7 `approvals.ts`, `admin-overview.ts` (readers; new columns nullable so nothing breaks), 084's RPC. 8 columns are additive; drop them; NULL `project_id` rows would need deleting before restoring NOT NULL.

### `payments`
1 Groundwork's financial state and authorisation. 2 → `projects`, `project_stages?`, `beneficiary_id → auth.users?`, `authorised_by → auth.users?`. UNIQUE `(provider, provider_ref)` where not null. 3 `in`: created by tracking start (`expected`), advanced by provider callback or staff confirmation; `out`: created only by `authorise_release` (admin; `finance` later). 4 `in`: `expected → funded → reconciled`; `out`: `eligible → release_authorised → initiated → disbursed`, `initiated → failed`, `failed → reconciling → disbursed | failed`. `in` rows carry `funding_source ∈ provider · staff_confirmed`, `confirmed_by?`, `confirmed_at?`. **CHECK:** `release_authorised` requires `authorised_by` and `authorised_at`; `funded` with `funding_source = 'staff_confirmed'` requires `confirmed_by` and `confirmed_at` and `provider IS NULL`; `amount > 0`; `amount ≤ payment_milestone_usd` for `out` with a stage. 5 admin all; owner SELECT own project's rows; contractor SELECT rows where beneficiary; **no browser INSERT/UPDATE**. 6 every transition writes `payment.<state>` with actor. 7 `payment_status` readers (14 files, §0 of Phase 2) keep reading the column, which becomes derived; `updatePaymentStatus` retires; `EscrowWallet`, `PaymentHistory`, `PayoutStatusModal` move from simulated to real data in Phase 7. 8 drop table; `payment_status` falls back to manual — the migration that makes it derived must be reversible by restoring the manual write.

### `payment_events`
1 the provider's report, verbatim. 2 → `payments?` (nullable: an unmatched callback is still stored), UNIQUE `provider_event_id`. 3 the integration handler (service role) only. 4 `processed_at` set once. 5 admin SELECT; nothing else. 6 the row is the audit. 7 none until Phase 8. 8 drop table.

### `conversations`
1 the conversation. 2 `person_id → auth.users?`, `project_id → projects?` (nullable), `assigned_to → auth.users?`; UNIQUE `ghl_conversation_id` where not null. 3 created by inbound delivery (service role), by staff from the Inbox, or by backfill; assigned/linked/resolved by staff via RPC. 4 `open ⇄ waiting_on_us ⇄ waiting_on_them → resolved → open`. 5 admin all; `person_id` SELECT own; project members SELECT where `project_id` matches. 6 `conversation.created`, `.linked`, `.assigned`, `.resolved`. 7 `crm-chat-mirror` (`project-message.ts`: use `ghl_conversation_id`, stop stamping `ghl_thread_project_id`), `conversation-delivery.ts`, `messages.ts`, `ProjectChat.tsx` (reads by conversation). 8 the backfill is derivable from `project_id`, so dropping the table and the FK column restores today exactly.

### `project_messages` extension
1 the message. 2 `+conversation_id → conversations` (NOT NULL after backfill), `+direction`, `+channel`, `+status`, `+attachments`; `project_id` **nullable**. 3 members via RPC; service role for inbound; `internal` only by admin. 4 `status`: `sent → delivered | failed`. 5 existing policies keep their `project_id` arm; gain `OR conversation.person_id = auth.uid()`; `direction = 'internal'` visible to admin only. 6 `message.sent` / `.received` (not one row per chat message in the audit log — the message row is its own record; the audit row is written only for internal notes and channel failures). 7 the three files above plus `ProjectChat.tsx`, `notifyProjectMembers`, the 077 mirror trigger (`WHERE direction <> 'internal'`). 8 columns additive; restore NOT NULL on `project_id` only after deleting pre-project rows.

### `decisions`
1 the decision. 2 → `projects`, `conversations?`, `project_messages?`, `recorded_by`, `approved_by?`. 3 admin via `record_decision`; owner may `approved_by`-confirm their own. 4 immutable; a reversal is a new decision referencing the old. 5 admin all; owner SELECT own project's. 6 `decision.recorded`. 7 none today. 8 drop table.

### `support_tickets` extension
1 unchanged. 2 `+project_id?`, `+conversation_id?`. 3 staff link via RPC. 5, 6 unchanged plus `ticket.linked`. 7 `support.tsx`, `support.ts`. 8 drop columns.

### Deferred: `tasks`, `issues` (Phase 7)
Contracted as in 02 §2.4. Issues gain one rule now: an open `critical` issue is a **blocker** in eligibility (§2) — so the eligibility function reads `issues` when the table exists and treats its absence as "no blockers". Nothing else references them until built.

## 5. Action Center — rules

Every item: what · who/what · project or person · priority · age · one-click action. Items are **computed from state, never stored** — an Action Center table would be a second source of truth for "what needs doing."

| Item | Condition | Priority | Action → |
|---|---|---|---|
| Budget unconfirmed | Management project, `tracking_started_at IS NULL` | high | Payments & Budgets |
| Verifier assignment missing | tracked, `verification_required` on any stage, zero active `project_verifiers` | high | Workspace → Team |
| Verifier selection needed | stage `pending_review` ∧ `verification_required` ∧ no `stage_verifications` row since the latest site update | high | Workspace → Stages (staff) |
| Verification due | `stage_verifications.decision = 'pending'` | high, escalating with age | Workspace → Stages (verifier) |
| Stage ready to approve | latest decision `verified`, status `pending_review` | high | Stages & Reviews |
| Evidence requested | latest decision `rejected`/`needs_more_evidence`, stage back to `active`, no site update since | medium | contractor / owner |
| Awaiting funding | `approved` with blocker `awaiting_funding` | medium | Payments & Budgets → funding |
| Payment ready | `payment_eligible` (blockers empty) ∧ no `payments(out)` row | high | Payments & Budgets → authorise |
| Disbursement failed / unreconciled | `payments.state ∈ failed · reconciling`, or a `payment_events` row with no match | critical | Integrations → SwyChr |
| Unanswered conversation | `waiting_on_us` older than `app_config.unanswered_conversation_hours` (default 4) | age-banded: 4–8 h medium · 8–24 h high · 24 h+ critical (bands in `app_config`) | Inbox |
| Application to decide | `contractor_applications.status = 'pending'` | medium | Applications |
| Quote request open | `contractor_inquiries.status = 'open'` | medium | Quote Requests |
| Support ticket open | `support_tickets.status ∈ open · in_progress` | medium | Support |
| Stalled project | no site update, message, or audit row for *n* days | low → medium | Workspace |
| Overdue task · open critical issue | Phase 7 | | |

## 6. RLS — one shape for every new table

```
membership(project_id) ⇔ auth.uid() = projects.user_id
                        ∨ auth.uid() ∈ accepted contractor_invites.contractor_user_id
                        ∨ auth.uid() ∈ active project_verifiers.user_id
SELECT: membership(project_id) ∨ is_admin()       — narrowed per table where noted
INSERT/UPDATE: none for authenticated              — RPCs only, SECURITY DEFINER, search_path pinned
DELETE: none                                       — append-only tables; admin_delete_project cascades
```

A `project_member(project_id)` SQL function makes the three arms one expression. **Membership is necessary, not sufficient — a hard rule.** Being a verifier on a project grants sight of it, not the right to verify any stage: `record_verification` checks `auth.uid() = stage_verifications.verifier_id` on *that row*. Being an admin grants access, not every operation: `authorise_release`, `assign_verifier`, `confirm_funding`, beneficiary changes and `record_verification`-on-behalf each check their own preconditions inside the function. No RPC may rely on membership alone.

## 7. Migration order and safety

| # | Migration | Reversible by | Fail-soft in the app |
|---|---|---|---|
| 085 | R1 unique index + de-dup + upsert in delivery | drop index | n/a — server-side only |
| 086 | `project_member()`, `is_contractor_on()`, `verifier_profiles`, `project_verifiers`, `verification_required` | drop functions/tables/column | Workspace Team tab shows "verifiers not enabled" |
| 087 | `stage_verifications` + `record_verification`, `assign_verifier`; `approvals.ts` gates on it | drop; approval reverts to admin-from-photos | reviews page hides the verification column |
| 088 | `site_updates` + `submit_site_update`; EvidenceUpload calls it | drop; `evidence_urls` intact | upload falls back to direct array write |
| 089 | `project_audit_log` extension | drop columns | readers ignore null columns |
| 090 | `payments`, `payment_events`, `authorise_release`; `payment_status` derived | drop; restore manual `updatePaymentStatus` | payments tab keeps its preview mode |
| 091 | `conversations` + backfill, `project_messages` columns, `decisions`, `support_tickets` columns; mirror uses `ghl_conversation_id` | drop new tables/columns; `project_id` still populated for every backfilled row | chat reads by `project_id` if `conversation_id` is null |
| 092+ | `tasks`, `issues` (Phase 7); role CHECK + `has_role` (Phase 8) | | |

Each migration: the repo's long header saying *why*; applied by hand (audit R7); exercised on a local PostgreSQL 16 cluster before it ships, as 070 and 084 were; every RPC `REVOKE … FROM PUBLIC, anon` and `GRANT … TO authenticated`; every new table RLS on before any policy.

## 8. Decisions taken — 12 September 2026

| # | Decision | Applied in |
|---|---|---|
| 1 | **Admin-on-behalf verification: allowed, strictly.** `recorded_on_behalf_of` must equal the row's `verifier_id`; `reason` mandatory; audit carries both identities; the admin is never represented as the verifier. | §3.7, §4 `stage_verifications` |
| 2 | **Verifier selection: the admin selects one verifier.** No automatic fan-out to all active verifiers until the verification standard defines stage → discipline. `stage_verifications` is unchanged by later automation; selection logic arrives beside it. | §2 (`verifier_not_selected`), §3.6, §5 |
| 3 | **Staff funding confirmation: approved as interim.** `funding_source = 'staff_confirmed'` with actor and timestamp, `provider = null`, explicitly distinct from provider-confirmed funding; limited or retired once SwyChr is integrated. | §3.11, §4 `payments` |
| 4 | **Unanswered-conversation threshold: 4 hours default**, `app_config.unanswered_conversation_hours`, age-banded escalation, never in UI code. | §3.12, §5 |
| 5 | **Funding availability is part of eligibility.** A verified, approved stage with insufficient funding is `approved` + `awaiting_funding` — a blocker on the one derived lifecycle, never a stored state or flag. | §2, §5 |

Standing rule, restated: **exactly one derived lifecycle, never stored.** No `lifecycle_status`, no cached health band, no `action_center_items` table, no stored eligibility. Phase 4 plans the migrations that make this real.
