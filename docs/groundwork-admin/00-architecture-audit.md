# Groundwork — admin architecture audit (Phase 0)

**Date:** 12 September 2026 · **Repo state:** `main` at `b90da13` plus one uncommitted overview slice (see §18) · **Author:** Claude Code, read-only pass · **Reader:** Philip, Favour

## 0. How to read this

This is an audit, not a design. It answers five questions without opening the repo:

1. **What does Groundwork actually have?** — §1–§3, §6–§14
2. **What does the current admin actually do?** — §1, §12, §18
3. **What can we reuse?** — §15 (verdict A), §12
4. **What is genuinely missing?** — §4, §15 (verdict C)
5. **What must Product decide before we build?** — §16, §17; risks §20; recommended IA and sequence §21–§22 (recommendations only — nothing is implemented)

Every "exists" carries a file path. Every "does not exist" says what was searched. Where a conceptual entity has no dedicated table, the report separates *no dedicated entity* from *no supporting data* and names the supporting representations — a concept is not impossible because no table shares its name.

**Rules followed.** No application code, migration, configuration, dependency, generated file or existing uncommitted work was modified. This file is the only change. Nothing was fixed along the way — inconsistencies are recorded as findings. No SwyChr endpoint is assumed: it is a planned external dependency awaiting sandbox access and documentation.

**Sources beyond the code.** `docs/admin/Groundwork_90_Day_Admin_Product_Owner_Plan_v2_SwyChr.docx` (the plan; the `.pptx` is the same as slides and the two v2 `.docx` are byte-identical), and three meeting records in `docs/meetings/`: *Beta Testers Feedback Implementation* (3 Sep, 13 pp), *Groundwork Co-ordination and Verification* transcript (9 Sep, 22 pp), *REAL LIFE PROJECT EXAMPLE* (Vanessa, 5 pp). `docs/meetings/` is committed (`3f8811e`); `docs/admin/` is untracked.

**Two earlier artefacts, and their standing.** `docs/ADMIN-DASHBOARD.md` (12 Sep) is a plan from the earlier *dashboard-first* approach; its "Phase 1 — built" refers to the overview slice below. It is **historical context and evidence, not the approved architecture** — where it conflicts with the Project Workspace + Unified Inbox direction, this audit and the phases that follow it win. It is left unmodified. The **uncommitted overview slice** it describes is likewise held as implementation evidence (§18): not committed, staged, extended or deleted.

**Product framing.** Cameroon-first: XAF and USD, Buea/Douala/Yaoundé/Bamenda. The ChatGPT mockups in `docs/admin/` show Naira and Nigerian cities; that is placeholder and is not carried into any finding here.

### At a glance

**Already has substantial foundations:** projects · ten stages and their substages · evidence upload against substages · stage approval with an audit trail · payment milestones per stage (`payment_milestone_usd`, `payment_status`) · budgets, fees and contractor take-offs · contractor applications → directory → invites · admin-provisioned client accounts (083) and admin project creation (082) · notifications with realtime · GoHighLevel sync with an outbox · support tickets and quote requests · admin authorisation and RLS throughout · a shared client/admin shell.

**Missing or structurally incomplete:** a Project Workspace · a Conversation entity and a Unified Inbox · a unified activity/event model · a verifier role and any verification record beyond "an admin approved it" · site updates, inspections, tasks and issues as entities · funded / committed / spent / available financial state · any disbursement or provider-reference record (SwyChr is unbuilt and undocumented) · a cross-project Action Center · admin roles beyond a single `admin` · an admin notification experience · idempotent inbound message delivery.

The detail behind both lists is §15; the decisions they raise are §17.

---

## 1. Routes and pages

`src/app/routes.ts` declares **49 routes** in seven groups. React Router v7 framework mode, `ssr: false` — no loaders or actions; every page fetches client-side after auth resolves.

| Group | Layout | Routes |
|---|---|---|
| Public | `_public-layout.tsx` | `/`, `contractor-apply`, `pricing`, `jalla-management`, `verify/:id`, `privacy`, `terms` |
| Auth | `_auth-layout.tsx` | `auth/login`, `auth/signup`, `auth/reset-password`, `auth/new-password`, `auth/callback`, `onboarding`, `invite/:token` |
| Wizard | own shell | `projects/new` (11 steps, `src/components/wizard/`) |
| Client app | `_layout.tsx` (sidebar + `NotificationBell`) | `dashboard`, `documents`, `projects`, `projects/:id`, `projects/:id/takeoff`, `projects/:id/takeoff/:takeoffId`, `resources`, `resources/:slug`, `contractors`, `payments`, `upgrade`, `notifications`, `profile`, `help` |
| Free tools | `tools/_tools-layout.tsx` | `tools`, `tools/budget`, `tools/stages`, `tools/milestones`, `tools/tracker` |
| Staff sign-in | none | `admin/login` |
| Admin | `admin/_admin-layout.tsx` | `admin`, `reviews`, `budgets`, `projects`, `projects/new`, `users`, `users/new`, `contractors`, `applications`, `applications/:id`, `crm`, `waitlist`, `drafts`, `requests`, `support`, `inquiries` |

### What each admin page does today (`src/app/routes/admin/`)

| Page | Reads | Actions |
|---|---|---|
| `index.tsx` Overview | five counts | links only — see §18 for the uncommitted replacement |
| `reviews.tsx` | `project_stages.status='pending_review'` with substages and evidence links | `adminApproveStage`, `adminRequestRework` (`src/lib/supabase/approvals.ts`) |
| `budgets.tsx` | Jalla Management projects with `tracking_started_at IS NULL` | `adminStartProjectTracking` (`src/lib/supabase/tracking.ts`, RPC 072) |
| `projects.tsx` | all projects; owners via `ownerLookup()` | assign contractor (`admin_assign_contractor` 029), delete (`admin_delete_project` 069) |
| `projects.new.tsx` | — | create a project on a client's behalf (`admin_insert_projects` 082). **Assigns no contractor and no verifier** — searched for `contractor`, `verifier`, `assign` in the file: zero matches |
| `users.tsx` | `admin_list_users()` (083) | delete user (`admin_delete_user` 039), CRM backfill panel |
| `users.new.tsx` | — | provision a client: full name, email, phone, country, language → `api/events?action=admin-provision-user` |
| `contractors.tsx` | `contractors` directory | toggle active, delete |
| `applications.tsx`, `applications.detail.tsx` | `contractor_applications` | set status (accept → `admin_promote_application` 033 + decision email), acknowledge, resync to CRM |
| `waitlist.tsx`, `drafts.tsx` | `waitlist_emails`, `contractor_application_drafts` | delete |
| `requests.tsx` | `agent_requests` | file/track video and deck requests |
| `support.tsx` | `support_tickets` (074) | change status; reply is a `mailto:` link, no in-app reply, `admin_notes` not editable |
| `inquiries.tsx` | `contractor_inquiries` (076) | change status; no reply; contractor contact not shown |
| `crm.tsx` | GoHighLevel health | retry outbox, diagnose, field repair, audit, backfill, pipeline ids |

Sidebar: `ADMIN_NAV` in `src/components/shell/nav-config.ts`. **Admins have no notification bell** in the committed code — `_admin-layout.tsx` passes no `topBarActions`, so the admin notifications written by triggers 074 and 076 are visible only on the client shell's `/notifications` page.

### Contractor experience

There is no contractor dashboard. A contractor (`user_metadata.role === 'contractor'`, checked in five files: `dashboard.tsx`, `payments.tsx`, `projects/detail.tsx`, `projects/index.tsx`, `StageTracker.tsx`) gets the same shell and `CLIENT_NAV` as an owner, including Payments and the contractor directory. On `/projects/:id` they are limited to `CONTRACTOR_TABS = stages, messages` (`detail.tsx` L65–68) — but `activeTab` initialises to `'overview'` (L138) with no role check, so their first render is the Overview tab, budget included, with no tab highlighted. They can upload substage evidence, create and submit a take-off, and use the project thread.

---

## 2. Schema

**35 tables** (`grep CREATE TABLE supabase/migrations/*.sql`, deduplicated), 84 migration files (001–084 with two `043_` and two `045_`, `006` renamed `.sql.applied`, no `007`, one dated `20260714…`). Applied by pasting into the SQL editor; there is no migration ledger, so "applied" is knowledge that lives with Favour.

| Domain | Tables |
|---|---|
| Project | `projects`, `project_stages`, `project_substages`, `project_documents`, `project_messages`, `project_audit_log`, `project_fees`, `project_takeoffs`, `certificates` |
| People | `profiles`, `user_profiles`, `user_roles`, `contractors`, `contractor_invites`, `contractor_applications`, `contractor_application_drafts`, `contractor_inquiries` |
| Growth | `waitlist_emails`, `waitlist_members` |
| Money | `billing_events` |
| Rates | `construction_rates`, `construction_city_rates` |
| CRM | `ghl_outbox`, `ghl_inbound_events`, `ghl_oauth_tokens`, `ghl_delivery_log`, `ghl_sync_failures` |
| Ops | `notifications`, `support_tickets`, `app_config`, `agent_requests`, `agent_notify_log`, `security_notify_log`, `admin_deleted_projects`, `email_otp_challenges` |

Storage buckets (private unless stated): `evidence`, `documents`, `id-documents`, `contractor-docs`, `agent-outputs`, `certificates` (public read; created in the dashboard, not by migration).

### Foreign-key graph — what the database believes the relationships are

38 edges. `→ auth.users` means the identity, not `profiles`; PostgREST therefore **cannot join `projects → profiles`**, which is why every admin page resolves owners client-side through `ownerLookup()` (`src/lib/supabase/admin-users.ts`).

```
auth.users ←─ profiles.id (CASCADE)            ←─ user_roles.user_id (CASCADE)
           ←─ projects.user_id (CASCADE)       ←─ projects.created_by (SET NULL, 082)
           ←─ notifications.user_id (CASCADE)  ←─ billing_events.user_id (SET NULL)
           ←─ support_tickets.user_id, contractor_inquiries.user_id, agent_requests.requested_by,
              admin_deleted_projects.deleted_by, profiles.provisioned_by (all SET NULL)
           ←─ project_audit_log.actor_id, project_documents.uploaded_by, project_messages.sender_id,
              contractor_invites.invited_by, contractor_invites.contractor_user_id,
              project_substages.approved_by, project_takeoffs.created_by (NO ACTION — these
              block a user delete, which is why admin_delete_user() clears them first)
           ←─ email_otp_challenges.user_id (CASCADE)

projects   ←─ project_stages, project_substages, project_documents, project_messages,
              project_audit_log, contractor_invites, certificates, project_fees,
              project_takeoffs   (all CASCADE — deleting a project takes everything)
           ←─ profiles.ghl_thread_project_id (SET NULL, 077)

project_stages ←─ project_substages.stage_id (CASCADE), certificates.stage_id (CASCADE),
                  project_documents.stage_id (SET NULL), project_audit_log.stage_id (NO ACTION)

contractor_applications ←─ contractors.application_id (SET NULL), ghl_sync_failures (CASCADE),
                           contractor_application_drafts.submitted_application_id (SET NULL)
contractors ←─ contractor_inquiries.contractor_id (CASCADE)
```

**What the graph does not contain** — no table references `contractors` *from a project* (assignment is by email in `contractor_invites`, optionally resolved to `contractor_user_id`); nothing references a verifier; `billing_events` and `project_fees` do not reference each other or a stage; `support_tickets` and `contractor_inquiries` reference no project.

---

## 3. Core models as implemented

**Project** — `projects` (`src/types/project.ts` L345). `status ∈ active | on_hold | completed | archived`; `tier ∈ self_verify | jalla_verify | jalla_management` (legacy `starter|pro|enterprise` still handled by `normalizeTier()`); `current_stage` 1–10; `tracking_started_at` NULL until the owner (or admin, for Management) confirms a budget; `budget_usd`; `created_by` since 082.

**Stages and substages** — ten per project, seeded by `src/lib/supabase/stage-seeds.ts` from `stage_key`; `project_stages.status ∈ locked | active | pending_review | complete`, `payment_status ∈ unpaid | partial | paid`, `payment_milestone_usd`, `planned_start`, `planned_end`, `completed_at`, `fixed_amount_usd`. Substages carry `evidence_urls jsonb[]` (storage paths in `evidence`), `status`, `approved_by`, `approved_at`, `completed_at`.

**Review** — not a table. It is `project_stages.status = 'pending_review'` plus the audit log (`stage_submitted_for_review`, `stage_approved`, `stage_approved_by_admin`, `rework_requested`, `admin_assigned_contractor`). Who approves is decided by tier in `approvals.ts` L21–22 and L48: self-verify approves itself; anything else goes `pending_review` and an admin approves (`adminApproveStage` L179) or sends it back (`adminRequestRework` L317, which resets pending substages to `in_progress`).

**Budget** — `projects.budget_usd` + `project_stages.payment_milestone_usd` (derived by `apply_budget_milestones` 072) + `project_fees` (kind `permit | professional`, 036/072 split professional into verification, site manager, QS, lawyer, PM, contingency) + `project_takeoffs` (contractor BQ, 039). Rates: `construction_rates`, `construction_city_rates`, engine in `src/lib/budget/`.

**Profile / user** — `auth.users` + `profiles` (`full_name`, `email` mirror, `country`, `preferred_lang`, `preferred_theme`, `subscription_tier`, `must_change_password`, `provisioned_by`, `ghl_*`) + `user_profiles` (legacy, 005) + `user_roles` (`homeowner | contractor | admin | verifier` by CHECK in 001 — see §10; `admin` rows inserted by hand per 009; `verifier` permitted, unused).

**Contractor** — `contractor_applications` (`pending | reviewing | accepted | rejected | disqualified`) → `admin_promote_application` (033) inserts a `contractors` directory row → `contractor_invites` (`pending | accepted | rejected`, `role`, `token`, `contractor_user_id`) → `contractor_inquiries` (`open | introduced | declined | closed`) for client quote requests. Contact fields were removed from the browser grant in 075.

**Certificates** — `certificates` (014), one per approved stage, PDF in the public `certificates` bucket, revocable since 079, restricted to Jalla Verify (beta-feedback action item, done).

---

## 4. The verification loop, link by link

The 9 Sep meeting and the plan describe *Project → Stage → Evidence → Independent verification → Approval → Payment eligibility → Disbursement → Next stage*. This is what the database and code can represent today for each link.

| Link | Today | Finding |
|---|---|---|
| **Stage** with a lifecycle | `project_stages.status` has four values | **Exists**, coarse. No `evidence_required`, `evidence_submitted`, `verification_in_progress`, `verified`, `payment_eligible`. `pending_review` is the only "waiting" state. |
| **Evidence** attached to a stage | `project_substages.evidence_urls` (paths), `project_documents` with `stage_id` (017), `evidence` bucket. Upload in `src/components/project/EvidenceUpload.tsx` | **Exists.** Photos and files per substage. No GPS, no timestamp beyond the row, no "site update" as its own record, no submitted-by on the array entries. |
| **Assigned verifier** | the role *value* `verifier` is permitted by `user_roles` (001) but no row uses it, nothing reads it, and there is no assignment to a project | **No representation beyond a permitted enum value.** *(Corrected 12 Sep: the first draft said the CHECK excluded it — see §10.)* Searched `contractor_invites.role`, every migration and route for `verifier`, `inspector`, `engineer`, and `src/` for any read of `role = 'verifier'` — none. `contractor_invites` could carry a verifier only by overloading `role`. |
| **Verification** as an event | `approveStage` / `adminApproveStage` / `adminRequestRework`; `approved_by` on substages; audit actions | **Admin stands in.** On Jalla Verify the reviewer is whoever holds `is_admin()`, from uploaded photos. The 3 Sep notes say an independent professional must visit the site (p.12); nothing records a visit, a finding, a checklist or who verified. |
| **Approval** | stage → `complete`, next stage → `active`, certificate issued | **Exists.** |
| **Payment eligibility** | `payment_milestone_usd` set at tracking start; `payment_status` written by `updatePaymentStatus` (`projects.ts` L364) — a manual flag | **Partially exists.** Eligibility is implied by `status='complete'`; nothing computes or records "eligible". |
| **Disbursement** | none | **No representation.** Searched `api/`, `src/lib` for payout, disburse, momo, mobile-money, Switchr/SwyChr call sites: only copy and comments. No transaction, beneficiary or provider-reference table. |
| **Next stage** | unlock on approval | **Exists.** |

**Summary.** Two of seven links have no representation (verifier, disbursement); one is the admin standing in for a role the business has now separated out (verification); one is a manual flag (eligibility). The other three are solid.

---

## 5. Money as implemented

- **Subscriptions — live.** Stripe Checkout, portal and webhook (`api/stripe/*`, `api/_lib/stripe.ts`, migration 021, `billing_events`). `SUBSCRIPTIONS_ARE_PREVIEW = false` (`src/lib/payments/config.ts` L25). Tier guards 060–062 mean only the webhook (service role) can grant a paid tier.
- **Milestone payments — preview.** `MILESTONE_PAYMENTS_ARE_PREVIEW = true` (L22). The wallet, fee split, FX and payout tracker in `src/components/payments/` are simulated. Real: per-stage `payment_status` set by hand.
- **Nothing moves money to a contractor today.** There is no payout code path (searched as in §4).
- **Vendor naming.** The plan names **SwyChr** (22 mentions, "SwyChr Connect") — the code says **"Switchr"** in `src/lib/payments/config.ts` (3), `src/lib/legal/content.ts` (3, shipped terms), `api/_lib/stripe.ts` (2), `src/lib/payments/subscription.ts`, `api/stripe/create-checkout-session.ts`, plus `docs/*.md`; **"SwyChr"** in `src/app/routes/dashboard.tsx` and one doc. `docs/memo.md` (31 Jul) flagged the capitalisation as "assumption to confirm"; it was never confirmed. Decision in §17.

---

## 6. Conversation / message model

`project_messages(id, project_id, sender_id NULL-able since 077, sender_name, content, created_at, origin 'platform'|'ghl', ghl_message_id, ghl_synced_at)`. **One flat thread per project.**

Against the plan's Conversation/Message spec: no `conversation` entity; no channel on a message beyond `origin`; no direction, status, subject, assignment, participants, attachments, internal notes, threading, mentions, read receipts, or per-user unread state (searched 004 and 077 for `read_at`: none); no pagination (`fetchMessages` in `src/lib/supabase/messages.ts` loads every row); no admin view in the app (`project_messages` is imported by `detail.tsx`, `ProjectChat.tsx`, `messages.ts` and a test only). `project_id` is NOT NULL, so a conversation cannot exist before a project — the plan's §19 needs that nullable.

The admin's view of chat is GoHighLevel: 077 mirrors platform messages onto the *owner's* GHL contact thread; `api/_handlers/conversation-delivery.ts` writes GHL replies back as `origin='ghl'`. A GHL thread is per contact, so a reply is filed to `profiles.ghl_thread_project_id` — the last project mirrored — a documented heuristic that is wrong whenever a client has two projects. Contractor messages go to the owner's thread.

Notifications: `notifications(user_id, type, title, body, data jsonb, read_at)`; `notifyAdmins` / `notifyProjectMembers` RPCs (013); triggers 074/076 also write admin rows. `NotificationBell` navigates only on `data.project_id` in the committed code, so support and inquiry notifications (`ticket_id`, `inquiry_id`) are dead clicks.

---

## 7. GoHighLevel architecture

Three transports, chosen at runtime by what is configured (`api/ghl/_forward.ts`): **API v2** (`deliverViaApi` L234 — contacts upserted by email, tags, pipeline moves, custom fields) when a token is present; **inbound webhook** (`deliverViaWebhook` L288) otherwise; and the **outbox** (`ghl_outbox`, 050) for anything that fails, replayed from `/admin/crm` or `crm-retry`. Settings live in `app_config` (064: `ghl_pipeline_id`, `ghl_stage_map`, `ghl_inbound_secret`, `ghl_contractor_webhook_mode`) with env fallback. OAuth tokens for the Marketplace app in `ghl_oauth_tokens` (067), needed because the conversations endpoint refuses a Private Integration Token (`docs/GHL-SETUP.md`). Transactional email is sent by Resend and *recorded* on the GHL thread (`api/ghl/_email-log.ts`). Delivery attempts logged in `ghl_delivery_log` (068), failures in `ghl_sync_failures` (065). Contact ids on `profiles.ghl_contact_id`, `contractor_applications.ghl_contact_id`.

Boundary as built matches the plan's §15: Supabase is the source of truth for projects, stages, budgets; GHL holds contacts, pipeline and external conversations; Groundwork keeps the ids.

---

## 8. Webhooks and idempotency

| Direction | Endpoint / mechanism | Auth | Idempotent? |
|---|---|---|---|
| Stripe → app | `api/stripe/webhook.ts` | signature | yes — `dedupeKey: subscription_changed:${eventId}` into the outbox; `billing_events` keyed on the event |
| GHL → app (events) | `api/events?action=crm-inbound` → `api/_handlers/inbound.ts` | `X-Groundwork-Secret`, constant-time compare, refuses if unset | records to `ghl_inbound_events` and stops — deliberately does not act |
| GHL → app (messages) | `api/events?action=crm-delivery` → `conversation-delivery.ts` | provider config | **No.** Plain `insert` into `project_messages` with `ghl_message_id`; 077 adds only a partial index for *unmirrored* rows, no UNIQUE, and the handler does no existence check (L85–120). A replayed webhook creates a duplicate message. |
| app → GHL | `_forward.ts`, `api/ghl/contractor.ts`, `contractor-application-notify.ts` | token / webhook URL | yes — `ghl_outbox.dedupe_key UNIQUE` (050 L66) |
| DB → Resend | `pg_net` from triggers 059 (agent requests), 070 (password changed), 074 (support), 076 (inquiries) | `resend_api_key` in `app_config` | n/a (one send per row insert) |
| DB → Vercel | 056 `agent_dispatch_url` (optional) | shared secret | n/a |

The plan's §17 rule — "every external record needs an external ID and sync must be idempotent" — holds outbound and for Stripe, and **fails inbound for messages**. That is the one to fix before any Unified Inbox work.

---

## 9. Pipeline and stage mapping

`api/ghl/_pipeline.ts`: `tagsFor(event, variant, lang, tier)` builds tags (`groundwork:homeowner|contractor`, `groundwork:en|fr`, `groundwork:self-verify|jalla-verify|jalla-managed`); `stageForKey(key, fallback)` reads `ghl_stage_map` JSON where a value is either `"<stageId>"` (default pipeline) or `"<pipelineId>/<stageId>"` (its own board — contractors and homeowners are separate funnels). Custom fields in `docs/GHL-CUSTOM-FIELDS.md`; field repair at `/admin/crm`. Tests: `src/lib/contractor/pipeline-stage.test.ts`. The two pipelines and their stage ids are configuration, not code — set by pasting ids from `/admin/crm → Show pipeline & stage ids`.

---

## 10. Authentication and authorisation

- Supabase Auth, PKCE; email confirmation on; Google OAuth wired; password policy shared by signup and reset (`src/lib/auth/password-policy.ts`); TOTP MFA (`src/lib/auth/mfa.ts`) challenged at login and callback, plus a hand-built email second factor (080, `email_otp_challenges`, `mfa-email` action) that does not raise Supabase's AAL.
- **Roles.** `user_roles.role` is constrained by **migration 001** to `homeowner | contractor | admin | verifier` — `verifier` was anticipated from the first migration. The later `20260714…` file redeclares the table with a narrower CHECK (`homeowner | contractor`) inside `CREATE TABLE IF NOT EXISTS`, which is a no-op against the table 001 created; nothing drops or alters it in between, so **001's constraint is the live one**. *(Corrected 12 Sep: the first draft read the narrower CHECK as live and called the admin rows a schema/reality mismatch — they are not.)* In use: `homeowner`, `contractor`, and `admin` (rows inserted by SQL per 009; `is_admin()` 075 is `EXISTS(user_roles WHERE role='admin')` with a fixed `search_path`). **`verifier` is permitted but unused** — no row, no read anywhere in `src/` or `api/`, no assignment to a project. There is no `ops`, `finance`, `growth`, `agent` or `site_manager`. Admin identity is *not* JWT metadata.
- **Provisioned clients (083):** `api/_handlers/admin-provision-user.ts` creates the user with `auth.admin.createUser`, a temporary password generated server-side and returned exactly once; `profiles.must_change_password = true`, `provisioned_by`; the flag is cleared by a trigger only when the password hash actually changes; first-login gate in `src/lib/auth/provisioned.ts`. This matches the meeting's "client completes security on first login". The admin project wizard (082) does not yet chain from it.
- Contractor access: invite token → `/invite/:token` → `accept_contractor_invite` (SECURITY DEFINER, `20260714…`) → `contractor_invites.contractor_user_id` + `user_roles` row.

---

## 11. Row-level security

**105 policies across 27 tables plus `storage.objects`** (`grep CREATE POLICY`). Nine tables have RLS on and **no policy at all** — reachable only through SECURITY DEFINER functions: `app_config`, `agent_notify_log`, `security_notify_log`, `ghl_outbox`, `ghl_inbound_events`, `ghl_oauth_tokens`, `ghl_delivery_log`, `ghl_sync_failures`, `email_otp_challenges`.

Shape of access on the project tables: owner `ALL` (split to SELECT/INSERT/UPDATE on `projects` by 053 — owners cannot delete); admin SELECT everywhere (009) plus UPDATE on stages/substages and INSERT on stages/substages/documents/fees/projects (082); contractor SELECT on invited projects/stages/substages, UPDATE on substage evidence, SELECT/INSERT on messages (`20260714…`).

`WITH CHECK (true)` inserts remaining: waitlist (002, intended — public form), notifications admin insert (009, gated by `is_admin()` in the USING), contractor applications and drafts (026/028/043, intended — anonymous applicants). The certificate one (014) was replaced in 079.

**43 SECURITY DEFINER functions** (names in the migration list; the admin surface is `admin_*`: `list_users`, `list_contractors`, `assign_contractor`, `promote_application`, `delete_user`, `delete_project`, `start_project_tracking`, `ghl_outbox`, `ghl_sync_failures`, `ghl_delivery_log`, `project_activity`). 066 and 075 pinned `search_path` on the ones that matter. Every admin function re-checks `is_admin()` inside.

---

## 12. Reusable UI

Exists (`src/components/ui/`): `StatusBadge` (dot + word, states from `src/lib/status.ts`), `EmptyState`, `ConfirmModal`, `ConfirmDelete` (with consequence acknowledgement), `NotificationBell`, `FileIcon`, `LanguageToggle`, `ThemeToggle`, `PasswordStrength`, `tooltip`, `button`, `input`, `label`. Shell: `AppShell`, `AppSidebar`, `nav-config.ts` (data-driven nav shared by client and admin). Charts are hand-rolled inline SVG in `dashboard.tsx` (`CostingDonut`, `JourneyCard`) — no chart library. Map: `react-leaflet` used once, `src/components/wizard/CountryMap.tsx`. Formatting: `src/lib/format.ts` (`formatMoney`, `formatRelative` in EN/FR). Stage names: `useStageLabels()`. Design rules that bind: no emoji, black-and-white icons, colour as status accent only, "processing fee" (`docs/SCREEN-DESIGNS.md`).

**Assumed by the mockups and absent:** a generic `DataTable` with sort/filter/pagination (each admin page hand-rolls its table), `Timeline`, `ProgressBar` as a component, global search, breadcrumbs, a project header, a conversation list/thread/composer, `FilterBar`, donut/bar chart components, a map with project pins.

---

## 13. API and server actions

Vercel serverless, **11 of the Hobby plan's 12 functions** in use: `agent-dispatch`, `contractor-application-notify`, `events`, `ghl/contractor`, `send-application-decision`, `send-email`, `send-invite`, `stripe/create-checkout-session`, `stripe/create-checkout-session-guest`, `stripe/portal`, `stripe/webhook`. `api/events.ts` is a dispatcher over **18 actions** (`crm-user`, `crm-project`, `crm-resync`, `crm-retry`, `crm-inbound`, `crm-status`, `crm-diagnose`, `crm-fields`, `crm-audit`, `crm-delivery`, `crm-oauth`, `crm-backfill`, `crm-email-test`, `crm-chat-mirror`, `certificate-purge`, `mfa-email`, `admin-provision-user`, `profile-geo`), handlers one-per-file in `api/_handlers/`. Two rules with tests behind them (`src/lib/email/api-function-count.test.ts`, `api-import-graph.test.ts`): stay under 12 functions (over the cap, deploys fail silently and the old build keeps serving); relative imports under `api/` need `.js` extensions, transitively. New server logic should be an action here or, preferably, a Postgres RPC.

---

## 14. Data fetching and realtime

Client-side `supabase-js` in route modules and `src/lib/supabase/*` (19 modules by domain). Privileged reads go through RPCs. Owners resolved client-side (§2). Lists are unpaginated (`project_messages`, admin tables). Four realtime channels: `project-messages-${projectId}` (`messages.ts` L90), `project-stages-${id}` (`projects/detail.tsx` L171 — payment status), `notifications:${userId}` (`NotificationBell.tsx` L104), `notifications-realtime` (`notifications.tsx` L109). Tests: vitest, node environment, 45 files / 590 tests on `main` (617 with the uncommitted slice).

---

## 15. Domain-model reconciliation

Status is the plain classification asked for; Verdict says what to do about it: **A** existing capability · **B** existing infrastructure that can be extended · **C** genuine product/data gap.

| Concept (plan §3–§14) | Status | Dedicated entity? | Supporting representations today | Verdict |
|---|---|---|---|---|
| Person | **Partially exists** | no | `auth.users` + `profiles` + `user_roles`; contractors also in `contractor_applications`/`contractors`; a person can be owner, contractor and admin at once | **B** — one identity exists; "Person" is a view over it |
| Client | **Partially exists** | no | `profiles` where the user owns projects; `subscription_tier`; provisioned flag (083) | **B** |
| Contractor | **Exists** | yes | `contractors` (directory) ← `contractor_applications`; project link via `contractor_invites` by email | **A** for the profile, **B** for performance (derivable from stages/audit) |
| **Verifier** | **Does not exist** | no | only the enum value `'verifier'` in `user_roles` (001), unused; no profile, assignment, verification record or code path — searched invites, migrations, routes, `src/`, `api/` | **C**, with the role value already permitted |
| Agent | **Does not exist** | no | `agent_requests` is a *media-production* queue, not a sales agent; no agent role | **C** (and a naming collision to avoid) |
| Project | **Exists** | yes | `projects` + the CASCADE family | **A** |
| ProjectStage | **Exists** | yes | `project_stages` + `project_substages`; four statuses; planned/completed dates | **A**, **B** for the richer lifecycle |
| StageReview / Verification | **Partially exists** | no | `status='pending_review'` + audit log + `approved_by` | **B** for admin review; **C** for independent verification (no verifier, visit, findings, checklist) |
| Evidence / SiteUpdate | **Partially exists** | no dedicated row | `evidence_urls` on substages, `project_documents.stage_id`, `evidence` bucket | **B** — the bytes and the stage link exist; the *update* (who, when, where, description) does not |
| Budget | **Partially exists** | partial | `budget_usd`, milestones per stage, `project_fees`, take-offs | **A** for estimate/allocation; **C** for funded/committed/spent/available |
| PaymentMilestone | **Partially exists** | partial | `payment_milestone_usd` + `payment_status` per stage | **B** |
| Payment | **Does not exist** | no | `billing_events` is subscription-only | **C** |
| Disbursement | **Does not exist** | no | nothing — §4 | **C**; external dependency (SwyChr) |
| Conversation | **Does not exist** | no | one implicit thread per project; GHL thread per contact | **C** as an entity; **B** for the message rows |
| Message | **Exists** | yes | `project_messages` | **A** minimal; **B** for channel/direction/status |
| InternalNote / Decision | **Does not exist** | no | audit log can hold `details jsonb`; nothing user-facing | **C** |
| Activity (unified event) | **Partially exists** | no | `project_audit_log` (five actions), `notifications`, `ghl_delivery_log`, `security_notify_log` — four partial logs | **B** — `project_audit_log` is the natural seed |
| Document | **Exists** | yes | `project_documents` with category and optional stage | **A** |
| Task | **Does not exist** | no | searched `tasks`, `todo`, `assigned_to` — none | **C** |
| Issue / Risk | **Does not exist** | no | `support_tickets` is customer-facing, not project issues | **C** |
| Inspection | **Does not exist** | no | searched `inspection` in migrations, `src`, `api` — copy only | **C** |
| Certificate | **Exists** | yes | `certificates` | **A** |
| Quote request | **Exists** | yes | `contractor_inquiries` | **A**, no reply/introduction flow (**B**) |
| Application pipeline | **Exists** | yes | `contractor_application_drafts` → `contractor_applications` → `contractors` | **A** |

---

## 16. What the meetings decided, and what is still open

| Point | Source | Status |
|---|---|---|
| For Jalla Verify, an independent professional must visit the site to verify work — not the admin from photos | Beta notes 3 Sep, p.12 (01:21:40) | **Decided** |
| The admin's role is to facilitate communication between the Jalla team and on-ground experts | Beta notes p.12 (01:27:58, 01:32:34) | **Decided** |
| Favour: build the admin feature supporting that communication for stage approvals | Beta notes p.4, action item | **Assigned, open** |
| Vanessa: define the verification standard process | Beta notes p.4, action item | **Assigned, open** |
| What a verifier may say, what counts as sufficient evidence per milestone, who is on call | Transcript 9 Sep, ~00:20 | **Open** — Philip: "a decision that will need to be made once we have that call" |
| Key result: 100 % of funded projects fully operational — setup, milestone tracking, verification, evidence, updates | Transcript, ~00:20 | **Decided as the OKR** |
| Real-project practice: plans stamped by an ONIGC civil engineer and ONAC architect; an engineer on site every Saturday for verification; land-title verification at the Registry; a named verifier ("Eng. PEKUNA") | Project example pp.2, 4 | **Observed practice**, one project |
| Milestone funding in tranches (land, then foundation/concreting) | Plan §13.3; project example | **Decided direction**, awaiting SwyChr |
| A stage→verifier-type matrix (civil for foundation, electrical for electrical, civil+architect at handover) | not in any of the three PDFs — searched for `engineer`, `architect`, `surveyor`, `lawyer`, `verif` | **Not decided.** It is a synthesis in the ChatGPT brief; it awaits Vanessa's action item. Model it as configuration, do not hard-code it. |

---

## 17. Findings that need a decision

1. **Vendor name.** "Switchr" ×37 vs "SwyChr" ×22 in the plan, including shipped legal terms. *Decision: confirm the canonical spelling; then one mechanical diff.*
2. **~68 MB of untracked binaries in `docs/admin/`** (ten mockup PNGs at ~1.5 MB each, three 13 MB `.docx` of which two are identical, one 13 MB `.pptx`). `docs/meetings/` (1.4 MB of PDFs) is already committed. *Decision: commit `docs/admin/` (every clone carries 68 MB), or keep the plan `.docx` and move the mockups and duplicates to Drive with a README pointer.*
3. **Inbound message delivery is not idempotent** (§8). *Decision: add a UNIQUE on `project_messages.ghl_message_id` where not null, and an upsert — before any Inbox work.*
4. **The GHL thread → project heuristic** (`ghl_thread_project_id`) misfiles replies for clients with more than one project. *Follows from the Conversation entity decision.*
5. **Verifier is unrepresented; the admin stands in.** The verification standard is Vanessa's open item. *Decision: the `verifier` role value already exists (001); whether to use it plus a `project_verifiers` assignment, and whether verification becomes rows on the stage.*
6. **Admin project wizard assigns nobody.** 082 creates the project; contractor assignment is a separate action; verifier assignment does not exist. *Follows from 5.*
7. **Contractor lands on a tab they are not allowed** (§1). *Small fix; queue for Phase 7.*
8. **No admin bell; dead notification clicks.** Both fixed in the uncommitted slice (§18). *Decision: whether to land those two fixes ahead of the sequence.*
9. **Chat is unpaginated** and take-off `accepted` has no code path. *Queue.*
10. **`agent_requests` is not "Agents."** The plan's People → Agents (sales agents) has no table; the existing one is a video-production queue. *Name the new thing something else.*

---

## 18. Evidence from the earlier attempt (uncommitted, not part of this audit's changes)

Before the Phase 0 instruction arrived, `docs/ADMIN-DASHBOARD.md` was written and an overview slice was built against real rows: `src/lib/admin/health.ts` (+24 tests), `src/lib/supabase/admin-overview.ts`, a rewritten `src/app/routes/admin/index.tsx`, `NavItem.section` grouping, the admin bell, `destinationFor()` on the bell, and migration `084_admin_project_activity.sql` (read-only RPC; exercised on a local Postgres). It follows the plan's guardrails — no mock data, no hard-coded metrics, RLS untouched, no routes removed (a test pins it), existing components reused. It is kept as evidence and will be reshaped at the Overview phase.

**What it must not be read as.** `health.ts` encodes workflow assumptions — that a complete stage with an unpaid milestone is a health problem (`payment_pending`), that a stage in `pending_review` is an operational condition, that fourteen silent days means stalled. Those are the previous direction's guesses at the model, not the model; Phase 3 decides them from the verification/financial workflow, and the slice is reshaped to whatever Phase 3 says. Its value is narrower and real: it proves the *plumbing* — which rows exist, which joins work, which counts the database can answer today.

What it shows is computable **today** from real data: active/on-track/attention/at-risk by project (from stage status, `planned_end`, `payment_status`, and last activity across substages, documents, messages and audit log); pipeline by `current_stage`; reviews, budgets, applications, support, inquiries, agent-request backlogs; a recent-activity feed from `project_audit_log`. What it **cannot** compute, and why: *open/unanswered conversations* (no read state, no direction on messages); *verification backlog by verifier* (no verifier); *payment-ready milestones* (eligibility is a manual flag); *inspections due* (no entity); *map* (no coordinates).

---

## 19. What Phase 1 can start from

Facts, not design:

- One identity (`auth.users` + `profiles`) already spans client, contractor and admin; roles are a table, so adding `verifier` is additive.
- `project_stages` is the right anchor for verification, evidence and payment eligibility — everything already cascades from it or the project.
- `project_audit_log(project_id, stage_id, action, actor_id, details, created_at)` is the shape of a unified activity model and is already written by five code paths.
- `project_messages` can become the message row of a Conversation entity; the thread today is implicit (`project_id`) and would need `conversation_id`, `channel`, `direction`, and `project_id` made nullable.
- The GHL boundary already matches the plan; the one defect is inbound idempotency.
- Money: Stripe owns subscriptions; nothing owns milestone funds. Whatever SwyChr's contract turns out to be, Groundwork needs its own `payment` / `disbursement` rows with a provider reference — the plan's "why is money moving" side.
- Roles, verification, financial state and activity are the four gaps every later phase depends on. The Overview and the Inbox both read from them; neither creates them.

---

## 20. Risks

Ordered by how much later work they can corrupt. None is fixed here.

| # | Risk | Where | Consequence if untouched |
|---|---|---|---|
| R1 | Inbound GHL message delivery is not idempotent (§8) | `api/_handlers/conversation-delivery.ts`, 077 | Any Inbox built on `project_messages` inherits duplicates; a GHL retry storm double-posts to clients |
| R2 | GHL replies filed to the *last mirrored* project (`ghl_thread_project_id`) | 077, `_email-log.ts` | A client with two projects has replies land on the wrong one; invisible until someone reads both threads |
| R3 | "Verified" on Jalla Verify means an admin looked at photos; certificates are issued on that | `approvals.ts`, 014/079 | The product's central promise — independent verification — has no structural backing; a certificate can be issued with no site visit recorded |
| R4 | Financial state is a hand-set flag with no ledger | `updatePaymentStatus`, `project_stages.payment_status` | Nothing to reconcile a SwyChr webhook against; "paid" can be set with no money moved and vice versa |
| R5 | One admin role; every staff member is superuser | `is_admin()`, `user_roles` | No separation between who verifies, who releases money, who reads support; every privileged RPC gates on the same boolean |
| R6 | Two `CREATE TABLE user_roles` definitions with different CHECKs (001 wide, `20260714…` narrow) | 001, `20260714…` | 001's is live and already admits `verifier`, so no constraint change is needed for that role. The risk is the *reading*: anyone taking the later file as authoritative would conclude the schema forbids what it allows. Add `ops`/`finance`/`growth` later does need an `ALTER … CHECK`. *(Corrected 12 Sep.)* |
| R7 | No migration ledger; "applied" lives with one person | all of `supabase/migrations/` | A lagging migration looks like a broken feature (see 084's fail-soft as the workaround this forces) |
| R8 | 11 of 12 serverless functions | `api/` | One more file and every deploy fails silently while the old build keeps serving — it has happened |
| R9 | `project_messages` and admin lists unpaginated | `messages.ts`, admin routes | Linear growth per project; the first long-running build makes the thread slow for everyone on it |
| R10 | The uncommitted slice's health rules become the model by inertia | `src/lib/admin/health.ts` | Committing it before Phase 3 would let a dashboard define what "at risk" means for a construction project |
| R11 | Contractor sees the Overview tab on first render | `projects/detail.tsx` L138 | Budget figures shown to a role that is not meant to see them |
| R12 | Vendor name in shipped legal terms is wrong | `src/lib/legal/content.ts` | Contractual copy names a company that does not exist under that spelling |

## 21. Recommended information architecture

A recommendation, not a decision; grounded in §1 so every line is *exists / rename / new*. Existing modules are kept and re-pointed at the Project Workspace, Person record or Inbox — nothing is removed.

| Area | Item | Today | Note |
|---|---|---|---|
| Overview | `/admin` | exists | becomes a projection of the workspace and Action Center, not the organising surface |
| | `/admin/action-center` | **new** | cross-functional queue; §4 and §18 show which items are computable now |
| Project Operations | `/admin/projects`, `/admin/projects/new` | exist | |
| | `/admin/projects/:id` — **Project Workspace** | **new** | the primary operational surface; tabs follow the lifecycle |
| | `/admin/reviews` → *Stages & Reviews* | rename | keep as the global queue; rows open the workspace's Stages tab |
| | `/admin/budgets` → *Budgets / Payments* | rename | keep as the queue; financial state lives in the workspace |
| | Site Updates / Evidence | **new** view | over `evidence_urls` + `project_documents` until an entity exists |
| | Verification | **new** | depends on the verifier decision (§17.5) |
| | Tasks · Issues & Risks · Inspections | **new** | new entities; after the workspace exists to hang them on |
| People | Clients | **new** view | over `profiles` + owned projects |
| | `/admin/contractors`, `/admin/applications`, `/admin/drafts` | exist | applications and drafts could move under Acquisition |
| | Verifiers | **new** | after §17.5 |
| | `/admin/users` → *Team* | rename | staff and roles once R5 is addressed |
| Communication | `/admin/inbox`, `/admin/inbox/:conversationId` | **new** | needs the Conversation entity (§6) and R1 fixed first |
| | WhatsApp · Email · Calls | **new** | channel filters on the Inbox, not separate systems |
| | `/admin/notifications` | **new** view | the bell's list, for admins |
| Acquisition | `/admin/waitlist`, `/admin/inquiries` → *Quote Requests*, `/admin/requests` → *Agent Requests* | exist / rename | note the "Agent" name collision (§17.10) |
| | `/admin/crm` | move | becomes System → Integrations → GoHighLevel |
| Support | `/admin/support` | exists | link tickets to person and project |
| Analytics | Analytics · Reports | **new** | last; needs the activity model |
| System | Integrations (GoHighLevel, SwyChr) · Team & Permissions · Audit Log · Settings | **new** | Audit Log over `project_audit_log` + `admin_deleted_projects` + `security_notify_log` |

Sidebar grouping is the same shape the uncommitted slice tried (`NavItem.section`), which is fine to reuse when the time comes — it is presentation, not architecture.

## 22. Recommended implementation sequence

The locked sequence stands. What the audit adds is the **dependencies inside it** — the order within each phase that the facts impose.

| Phase | Scope | What the audit says must come first |
|---|---|---|
| 1 Domain model | Person/roles, Project/Stage/Verification/Evidence, financial entities, Conversation, Activity | Resolve §17.5 (verifier) and §17.1 (vendor) — both shape entity names |
| 2 Data relationships | migrations for `project_verifiers` (the `verifier` role value already exists), stage verification rows, `payment`/`disbursement` with provider ref, `conversation` + nullable `project_id`, unified activity | Fix **R1** in the same pass; R6 turns out to need only documentation for `verifier`, and an `ALTER` only for roles beyond it. Keep every existing FK — nothing here replaces a table |
| 3 Workflows | the stage lifecycle states, the verification standard (Vanessa's item), eligibility rules, onboarding chain (create client → create project → assign contractor + verifiers → activate) | This is where `health.ts`'s assumptions are either adopted or discarded |
| 4 Overview | projection of 1–3 | reshape the uncommitted slice against the Phase 3 rules; the plumbing is reusable, the rules are not |
| 5 Project Workspace | `/admin/projects/:id` with lifecycle tabs; reviews/budgets queues re-pointed at it | needs 2 and 3; can ship before 6 |
| 6 Unified Inbox | Conversation entity, thread, composer, internal notes, Record Decision | needs R1, R2 fixed and the Conversation entity from 2 |
| 7 Module refactor | existing pages link into workspace/person/inbox; contractor tab bug (R11); Agents naming | mechanical once 5 and 6 exist |
| 8 Hardening | roles (R5), audit log page, realtime, GHL reliability, SwyChr against real docs (R4 ledger first), QA, migration ledger (R7) | SwyChr is last and only against sandbox documentation |

Three things should not wait for their phase because everything downstream reads them: **roles** (2), the **activity model** (2), and **inbound idempotency** (R1). Nothing else should be pulled forward.
