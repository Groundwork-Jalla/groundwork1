# Groundwork admin — information architecture (Phase 1)

**Date:** 12 September 2026 · **Status:** locked pending Philip's sign-off · **Supersedes:** the recommended IA in `00-architecture-audit.md` §21 and the navigation implied by `docs/ADMIN-DASHBOARD.md` · **Changes no code**

## 0. What this is

The sidebar is the skeleton of the admin. This document fixes it — every group, every item, what each one is *for*, what belongs under it, what does not, what backs it in the database today, and how the thirteen legacy pages map onto it. It is the structure Phase 2 audits the schema against and Phase 4–7 build to.

It is **not** an implementation order. Several items begin life as a filter, a tab inside the Project Workspace, or a view over existing rows, and only later become their own screen. §3 says which.

Two decisions are adopted here and can be reversed by Philip before Phase 2:

1. **Stages & Reviews and Verification are separate items.** *Stages & Reviews* answers "what stage is each project in, and is anything awaiting approval?" *Verification* answers "has submitted work been independently verified, by whom, with what findings?" Related, operationally different, and the second has no backing data yet — keeping it visible is the point.
2. **The existing `agent_requests` desk is not "Agent Requests" under Acquisition.** It is the queue where staff ask the repository's Claude Code agents for videos, decks and analyses (migration 054). It moves to **System → Automation Requests**. *Agents* under People is reserved for sales/field agents, a concept with **no backing data today** (searched roles, tables, routes) — it stays in the IA as a placeholder and is not built until the entity exists.

## 1. The hierarchy

```
                     GROUNDWORK ADMIN
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   OPERATIONS         COMMUNICATION        ACQUISITION
        │                   │                   │
   Project Workspace      Inbox            Applications
        │                                       │
   Stage → Substage → Evidence → Verification   Quote requests
        → Approval → Payment eligibility        │
        → Disbursement → Next stage         → Project

   Overview        summarises everything above — a projection, never the model
   Action Center   collects everything that needs a person — every item links to
                   the workspace, a person record, or a conversation
```

Four surfaces carry the product: **Overview** (what is happening), **Action Center** (what do I do), **Project Workspace** (this project), **Unified Inbox** (what are people saying). Every other item is a queue, a directory or a setting that opens into one of those four. GoHighLevel and SwyChr are integrations *under* the product, never top-level items.

## 2. The sidebar (locked)

```
OVERVIEW
  Overview
  Action Center

PROJECT OPERATIONS
  Projects
  Stages & Reviews
  Site Updates
  Verification
  Payments & Budgets
  Tasks
  Issues & Risks
  Inspections

PEOPLE
  Clients
  Contractors
  Verifiers
  Agents
  Team

COMMUNICATION
  Inbox
  WhatsApp
  Email
  Calls

ACQUISITION
  Applications
  Started Applications
  Waitlist
  Quote Requests
  CRM

SUPPORT
  Support

ANALYTICS
  Analytics
  Reports

SYSTEM
  Integrations
  Automation Requests
  Team & Permissions
  Audit Log
  Settings
```

Thirty-two items in eight groups. Eleven exist today as pages, seven are renames or moves, fourteen are new. The mobile tab bar takes the first five (Overview, Action Center, Projects, Stages & Reviews, Site Updates) — the shell already does this (`AppShell.tsx`, `nav.slice(0, 5)`).

## 3. Item by item

Columns: **Backing** uses the audit's §15 classification. **Legacy** is the current route. **Initial form** is what it is *first* — before it earns its own screen.

### OVERVIEW

| Item | Purpose · primary question | Belongs here | Does not belong | Backing | Legacy | Initial form |
|---|---|---|---|---|---|---|
| Overview | Fleet-level picture. *What is happening across Groundwork?* | headline metrics from real queries; health distribution; pipeline by stage; Action Center preview; recent activity; GHL sync health | any metric that cannot be computed; a second CRM; project detail | Partially — the uncommitted slice (audit §18) proves the plumbing; the *rules* wait for Phase 3 | `/admin` | own screen, rebuilt in Phase 4 as a projection |
| Action Center | Cross-functional work queue. *What needs a person now?* | every item with: what · who/what · project or person · priority · age · one-click action. Sources: budget confirmations, stage reviews, verification due, applications, unanswered conversations, quote requests, support, overdue tasks, open issues | anything informational; anything already resolved | Partially — reviews, budgets, applications, support, inquiries computable today; verification, unanswered conversations, tasks, issues are **not** (no entities) | — | **new** `/admin/action-center`, Phase 4 |

### PROJECT OPERATIONS — *What is happening with the construction work?*

| Item | Purpose · primary question | Belongs here | Does not belong | Backing | Legacy | Initial form |
|---|---|---|---|---|---|---|
| Projects | Portfolio and entry point. *What is the state of each project?* | list with owner, location, stage, health, last activity, filters; **→ Project Workspace** `/admin/projects/:id` | editing stages inline; chat | Exists (`projects` + cascade family); workspace **does not exist** | `/admin/projects`, `/admin/projects/new` | list exists; workspace **new**, Phase 5 — the primary operational surface |
| Stages & Reviews | Governance queue. *Which stages await approval?* | `pending_review` stages with evidence; approve / request rework; rows open the workspace's Stages tab | independent verification (next item) | Exists (`project_stages.status`, `approvals.ts`, audit log) | `/admin/reviews` → **rename** | existing page, re-pointed at the workspace in Phase 7 |
| Site Updates | Field evidence feed. *What has happened on site?* | evidence and documents in time order across projects; who, when, which stage | approval decisions | Partially — `evidence_urls`, `project_documents.stage_id`, the `evidence` bucket; no "update" record (who/when/where/description) | — | **new**; first as a view over existing rows, an entity in Phase 2 if adopted |
| Verification | Independent verification. *Has submitted work been verified, by whom, with what findings?* | assigned verifier per stage; visit, findings, decision, certificate link; verifier workload | admin approval (that is Stages & Reviews) | **Does not exist** — no verifier role, no verification record; today an admin approves from photos (audit §4) | — | **new**; lives inside the workspace's Stages tab until the entity exists (Phase 2), then its own queue |
| Payments & Budgets | Financial operations. *What financial action is pending or done?* | **Groundwork's financial business state and authorisation**: what the project should cost; what has been funded; which milestone is eligible; what amount is approved for release and by whom; what has been disbursed; what failed or awaits reconciliation | **execution** — how money actually moves, provider references, execution status, settlement, provider errors and callbacks. That is SwyChr, under Integrations, not built, and never the system of record for project finances | Partially — `budget_usd`, `payment_milestone_usd`, `payment_status` (hand-set), `project_fees`; no ledger, no funded/disbursed state | `/admin/budgets` → **rename** | existing budgets page absorbs milestone state; ledger entities in Phase 2 |
| Tasks | Assigned follow-ups. *What has someone committed to do?* | tasks on a project, stage, issue or conversation; owner, due, status; feeds Action Center | — | **Does not exist** (searched `tasks`, `assigned_to`) | — | **new**, after the workspace exists to hang tasks on |
| Issues & Risks | Exception management. *What needs resolving?* | issues with severity, owner, due, resolution, stage; feeds health once real | customer support tickets (that is Support) | **Does not exist** | — | **new**, Phase 7 or later |
| Inspections | Scheduled site inspections. *Is an inspection due, and what did it find?* | schedule, checklist, inspector, pass/fail, findings → can raise an Issue or feed Verification | verification itself | **Does not exist** | — | **new**, last of the group; only if the verification standard (Vanessa's item) calls for it as distinct from verification |

### PEOPLE — *Who is involved, in what capacity?*

| Item | Purpose · primary question | Belongs here | Does not belong | Backing | Legacy | Initial form |
|---|---|---|---|---|---|---|
| Clients | Owner records. *Who are our clients and how are their builds going?* | profile, projects, tier, last sign-in, last activity, open tickets, conversations; provisioning (083) | contractors | Partially — `profiles` + owned projects; no client record beyond that | `/admin/users` (mixed) | **new** view over existing rows |
| Contractors | Directory and performance. *Who builds, and how well?* | directory, trade, projects, stages completed, on-time rate, rework count; → contractor record | applications (Acquisition) | Exists (`contractors`); performance derivable from stages + audit log | `/admin/contractors` | existing; performance view in Phase 7 |
| Verifiers | The professionals who verify. *Who can verify what, where, and are they available?* | role, credentials, location, assignments, workload | contractors | **Does not exist** | — | **new**, after the verifier decision |
| Agents | Sales/field agents, referral partners. *Who brings us clients?* | agent record, leads referred, conversions | the automation desk (System) | **Does not exist** — placeholder | — | **not built** until an entity exists |
| Team | Staff. *Who works here and with what role?* | admin accounts, roles once they exist (R5) | clients, contractors | Partially — `user_roles` has one `admin` role | `/admin/users` → **split** | existing users page becomes Team; permissions under System |

### COMMUNICATION — *What are people saying?*

| Item | Purpose · primary question | Belongs here | Does not belong | Backing | Legacy | Initial form |
|---|---|---|---|---|---|---|
| Inbox | The communication workspace. *What conversations need me?* | conversation list with person + project context; thread; reply vs internal note; **Record Decision**; assignment; GHL sync state | ticket lifecycle (Support) | **Does not exist** as an entity — `project_messages` is one flat thread per project, admin has no in-app view, inbound delivery not idempotent (audit §6, §8) | — | **new** `/admin/inbox`, `/admin/inbox/:conversationId`, Phase 6 |
| WhatsApp | Channel view | Inbox filtered to `channel = whatsapp` | a separate system | Partially — GHL carries WhatsApp; `origin='ghl'` rows exist | — | filter on Inbox |
| Email | Channel view | Inbox filtered to email | — | Partially — transactional mail is logged to GHL threads (`_email-log.ts`) | — | filter on Inbox |
| Calls | Channel view | Inbox filtered to calls; call summaries | — | **Does not exist** — no call records anywhere | — | filter on Inbox, empty until a source exists |

### ACQUISITION — *Where are prospective clients, contractors and opportunities?*

| Item | Purpose · primary question | Belongs here | Does not belong | Backing | Legacy | Initial form |
|---|---|---|---|---|---|---|
| Applications | Contractor pipeline. *Who applied, where are they?* | pending → reviewing → accepted/rejected/disqualified; accept → contractor record | — | Exists (`contractor_applications`) | `/admin/applications`, `/:id` | existing |
| Started Applications | Abandoned drafts. *Who started and stopped?* | drafts by completion %, follow-up | — | Exists (`contractor_application_drafts`) | `/admin/drafts` → **rename** | existing |
| Waitlist | Early interest | list, GHL sync state | — | Exists (`waitlist_emails`) | `/admin/waitlist` | existing |
| Quote Requests | Client → contractor introductions. *Who needs matching?* | open → introduced → declined → closed; contractor contact for staff; → Inbox conversation | — | Exists (`contractor_inquiries`); no reply/introduction flow | `/admin/inquiries` → **rename** | existing, gains introduction flow in Phase 7 |
| CRM | Pipeline view. *Where is each lead?* | pipeline stages as GHL knows them; sync status per contact | GHL *configuration* (System → Integrations) | Exists as configuration and health (`/admin/crm`); no in-app pipeline view | `/admin/crm` → **split** | health/config moves to Integrations; a pipeline view is **new** |

### SUPPORT — *What customer issue needs resolution?*

| Item | Purpose · primary question | Belongs here | Does not belong | Backing | Legacy | Initial form |
|---|---|---|---|---|---|---|
| Support | Cases with a lifecycle. *Which tickets are open and whose are they?* | open → in progress → resolved → closed; account-deletion requests; link to person and project; in-app reply via Inbox | general conversation | Exists (`support_tickets` 074); reply is `mailto:`, `admin_notes` not surfaced | `/admin/support` | existing; reply moves into Inbox in Phase 6 |

Kept separate from Communication on purpose: a ticket may begin as a message, but it has its own lifecycle and a resolution.

### ANALYTICS — *What does the operation tell us?*

| Item | Purpose | Backing | Initial form |
|---|---|---|---|
| Analytics | Operational and financial aggregates over time | Partially — counts computable; trends need the activity model | **new**, last |
| Reports | Exportable, periodic | none | **new**, last |

### SYSTEM — *How does the platform connect, and who may do what?*

| Item | Purpose · primary question | Belongs here | Does not belong | Backing | Legacy | Initial form |
|---|---|---|---|---|---|---|
| Integrations | External services. *Is each connection healthy and configured?* | **GoHighLevel** (today's `/admin/crm` config, token, outbox, field repair); **SwyChr** (placeholder until sandbox/docs) | the pipeline view (Acquisition → CRM) | GHL: Exists; SwyChr: **does not exist** | `/admin/crm` → **move** | existing page relocated |
| Automation Requests | The desk for the repository's Claude Code agents — videos, decks, budget analyses. *What has been asked of the agents?* | `agent_requests` queue, status, outputs | sales agents | Exists (`agent_requests` 054–058) | `/admin/requests` → **rename + move** | existing |
| Team & Permissions | Roles. *Who may verify, release money, read support?* | role assignment once roles exist (R5, R6) | — | Partially — one role | — | **new** after roles |
| Audit Log | Trail. *Who did what, when?* | `project_audit_log` + `admin_deleted_projects` + `security_notify_log` resolved to names | — | Partially — four partial logs, no unified event | — | **new** view over existing rows |
| Settings | Runtime configuration | `app_config` keys that are safe to expose | secrets | Exists (`app_config`, locked) | — | **new**, minimal |

## 4. Legacy navigation → new IA

Every one of the thirteen current `ADMIN_NAV` entries has a home. Nothing is removed.

| Legacy (`ADMIN_NAV`) | Route | Becomes |
|---|---|---|
| Overview | `/admin` | OVERVIEW → Overview |
| Reviews | `/admin/reviews` | PROJECT OPERATIONS → Stages & Reviews (rename) |
| Budgets | `/admin/budgets` | PROJECT OPERATIONS → Payments & Budgets (rename, widen) |
| Projects | `/admin/projects` | PROJECT OPERATIONS → Projects |
| Users | `/admin/users` | PEOPLE → Team (and Clients as a new view over the same rows) |
| Contractors | `/admin/contractors` | PEOPLE → Contractors |
| Applications | `/admin/applications` | ACQUISITION → Applications |
| Waitlist | `/admin/waitlist` | ACQUISITION → Waitlist |
| Started applications | `/admin/drafts` | ACQUISITION → Started Applications |
| Agent Requests | `/admin/requests` | SYSTEM → Automation Requests (rename, move) |
| Support | `/admin/support` | SUPPORT → Support |
| Quote Requests | `/admin/inquiries` | ACQUISITION → Quote Requests |
| CRM | `/admin/crm` | SYSTEM → Integrations → GoHighLevel (move); a pipeline view under ACQUISITION → CRM is new |

Routes stay where they are until Phase 7; a rename is a label and a sidebar position, not a URL change. `nav-config.test.ts` (uncommitted) already checks that every sidebar entry is a real route and every admin route has an entry — it applies unchanged to the new nav when the time comes.

## 5. What is *not* a sidebar item, and where it lives instead

| Not in the sidebar | Lives in |
|---|---|
| GoHighLevel, SwyChr | System → Integrations. They are infrastructure under the product, never the mental model |
| Project detail, stages, evidence, budget, conversations *of one project* | the Project Workspace `/admin/projects/:id` |
| Contractor detail, client detail | person records opened from People |
| Notifications | the bell in the top bar (exists; admin shell wiring is in the uncommitted slice) and an `/admin/notifications` list if needed — not a nav destination |
| Create project, provision client | actions from Projects and Clients (`/admin/projects/new`, `/admin/users/new` exist) |
| Staff sign-in | `/admin/login`, outside the shell by design |
| Migration status, environment | not a screen; a `docs/` concern until a ledger exists (audit R7) |
| Site Managers | not a role today; if the verification standard introduces one, it joins People |

## 6. Rules every item obeys

1. **No dead ends.** Every row in every queue opens the Project Workspace, a person record, or a conversation. A list that cannot be clicked through is a report, and reports live under Analytics.
2. **Queues are views, not owners.** Stages & Reviews, Payments & Budgets, Quote Requests and Support *display* state that belongs to the project, the person or the conversation. They never hold data of their own.
3. **The Overview computes, never asserts.** Every number has a query behind it (audit §18 lists what is computable today). No hard-coded metric, no mock row.
4. **Communication is one system.** WhatsApp, Email and Calls are filters on the Inbox. A second conversation store is not created; GHL is mirrored into the one that exists once it has a Conversation entity.
5. **Verification is visible even before it is real.** The item stays in the sidebar with an honest empty state, because the audit shows the product's central promise has no structural backing yet (§4, R3). Hiding it would hide the gap.
6. **Both languages.** Every label is a `TKey` in `en.ts` and `fr.ts`; the shell's `NavItem` type already enforces this at compile time.
7. **Design rules stand.** No emoji; black-and-white icons; colour as status accent only; "processing fee". The mockups in `docs/admin/` are illustrative, not specification.

## 7. What Phase 2 audits against this

For each item marked *Partially* or *Does not exist* in §3, Phase 2 decides the entity: verifier role and `project_verifiers`; stage verification rows; site update as a record; `payment` / `disbursement` with a provider reference and funded/eligible state; `conversation` with nullable `project_id`, `channel`, `direction`; unified activity; tasks; issues; inspections (only if the verification standard needs them apart from verification). It also resolves the two schema risks the sidebar depends on: R1 (inbound message idempotency) before Inbox, R6 (the `user_roles` CHECK) before any new role.

## 8. Decisions requested before Phase 2

1. Confirm the sidebar as locked in §2, including *Stages & Reviews* separate from *Verification*.
2. Confirm **Automation Requests** as the name for the agent desk, freeing *Agents* for people.
3. Confirm *Users → Team + Clients* split.
4. Confirm *Calls* stays as an empty channel filter rather than being dropped until a source exists.
