# Groundwork by Jalla

**Construction management for the African diaspora.**

Building a home in Africa while living abroad is hard, not because of money but because of distance, trust and visibility. You send money, you get photos, you have no way to verify any of it. Groundwork replaces trust-based construction management with an evidence-driven record: **every stage is paid against a receipt the system has read, every update is reviewed before the next stage opens, and the whole history lives in one place you can see from anywhere.**

The launch corridor is **US and diaspora clients → Cameroonian contractors**. Cameroon is the default country everywhere (`DEFAULT_COUNTRY_CODE` in [src/lib/countries.ts](src/lib/countries.ts)) and the only one with a calibrated take-off rate table. Of the 24 supported countries, Cameroon is the only one with real bills of quantities behind its rates.

**Live:** [www.tryjalla.com](https://www.tryjalla.com) · Canonical host is `www`; the apex redirects.

_Last reconciled against the code on 14 November 2026. Where this file and the code disagree, the code wins and this file needs a fix._

---

## What the product does today

Four surfaces sit over one core model (projects, stages, substages, evidence, receipts, memberships, messages). See [docs/project-workflow-behaviour-2026-11-14.md](docs/project-workflow-behaviour-2026-11-14.md) for the behaviour reference.

| Surface | Path | Who | What they do |
|---|---|---|---|
| Client | `/dashboard`, `/projects/:id` | the person paying for the build | Creates a project (wizard or bill of quantities), invites a contractor, approves construction updates, uploads payment receipts, approves price changes |
| Contractor | `/work` | the primary contractor and additional contractors | Uploads construction updates per substage, proposes stage prices, confirms money arrived, authorises work to continue, files a take-off |
| Verifier | `/verifiers` | an invited independent reviewer | Workspace v0. Independent verification is currently paused: clients approve updates directly |
| Admin | `/admin` | Groundwork staff | Manages every actor and project, reviews finance, runs the communication framework, support, CRM and settings |

Two rules shape everything under `/admin`: it manages actors and oversees, it never grows the execution screens contractors and verifiers use; and it shows **only real data**. No mock rows, no placeholder numbers.

### The stage workflow

Every project is seeded with ten stages, each with substages: Land Secured, Design Completed, Site Preparation, Foundation, Structure & Walls, Roofing, Electrical & Plumbing, Finishing, Exterior Work, Final Handover ([stage-seeds.ts](src/lib/supabase/stage-seeds.ts)). Stages progress strictly in order and the database enforces it.

How a stage opens depends on who created the project (`projects.workflow_origin`):

- **Client-created:** the client pays the stage first. The contractor confirms the money arrived and authorises work. The contractor uploads updates, the client approves, the next stage asks for its payment.
- **Contractor-created:** work comes first. The contractor uploads updates, the client approves, the client pays *that reviewed stage*, the contractor confirms, and the next stage opens for updates.
- **Joining a build in progress:** stages already built are marked `pre_existing`. They get no verification, no certificate and no payment. On an estimate-priced project they are zeroed; on a bill-priced project they keep their share of the bill.

The gate the contractor sees is [stage-progression.ts](src/lib/projects/stage-progression.ts) in the browser and `stage_work_ready()` / `open_stage_if_settled()` in Postgres. They must agree.

### How a receipt becomes a payment

This is the only path by which money is recorded against a stage. Nothing moves money; Groundwork records what the client proves and the contractor confirms. Full detail in [docs/receipt-verification-errors.md](docs/receipt-verification-errors.md) and [docs/receipt-currency-follow-up.md](docs/receipt-currency-follow-up.md).

1. The client picks the receipt's currency (27 supported), types the exact printed amount and uploads the file to private storage.
2. `read-payment-receipt` reserves a reading, downloads the stored file, and asks Claude (`RECEIPT_READER_MODEL`, default `claude-sonnet-5-5`) for one completed-payment amount and currency with a confidence.
3. The match is exact. A high-confidence reading that equals the typed amount and currency is `matched`; anything else is a mismatch, not a receipt, or unreadable, and nothing is recorded.
4. A conversion is frozen onto the matched reading: the project's own rate for its own currency, parity for USD, a daily ExchangeRate-API rate for anything else. The browser can never supply a rate.
5. `submit_stage_payment_receipt` re-checks the reading, the file hash and the stage, then inserts an immutable `stage_payment_receipts` row.
6. The contractor decides: accept, request a top-up, or flag. Only acceptance funds the payment and opens the stage. Partial payments reduce the balance; the contractor chooses whether to proceed with a balance outstanding.

Stage prices can be revised by the primary contractor and approved by the client (`stage_price_amendments`); the original bill and the amendment history stay recorded.

### Pricing a project

Two sources of truth, never mixed:

- **Estimate** from the take-off engine in [src/lib/budget/](src/lib/budget/): a real quantity take-off from the wizard answers (geometry, roof, nine trade sections, BQ line items, city rate tables). Rates live in `construction_rates` and `construction_city_rates`, calibrated against real Cameroonian bills: see [docs/BQ-QUESTIONS.md](docs/BQ-QUESTIONS.md).
- **Bill of quantities** uploaded by the client or contractor. A bill-priced project is worth exactly the bill: no Groundwork fees, every stage its percentage. `extract-bq.ts` reads the sheet, and `read-floor-plan` asks Claude what kind of building a plan shows when the text layer cannot say.

Every stored stage figure is USD; the UI shows the project's local currency first at one rate per project (`use-project-money.ts`), with the dollar equivalent beside it.

### Communications

Groundwork owns activation reminders, recipient preferences, replies and staff follow-up. Resend carries email. See [docs/groundwork-communications.md](docs/groundwork-communications.md) and [docs/communication-framework-release-2026-11-14.md](docs/communication-framework-release-2026-11-14.md).

- Four journeys, sixteen sequences, English and French copy ([journeys.ts](src/lib/lifecycle/journeys.ts), [shared/lifecycle-copy.ts](shared/lifecycle-copy.ts)): contractor self-signup, contractor invited by a client, client self-signup, client invited by a contractor.
- The worker is `lifecycle-run`, called by Vercel Cron every five minutes with `CRON_SECRET`. Deliveries, replies and follow-up live in the `communication_*` and `lifecycle_*` tables and are reviewed at `/admin/sequences`, `/admin/inbox` and `/admin/notifications`.
- **WhatsApp is off.** Direct Meta integration was chosen on 14 November 2026 ([docs/meta-whatsapp-setup.md](docs/meta-whatsapp-setup.md)); no phone-number ID or token is configured. GoHighLevel remains the fallback transport and keeps sales and partner-application workflows. It no longer receives activation triggers.

---

## Stack

| Layer | Choice |
|---|---|
| UI | React 19 · TypeScript · Tailwind CSS v4 · Framer Motion · Lucide · Radix primitives |
| Routing | React Router 7, **framework mode, SPA** (`ssr: false`, app directory `src/app`) |
| Backend | Supabase: Postgres, Auth, Storage, Realtime, RLS on everything |
| Serverless | Vercel functions in [api/](api/) on **Vercel Pro**; one dispatcher plus ten entry points |
| Scheduled jobs | Vercel Cron: `swychr-poll` and `lifecycle-run`, every five minutes |
| Email | Resend (`mail.tryjalla.com`) |
| Document reading | Anthropic SDK (receipts, floor plans) · tesseract.js and pdfjs in the browser (plan gate) · SheetJS for bills |
| Subscriptions | Stripe code is deployed, **checkout is paused** (see Payments) |
| Milestone money | SwyChr pay-in callback and payout polling exist; no provider has written to the ledger in production |
| CRM | GoHighLevel: contacts, pipelines, outbox, WhatsApp fallback |
| Maps and PDF | Leaflet · jsPDF stage certificates · qrcode |
| Monitoring | Sentry · Vercel Analytics · Google Analytics 4 |
| Tests | Vitest (279 files) plus nine database regression scripts on local PostgreSQL |

---

## Quick start

**Requires:** Node 20+ and **pnpm** (the lockfile is pnpm's; do not use npm). Local PostgreSQL 16 to 18 binaries for the database regressions. **No Docker.**

```bash
pnpm install
cp .env.example .env    # then fill it in
pnpm dev                # http://localhost:5174
```

The port is 5174, set in [vite.config.ts](vite.config.ts), not Vite's default.

The bare minimum for the app to boot:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

> The build fails without `VITE_SUPABASE_URL`: the client passes it straight to `createClient`. Placeholder values are enough to get a build through.

[.env.example](.env.example) is the complete list. The split that matters: **`VITE_*` is compiled into the browser bundle and is public**; everything else is server-only and read by `api/`. The variables, grouped:

| Group | Variables |
|---|---|
| Browser | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SENTRY_DSN`, `VITE_GA_MEASUREMENT_ID` |
| Server Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_JALLA_VERIFY` |
| Site | `PUBLIC_SITE_URL` (use the `www` host) |
| GoHighLevel | `GHL_CONTRACTOR_WEBHOOK_URL`, `GHL_EVENT_WEBHOOK_URL`, `GHL_API_TOKEN`, `GHL_LOCATION_ID`, `GHL_PIPELINE_ID`, `GHL_STAGE_MAP`, `GHL_INBOUND_SECRET` |
| Communications | `RESEND_API_KEY`, `CRON_SECRET`, `LIFECYCLE_WHATSAPP_ENABLED`, `TEAM_INBOX` |
| Document reading | `ANTHROPIC_API_KEY`, `RECEIPT_READER_MODEL` |

Runtime settings that change often (CRM credentials, notification recipients, sender addresses) live in the `app_config` table rather than Vercel, because a row takes effect within a minute and a Vercel variable needs a redeploy.

### Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Dev server on :5174 with HMR. `/api/send-email`, `/api/send-invite` and a slice of `/api/events` are hand-wired middleware, so dev never loads the real handlers |
| `pnpm build` | Production build to `build/client/` |
| `pnpm typecheck` | `react-router typegen && tsc`. On a machine with little free memory run `NODE_OPTIONS=--max-old-space-size=3072 npx tsc --noEmit` |
| `pnpm test` | Vitest, single run |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:*-db` | Database regressions, one per domain: `boq`, `receipts`, `stages`, `account-roles`, `admin`, `lifecycle`, `team`, `review`, `evidence`. Each boots a throwaway single-user PostgreSQL, applies the real migrations and fixtures from `scripts/fixtures/`, and asserts the RPCs, triggers and RLS |
| `pnpm agent:queue` | Produce pending `/admin/requests` videos locally |
| `pnpm media:setup` | Python venv for the video and deck pipeline |
| `pnpm plan:read` | Read a plan file from the command line |
| `pnpm start` | Vestigial. SPA mode deletes the server build, so this does not run |

---

## Project structure

```
src/
├── app/
│   ├── root.tsx              # HTML shell, providers, Sentry boundary, pre-paint theme + lang scripts
│   ├── routes.ts             # Route config: 91 routes in 9 groups
│   └── routes/               # Route modules by surface: auth/ projects/ tools/ work/ verifiers/ admin/
├── components/               # 198 components: admin, auth, contractor, conversations, dashboard, help,
│                             #   landing, legal, payments, profile, project, shell, takeoff, tour, ui,
│                             #   verifier, wizard
├── contexts/                 # AuthContext, ThemeContext, WizardContext
├── hooks/
├── lib/
│   ├── budget/               # Take-off engine, bill reading, money pairing, repricing
│   ├── supabase/             # All database access, one module per domain (71 modules)
│   ├── projects/             # Stage progression rules, wizard draft, plan answers
│   ├── payments/             # Receipt currencies and reading, balances, payout destinations, config flags
│   ├── lifecycle/            # Activation journeys and tracking dates
│   ├── i18n/                 # EN/FR dictionaries, typed parity, provider
│   ├── email/                # Resend senders and HTML templates
│   ├── tour/                 # In-app tour placement and completion
│   ├── admin/ analytics/ auth/ certificates/ contractor/ documents/ ghl/ legal/ pdf/ theme/ verifier/
│   ├── plan-limits.ts        # Free-plan cap constant, mirrored from the database
│   └── countries.ts          # 24 supported countries, Cameroon default
├── types/project.ts
└── styles/globals.css

api/                          # Vercel serverless. Read api/README.md first.
├── events.ts                 # Dispatcher: 39 actions behind one function (maxDuration 300)
├── _handlers/                # One handler per action (40 files)
├── _lib/                     # Shared server code: Stripe, Resend, receipt reader, lifecycle engine
├── ghl/                      # GoHighLevel client, pipelines, OAuth, inbound auth
├── stripe/                   # Checkout (paused), portal, webhook
└── send-email.ts, send-invite.ts, send-application-decision.ts,
    contractor-application-notify.ts, agent-dispatch.ts, ghl/contractor.ts

shared/lifecycle-copy.ts      # Message copy shared by the browser and the worker
supabase/migrations/          # 227 SQL migrations
scripts/                      # Database regression runners, fixtures, agent pipeline, dev API shim
docs/                         # Everything else (see Documentation)
screens/                      # Approved PC and mobile mockups, the contract for each screen
public/                       # Favicons, logos, brand assets
```

Illustrations in the wizard (blueprints, floor plans, roof types) are hand-authored inline SVG, not image assets, which is why some component files are large.

---

## Routes

**91 routes in 9 groups.** [docs/PAGES.md](docs/PAGES.md) is the page-by-page reference but dates from July 2026 and predates the contractor, verifier and most admin surfaces.

| Group | Layout | Auth | Routes |
|---|---|---|---|
| Communication preferences | standalone | token in URL | 1 |
| Public | `_public-layout.tsx` | public | 7: landing, contractor-apply, jalla-management, verify/:id, privacy, terms, partner-agreement |
| Auth and joining | `_auth-layout.tsx` | public | 11: login, signup, reset, new password, callback, onboarding, invite/:token, claim/:token, share/:token, contractor-signup, verifier-signup |
| Project wizard | `WizardShell` | required | 1: `/projects/new` |
| Client app | `_layout.tsx` | required | 13: dashboard, projects, project detail, take-offs, documents, resources, contractors directory, messages, notifications, profile, help |
| Free tools | `tools/_tools-layout.tsx` | public | 5 |
| Contractor workspace | `work/_layout.tsx` | contractor | 11: `/work`, projects, project detail, take-offs, payouts, onboarding, partner, profile, help, clients/new |
| Verifier workspace | `verifiers/_layout.tsx` | verifier | 4 |
| Staff sign-in | standalone | public | 1: `/admin/login` |
| Admin | `admin/_admin-layout.tsx` | `is_admin()` | 37 |

`/contractors` is the **public client-facing directory**, admin-curated since migration 180 and no longer subscription-gated. `/work` is the authenticated contractor workspace. One path never means two products, so do not "fix" `/work` back to `/contractors`.

`/admin/login` sits outside the admin layout on purpose: that layout redirects unauthenticated visitors to it.

**Joining links.** Email invitations are recipient-bound (`/invite/:token`). Shareable project links (`/share/:token`) are role-segmented, single-use, revocable and do not expire; the first eligible signed-in account claims one. Contractors claim a project through `/claim/:token`.

---

## Database

Supabase Postgres with **Row Level Security on everything**. Privileged reads and every state change go through `SECURITY DEFINER` RPCs pinned to a fixed `search_path`. Business rules live in triggers and constraints, not only in the UI.

### Migrations

227 files in [supabase/migrations/](supabase/migrations/), in two naming eras: `001` to `184` numbered, then timestamped `20260714000000_…` onward. Numbered files have collisions (two `043_`, two `045_`), so filename order is not a total order.

There is **no migration table in play**. Files are applied by pasting into Supabase → SQL Editor. The repo cannot tell you what is live; a column that exists in a file but not in production is the usual cause of a feature that "does nothing". To check without asking, probe the REST API read-only with the anon key: a missing column answers `42703`, an existing one answers `200 []`. Always probe a column that cannot exist as a control in the same run.

Local verification uses PostgreSQL binaries directly (`pnpm test:*-db`). Never Docker.

### Tables, by what they serve

| Area | Tables |
|---|---|
| Projects | `projects`, `project_stages`, `project_substages`, `project_documents`, `project_messages`, `project_takeoffs`, `project_fees`, `project_audit_log`, `site_updates`, `stage_verifications`, `stage_joining_assessments`, `stage_progression_authorizations` |
| Membership | `project_viewers`, `project_verifiers`, `contractor_invites`, `verifier_invites`, `user_roles`, `profiles`, `user_profiles`, `user_devices`, `agreement_acceptances` |
| Money | `payments` (the ledger, migration 090), `stage_payment_receipts`, `receipt_readings`, `stage_payment_plans`, `stage_price_amendments`, `payout_destinations`, `billing_events`, `certificates` |
| Contractors | `contractors`, `contractor_applications`, `contractor_application_drafts`, `contractor_onboarding`, `contractor_documents`, `contractor_emergency_contacts`, `contractor_clients`, `contractor_inquiries`, `partner_pipeline` |
| Communications | `communication_messages`, `communication_threads`, `communication_preferences`, `communication_runs`, `communication_settings`, `communication_followup_events`, `communication_action_outcomes`, `communication_milestones`, `communication_issues`, `communication_project_connections`, `lifecycle_sequences`, `lifecycle_sequence_steps`, `lifecycle_enrollments`, `lifecycle_sends`, `lifecycle_deliveries`, `message_deliveries`, `followup_queue`, `notifications` |
| CRM | `ghl_outbox`, `ghl_inbound_events`, `ghl_oauth_tokens`, `ghl_delivery_log`, `ghl_sync_failures` |
| Rates | `construction_rates`, `construction_city_rates` |
| Growth and ops | `waitlist_members`, `waitlist_emails`, `funnel_events`, `support_tickets`, `app_config`, `agent_requests`, `agent_notify_log`, `security_notify_log`, `email_otp_challenges`, `admin_deleted_projects` |

**Storage buckets**, all private: `evidence` (construction updates and payment receipts), `documents`, `contractor-docs`, `id-documents`, `chat-attachments`, `agent-outputs`.

### Rules the database enforces

- **Stage order.** A stage cannot accept a receipt or open while an earlier one is incomplete. `lock_project_stage_progression()` serialises every state change per project.
- **Receipts are immutable** once recorded. A later receipt may replace a pending one (`replaced_by`); a confirmed one never changes.
- **A payment needs a server-issued reading.** `submit_stage_payment_receipt` refuses an amount that does not match a `matched` reading of that exact stored file.
- **Pricing changes need client approval.** `propose_stage_prices` / `decide_stage_prices` snapshot the project; stale decisions are rejected.
- **Roles are rows.** `is_admin()` reads `user_roles`. Admins change account types from `/admin/users` or `/admin/team`; the last admin cannot be demoted.
- **Subscription columns are webhook-only** (migration 021). A browser cannot grant itself a tier.
- **`app_config`** has RLS on and no policies. Only `SECURITY DEFINER` functions read it.
- **A check constraint that mentions another column must guard its own NULL.** `NULL AND FALSE` is FALSE. This broke every receipt upload in production on 13 November 2026 (fixed in `20261113001300`).

---

## `api/`: the rule that has broken production twice

Read [api/README.md](api/README.md) before touching anything in there.

**Relative imports need a `.js` extension.** Vercel transpiles each file on its own and does not bundle. `package.json` is `"type": "module"`, so Node's ESM resolver loads the output and demands an explicit extension, refuses `@/*` aliases and has no `import.meta.env`.

```ts
import { getStripe } from '../_lib/stripe';      // ERR_MODULE_NOT_FOUND
import { getStripe } from '../_lib/stripe.js';   // correct
```

This applies transitively to anything under `src/` that `api/` reaches, which is why `src/lib/email/*`, `src/lib/i18n/{translate,fr}.ts` and the payment helpers carry extensions. `api-import-graph.test.ts` walks the graph because `vite dev` re-implements these endpoints in middleware and never loads the real handler.

**The dispatcher.** Nearly everything is an *action* on `POST /api/events?action=…` rather than a file. It began under Vercel Hobby's twelve-function limit; the project is on Vercel Pro now, so the limit no longer applies, but the dispatcher stays because webhook URLs and cron paths point at it. Add an action there, not a file, unless a fixed public URL is needed. Authentication is per handler, deliberately not at the dispatcher: a bearer token, an admin check, a shared secret, or a signed webhook body (`attachBody` preserves raw bytes).

Actions, by family: `crm-*` and `conversation-*` (GoHighLevel), `communication-*` and `lifecycle-run` (the communication framework), `swychr-*` (pay-in callback, payout polling, attaching a destination), `read-payment-receipt` and `read-floor-plan` (document reading), `admin-*`, `invite-verifier`, `contractor-invite-client`, `send-share-invite`, `project-whatsapp`, `message-fanout`, `email-receipt` (Resend delivery webhook), `mfa-email`, `profile-geo`, `certificate-purge`.

Aliases in [vercel.json](vercel.json) keep clean URLs for `crm-oauth`, `swychr-poll` and `lifecycle-run`.

---

## Payments

Groundwork **records and governs** the financial process. A licensed provider holds and moves the money. No wallet, escrow or custody language anywhere in the product.

| Rail | Code | State |
|---|---|---|
| Stripe subscriptions | `api/stripe/`, migration 021 | **Paused.** Both checkout endpoints return `410 Subscriptions are currently unavailable`. The webhook and portal remain deployed. `/pricing` no longer exists as a route. |
| SwyChr (XAF mobile money) | `swychr-callback`, `swychr-poll`, `swychr-attach`, `payout_destinations` | Endpoints and the five-minute payout poll exist. No provider has written to the `payments` ledger in production. Payouts are not wired end to end. |
| Client receipts | the flow above | **Live.** This is how a stage is paid today. |

Contractors are never paid through Stripe. Stripe Connect has no Cameroon payout support.

Flags live in [src/lib/payments/config.ts](src/lib/payments/config.ts): `MILESTONE_PAYMENTS_ARE_PREVIEW = true`, `SUBSCRIPTIONS_ARE_PREVIEW = false`. The second is stale in spirit now that checkout returns 410; the plan table there (`TIER_ECONOMICS`) still documents Self Verify free, Jalla Verify $199/mo, Jalla Management negotiated, and `plan-limits.ts` still carries the three-project cap. Check what is actually enforced before relying on either. Say **"processing fee"**, never "platform fee".

---

## CRM: GoHighLevel

Supabase is the source of truth; lifecycle events are mirrored into GoHighLevel. Three transports in order of preference: API v2 (contacts upserted by email), inbound webhooks as fallback, and the `ghl_outbox` queue for anything that fails, replayable from `/admin/crm`. **A CRM outage must never break a signup.** Every path fails soft and logs.

Since the November 2026 communication decision GHL's job narrowed: sales and partner-application workflows, an optional copy of contact facts, and the fallback WhatsApp transport. Activation reminders no longer trigger GHL workflows. Setup: [docs/GHL-SETUP.md](docs/GHL-SETUP.md). Field mapping: [docs/GHL-CUSTOM-FIELDS.md](docs/GHL-CUSTOM-FIELDS.md).

---

## Account security

One password policy in [password-policy.ts](src/lib/auth/password-policy.ts), shared by signup and new-password. TOTP two-factor is enrolled at `/profile` and challenged at `/auth/login` and `/auth/callback`; email one-time codes are the second option (`email_otp_challenges`, `mfa-email`). A password-change tripwire email is sent by a database trigger (migration 070), not by the browser. Known devices are recorded in `user_devices`.

Two Supabase dashboard settings are required before the policy and 2FA are more than a courtesy: the password minimum and TOTP enablement. Enforcing AAL at the database is not done. [docs/SECURITY.md](docs/SECURITY.md) is honest about it.

---

## Internationalisation

English and French. Most Cameroonian users are francophone, and 72% of profiles store no language, so the country default (French for Cameroon) wins when nothing else is known. The sender's screen language is the last human signal before the country, never above a stored choice. A browser guess is never persisted.

- **Compile-enforced parity:** `fr.ts` is typed as `Mirror<EnDict>`. An English key without its French string fails the build.
- **No flash:** a blocking script in `root.tsx` sets `<html lang>` before first paint.
- **French plural rules:** `tPlural()` treats 0 and 1 as singular.
- **Terminology** is Central and West African construction French: *chantier*, *étape*, *sous-étape*, *entrepreneur*, *justificatifs*, *maître d'ouvrage*. A site plan is a *plan de masse*.

```ts
// 1. src/lib/i18n/en.ts        nav: { dashboard: 'Dashboard' }
// 2. src/lib/i18n/fr.ts        nav: { dashboard: 'Tableau de bord' }   // omit this and the build fails
// 3. in a component            const t = useT(); <h1>{t('nav.dashboard')}</h1>
```

The contractor application form on `/contractor-apply` is a cross-origin GoHighLevel iframe and cannot be translated here; see [external-forms.ts](src/lib/i18n/external-forms.ts).

---

## Theming and design rules

Dark mode is an **account preference** stored in `localStorage` and `profiles.preferred_theme` (migration 043). [ThemeProvider](src/contexts/ThemeContext.tsx) is the single writer of the `dark` class. Four pages are deliberately light-only and call `useForceLight()`: the landing page, `/contractor-apply`, `/jalla-management` and `/partner-agreement`. Do not add `dark:` classes to them.

Before building or restyling a screen read [docs/SCREEN-DESIGNS.md](docs/SCREEN-DESIGNS.md) and the approved mockups in [screens/](screens/). Every screen ships as a PC and a mobile PNG. No emoji in the app UI; colour is a status accent, not a data channel; WhatsApp stays green. The in-app tour ([src/lib/tour/](src/lib/tour/)) describes the control it points at and is placed so it never covers text.

---

## Testing

```bash
pnpm test                         # Vitest: 279 files, 4,944 tests, about two minutes
pnpm test:review-db               # one of nine database regressions
NODE_OPTIONS=--max-old-space-size=3072 npx tsc --noEmit
```

**State on 14 November 2026:** 19 tests fail in 8 files. Ten belong to the in-progress "Back follows the current account role" work (`contractor-project-role.test.ts`, `project-approval-handoff.test.ts`); four are source-snippet tests in `src/lib/admin/` that drifted from the admin notifications and conversation screens; two compare notification paths that changed; three are property or large-fixture tests that time out at the 5 s default under memory pressure and pass alone. Nothing in the money, stage-progression or receipt suites fails. Fix or retire them rather than letting the number grow.

Two layers, on purpose:

| Layer | What it proves |
|---|---|
| Vitest (`src/**/*.test.ts`) | Pure rules: the take-off engine, money pairing, receipt matching, stage progression, invitation language, i18n keys, phone normalisation, the `api/` import graph |
| Database regressions (`scripts/test-*.mjs`) | The real migrations against a throwaway PostgreSQL: RPC behaviour under `SET ROLE authenticated`, RLS, triggers, constraint edge cases. Fixtures live in `scripts/fixtures/` |

The database layer exists because the unit layer cannot see a constraint. Add a fixture row for every new shape a function must accept; a function tested only with finished rows will pass while its first real insert fails.

Manual QA walkthrough: [docs/TESTING.md](docs/TESTING.md) (says port 5173; it is 5174).

---

## Deployment

Vercel Pro, configured in [vercel.json](vercel.json): `pnpm build` to `build/client`, a five-minute `maxDuration` on the dispatcher, three URL aliases, two crons, and the SPA rewrite. The negative lookahead on `api/` in that rewrite is load-bearing.

**Use `www.tryjalla.com`, never the apex.** The apex issues a 308, and neither Stripe webhook delivery, Resend's webhook, nor Postgres `pg_net` follows redirects.

A deployment going green does not mean the database matches it. The migration and the frontend that needs it ship together only if someone pastes the SQL. Each release note in `docs/` says which migrations it needs.

**Supabase Auth → URL Configuration → Site URL** must point at the production domain, or confirmation emails link to localhost.

---

## Automation: agent requests

A request filed at `/admin/requests` produces a screen recording of itself: `agent_requests` insert → trigger → `/api/agent-dispatch` → GitHub `repository_dispatch` → the `Agent requests` workflow → plan (Claude) → record (headless Chrome) → QC → upload. The model plans but does not drive, and nothing ships unchecked. Detail: [docs/AGENT-AUTOMATION.md](docs/AGENT-AUTOMATION.md).

---

## Documentation

Everything except this file lives in [docs/](docs/). The current references, newest first:

| File | What's in it |
|---|---|
| [project-workflow-behaviour-2026-11-14.md](docs/project-workflow-behaviour-2026-11-14.md) | Roles, evidence, payment and price behaviour as implemented. **Start here.** |
| [payment-review-2026-11-14.md](docs/payment-review-2026-11-14.md) | The 14 November payment and pricing release |
| [meeting-implementation-audit-2026-11-14.md](docs/meeting-implementation-audit-2026-11-14.md) | What the November meetings asked for versus what is in the code |
| [communication-framework-release-2026-11-14.md](docs/communication-framework-release-2026-11-14.md), [groundwork-communications.md](docs/groundwork-communications.md), [communication-provider-setup.md](docs/communication-provider-setup.md) | The activation framework, its tables, worker and provider setup |
| [meta-whatsapp-setup.md](docs/meta-whatsapp-setup.md) | Direct Meta WhatsApp, chosen 14 November, not yet configured |
| [account-roles-and-links.md](docs/account-roles-and-links.md), [project-links-review.md](docs/project-links-review.md), [project-team-permissions.md](docs/project-team-permissions.md) | Account types, shareable links, who may invite and approve |
| [ordered-stage-progression.md](docs/ordered-stage-progression.md), [contractor-stage-evidence.md](docs/contractor-stage-evidence.md) | Stage order in the database; who uploads what |
| [receipt-verification-errors.md](docs/receipt-verification-errors.md), [receipt-currency-follow-up.md](docs/receipt-currency-follow-up.md), [exchange-rate-review-2026-11-14.md](docs/exchange-rate-review-2026-11-14.md) | The receipt reader, its error codes, currencies and conversion rules |
| [stage-pricing-account-review.md](docs/stage-pricing-account-review.md) | Stage price amendments |
| [rollout-status-2026-11-13.md](docs/rollout-status-2026-11-13.md) | What was verified live versus only locally |
| [BQ-QUESTIONS.md](docs/BQ-QUESTIONS.md) | Quantity-surveying questions and answers behind the rate tables |
| [GHL-SETUP.md](docs/GHL-SETUP.md), [GHL-CUSTOM-FIELDS.md](docs/GHL-CUSTOM-FIELDS.md), [WHATSAPP-TEMPLATES.md](docs/WHATSAPP-TEMPLATES.md) | GoHighLevel |
| [ADMIN-DASHBOARD.md](docs/ADMIN-DASHBOARD.md), [SECURITY.md](docs/SECURITY.md), [STRIPE.md](docs/STRIPE.md), [SCREEN-DESIGNS.md](docs/SCREEN-DESIGNS.md), [AGENT-AUTOMATION.md](docs/AGENT-AUTOMATION.md) | Standing references |
| [groundwork-beta-feedback-backlog.md](docs/groundwork-beta-feedback-backlog.md) | Open beta-tester findings |
| Groundwork-Project-and-Payment-Flow-Guide-2026-11-14 (`.html`, `.pdf`) | The client and contractor flow as a shareable guide, built by `docs/build-project-flow-guide.mjs` |

**Stale, kept as history:** [PAGES.md](docs/PAGES.md) (July 2026), [TESTING.md](docs/TESTING.md), [memo.md](docs/memo.md), [EXECUTION.md](docs/EXECUTION.md). **Do not follow** [prompt.md](docs/prompt.md): it specifies a different stack and tables that do not exist.

`docs/` also holds meeting notes, daily reports, walkthrough videos, generated decks and the source `.xlsx` bills of quantities. The PDFs and `frames_*` folders at the repository root are recording inputs and exported reports, not code.

---

## Gotchas

- **pnpm, not npm.** Dev port is **5174**.
- **`api/` relative imports need `.js`**, transitively.
- **`www.tryjalla.com`, never the apex.**
- **Migrations are applied by hand.** A merged migration is not a live one. Ask, or probe.
- **Not SSR.** `ssr: false`, no loaders or actions; all data is fetched client-side after auth resolves.
- **Cameroon is the default country everywhere.** Import `DEFAULT_COUNTRY_CODE`; never write `'CM'` inline.
- **`/work` is the contractor workspace, `/contractors` is the public directory.** Do not merge them.
- **`/admin` manages actors; it never executes their work.** No contractor or verifier execution UI inside `/admin`.
- **Real data only in `/admin`.** Empty states when empty.
- **One source of truth for money.** The `payments` ledger plus `stage_payment_receipts`. Never add a parallel wallet, balance or commission table; compensation needs its own design pass before any column.
- **The lit stage dot and the row label must come from the same rule.** `currentStage()` in `StagePipeline.tsx`. Reading one from `activeStage` crashed `/work/projects` on 13 November 2026.
- **A disabled button must look disabled and say why.** The contractor upload button went silent for a day because it did not.
- **Settings prefer `app_config` over Vercel env.**
- **Typecheck can be killed on a small machine.** Exit code 137 is the OOM killer, not a type error. Lower the heap and rerun.
- **Never Docker.** Local PostgreSQL binaries verify SQL.
- **Multiple tier vocabularies coexist.** Canonical is `self_verify` / `jalla_verify` / `jalla_management`; legacy `starter` / `pro` / `enterprise` still appears. `normalizeTier()` in `payments/config.ts` handles it.
- **The GHL v2 API contract was transcribed from documentation.** Its base URL, version header and paths sit in one block at the top of `api/ghl/_client.ts`.

---

© Jalla · Groundwork · MIT licence
