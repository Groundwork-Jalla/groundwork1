# Admin dashboard — from stat cards to an operations desk

**Why.** The `/admin` overview is five links with a number on each. It cannot answer the
only question the team has when it opens the panel: *which builds need me today?* Every
project is watched by hand, in the client's own `/projects/:id` opened in a new tab. The
user's design brief (11 Sep 2026) asks for a construction operations command centre —
project health, a needs-attention list, the pipeline by stage, people and money views, a
map, roles and an audit trail. This is that, phased so each step ships on its own.

The brief was written against Nigeria (Naira, Lagos, Enugu). Groundwork is Cameroon-first
(XAF / USD, Buea, Douala, Yaoundé). Everything below is adapted.

**Rules that bind every phase.** No emoji; icons black and white; colour is a status
accent never the data channel (docs/SCREEN-DESIGNS.md). Every string in both dictionaries.
Prefer a SECURITY DEFINER RPC to a serverless function — Vercel Hobby caps at 12 and we
hold 11. Migrations are pasted by hand; the app must degrade rather than break when one
lags (see `isMissingTable` / fail-soft below).

---

## Phase 1 — Command centre overview · **built**

**Delivers.** `/admin` answers "what needs me". Four project cards (active / on track /
needs attention / at risk), a **needs-attention list** where every row links to the page
where the admin acts, the pipeline by stage as a bar, the ops backlog (reviews, budgets,
open support, open inquiries, pending applications), and a recent-activity feed. Admin
sidebar grouped by workflow. Admins get the notification bell they never had.

**Health — `src/lib/admin/health.ts`.** Pure, tested. Input: a project row, its stages,
and last-activity timestamps. Output: a band and the reasons for it.

| Band | Meaning |
|---|---|
| `planning` | `tracking_started_at IS NULL` — not scored; Jalla Management here is "budget unconfirmed" |
| `on_track` | tracked, active, nothing below applies |
| `attention` | any of: review pending · active stage past `planned_end` · no activity ≥ 14 d · a complete stage still unpaid · `on_hold` |
| `at_risk` | any of: review pending ≥ 5 d · stage ≥ 14 d overdue · no activity ≥ 30 d |
| `done` / `archived` | not scored |

Thresholds are exported constants. Computed **client-side** from fetched rows: the fleet
is tens of projects, the rules stay in TypeScript where they can be unit-tested and read,
and an RPC would just move the same `if`s somewhere untestable. Revisit above ~500
projects.

**Activity — migration 084, `admin_project_activity()`.** One read-only RPC returning
`project_id, last_evidence_at, last_review_at, last_message_at, last_audit_at`. Without it
the overview would pull every message row to find each project's latest. **Fail-soft:** if
the RPC is not yet applied the overview still renders, using `projects.updated_at` as the
only signal, and says so.

**Needs attention.** The health reasons across projects, sorted at-risk first, plus the
ops backlog. Each row carries `to`: reviews → `/admin/reviews`, budget → `/admin/budgets`,
everything project-level → the project.

**Nav.** `NavItem.section?: TKey`; `AppSidebar` prints a small heading when the section
changes. `pageTitleKey` and the mobile tab bar are untouched (both ignore `section`).
Groups: Overview · Operations (reviews, budgets, projects) · People (users, contractors,
applications, drafts) · Growth (waitlist, inquiries, CRM) · Desk (support, requests).

**Bell.** `_admin-layout.tsx` passes `topBarActions`. `NotificationBell` learns three
more destinations — `ticket_id` → `/admin/support`, `inquiry_id` → `/admin/inquiries`,
`application_id` → `/admin/applications/:id` — so the notifications the 074/076 triggers
already write finally go somewhere when clicked.

**Files.** `src/lib/admin/health.ts` (+ `.test.ts`), `src/lib/supabase/admin-overview.ts`,
`src/app/routes/admin/index.tsx`, `src/components/shell/{nav-config,AppSidebar}.tsx`,
`src/app/routes/admin/_admin-layout.tsx`, `src/components/ui/NotificationBell.tsx`,
`supabase/migrations/084_admin_project_activity.sql`, `src/lib/i18n/{en,fr}.ts`.

## Phase 2 — Projects with health, and an admin project page

Health column, last-activity column and filters (band, tier, country, stage) on
`/admin/projects`, reusing `projectHealth()`. A read-only `/admin/projects/:id` — the
client's seven tabs are the wrong shape for staff; this is overview + stages with evidence
+ payments + audit trail on one page, with approve / rework / assign inline. Retires "open
in a new tab". No migration.

## Phase 3 — People

`/admin/clients`: owner-centric — projects, total budget, tier, last sign-in, last
activity, open tickets. `/admin/contractors/:id`: performance — projects, stages completed,
on-time rate from `planned_end` vs `completed_at`, rework count from the audit log. Both
computed from existing rows; a `contractor_performance` view if it gets slow.

## Phase 4 — Money

Cross-project rollup: milestone USD released / held / locked, `project_fees` status,
unpaid-but-complete stages as a queue. `billing_events` for subscription revenue. Reads the
same columns the client's payments tab reads; nothing new is charged or moved.

## Phase 5 — Map

Projects by city on Leaflet (`react-leaflet` already in the bundle, pattern in
`src/components/wizard/CountryMap.tsx`). Needs coordinates: a `cities` reference table
(migration) seeded from `construction_city_rates`, or geocode on write. Filter the projects
list by clicking a city.

## Phase 6 — Team roles and the audit trail

`user_roles` gains `ops`, `finance`, `verifier`, `growth`. `is_admin()` stays as-is
(superuser); a `has_role(text)` sibling gates the finance and growth pages. Migration. An
`/admin/audit` page over `project_audit_log` + `admin_deleted_projects` + `security_notify_log`,
with actor and project resolved.

## Phase 7 — New modules

`issues` (project, severity, owner, status, resolution) and `inspections` (checklist,
findings, pass/fail, inspector). New tables, RLS, triggers into notifications. Only after
the phases above have shown the desk is used.

---

## Verification, Phase 1

`pnpm test` — `health.test.ts` pins every band and threshold. `pnpm typecheck` — the
dictionaries. Then by hand: apply 084, open `/admin`, and check the needs-attention list
against `/admin/reviews` and `/admin/budgets` counts. Un-apply nothing: temporarily rename
the RPC and confirm the page still renders with the fail-soft note.
