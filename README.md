# Groundwork by Jalla

**Construction management for the African diaspora.**

Building a home in Africa while living abroad is hard — not because of money, but because of distance, trust, and lack of visibility. You send money, you get photos, you have no way to verify any of it. Groundwork replaces trust-based construction management with a structured, evidence-driven system: **every payment is tied to proof, every stage is independently reviewed, and the whole record lives in one place you can see from anywhere.**

The launch corridor is **US/diaspora clients → Cameroonian contractors**. Cameroon is the default country everywhere (`DEFAULT_COUNTRY_CODE` in [src/lib/countries.ts](src/lib/countries.ts)) and the only one with a calibrated take-off rate table.

**Live:** [tryjalla.com](https://www.tryjalla.com) · **Preview:** [groundwork1-phi.vercel.app](https://groundwork1-phi.vercel.app)

---

## Stack

| Layer | Choice |
|---|---|
| UI | React 19 · TypeScript · Tailwind CSS v4 · Framer Motion · Lucide |
| Routing | React Router v7 — **framework mode, SPA** (`ssr: false`) |
| Backend | Supabase — Postgres, Auth, Storage, Realtime, RLS |
| Serverless | Vercel functions in [`api/`](api/) — email, Stripe, GoHighLevel |
| Email | Resend (`mail.tryjalla.com`) |
| Subscriptions | **Stripe — live** ($199/mo Jalla Verify) |
| Milestone payouts | Switchr, XAF mobile money — **not wired yet** |
| CRM | GoHighLevel — contacts, pipelines, conversation threads |
| Maps | Leaflet / react-leaflet |
| PDF | jsPDF — stage completion certificates |
| Tests | Vitest — 335 tests across 28 files |
| Hosting | Vercel |
| Monitoring | Sentry · Vercel Analytics · Google Analytics 4 |

The app directory is `src/app` (set in [react-router.config.ts](react-router.config.ts)), not the React Router default.

---

## Quick start

**Requires:** Node 20+ and **pnpm** (the repo commits `pnpm-lock.yaml` — don't use npm).

```bash
pnpm install
cp .env.example .env    # then fill it in
pnpm dev
```

**→ http://localhost:5174** (port set in [vite.config.ts](vite.config.ts) — *not* Vite's default 5173).

The bare minimum for the app to boot:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
RESEND_API_KEY=re_your_key        # optional in dev — emails are skipped without it
```

> ⚠️ **The build fails without `VITE_SUPABASE_URL`.** [`src/lib/supabase/client.ts`](src/lib/supabase/client.ts) passes it straight to `createClient` with no guard, so the SPA prerender step throws `supabaseUrl is required`. This is config, not a code bug — but it's the first thing that trips up a fresh clone. Placeholder values are enough to get a build through.

[`.env.example`](.env.example) is the complete, commented list. The split that matters: **`VITE_*` is compiled into the browser bundle and is public**; everything else is server-only and read by `api/`. A GHL webhook URL or a service-role key with a `VITE_` prefix is a leak.

### Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Dev server on :5174 with HMR |
| `pnpm build` | Production build → `build/client/` |
| `pnpm typecheck` | `react-router typegen && tsc` |
| `pnpm test` | Vitest, single run |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm agent:queue` | Produce pending `/admin/requests` videos locally |
| `pnpm media:setup` | Python venv for the video/deck pipeline (ffmpeg, python-pptx, python-docx) |
| `pnpm start` | ⚠️ Vestigial — SPA mode deletes the server build, so this won't run |

---

## Project structure

```
src/
├── app/
│   ├── root.tsx              # HTML shell, providers, anti-flash theme + lang scripts
│   ├── routes.ts             # Route config — all 47 routes
│   └── routes/               # Route modules, grouped by layout
│       ├── auth/  projects/  tools/  admin/
├── components/
│   ├── landing/              # Marketing page sections (16)
│   ├── contractor/           # Contractor application + recruitment (12)
│   ├── wizard/               # 11-step project creation wizard + inline SVG blueprints
│   ├── project/              # Project detail tabs (15)
│   ├── payments/             # Escrow wallet, payment + payout modals, upgrade screen
│   ├── takeoff/              # BQ line grid + estimate comparison
│   ├── shell/                # AppShell, AppSidebar, SiteNav, SiteFooter, nav-config
│   ├── admin/  legal/
│   └── ui/                   # Shared primitives (16)
├── contexts/                 # AuthContext, ThemeContext, WizardContext
├── hooks/                    # useCarousel, useForceLight, useJoinDestination
├── lib/
│   ├── budget/               # Take-off + cost engine (see below)
│   ├── supabase/             # All DB access, grouped by domain (18 modules)
│   ├── i18n/                 # EN/FR dictionaries + provider
│   ├── contractor/           # Application steps, phone/E.164, CRM payloads
│   ├── email/                # Resend senders + HTML templates
│   ├── payments/config.ts    # Tier pricing, fees — single source of truth
│   ├── certificates/  pdf/  legal/  auth/  theme/
│   ├── plan-limits.ts        # Free-plan cap, mirrored from migration 053
│   └── countries.ts          # 25 supported countries, Cameroon default
├── types/project.ts
└── styles/globals.css

api/                          # Vercel serverless — see api/README.md
├── events.ts                 # Dispatcher: 14 actions behind one function
├── _handlers/                # One handler per file (underscore = not a function)
├── ghl/                      # GoHighLevel client, pipelines, OAuth, outbox
├── stripe/                   # Checkout, portal, webhook
└── _lib/

docs/                         # All project documentation
supabase/migrations/          # 71 SQL migrations
scripts/                      # agent-queue, agent-produce
.github/workflows/            # Automated agent request production
```

Illustrations (blueprints, floor plans, building types, roof types) are **hand-authored inline SVG**, not image assets — which is why files like `BuildingPreview.tsx` (1,164 lines) are large.

---

## Routes

**47 routes in 7 groups.** Full page-by-page reference: [docs/PAGES.md](docs/PAGES.md).

| Group | Layout | Auth | Count |
|---|---|---|---|
| Public marketing | `_public-layout.tsx` | public | 7 |
| Auth + onboarding | `_auth-layout.tsx` | public | 7 |
| Project wizard | `WizardShell` owns viewport | required | 1 |
| Protected app | `_layout.tsx` (sidebar) | required | 14 |
| Free tools | `tools/_tools-layout.tsx` | public | 5 |
| Staff sign-in | none — standalone | public | 1 |
| Admin panel | `admin/_admin-layout.tsx` | `isAdmin` | 12 |

**Core flow:** `/` → `/auth/signup` → `/onboarding` → `/projects/new` (11-step wizard) → `/projects/:id`.

`/admin/login` sits **outside** the admin layout on purpose: that layout redirects unauthenticated visitors to it, so nesting it would redirect to itself forever.

### The project lifecycle gate

A project starts in **planning** and exposes none of its tabs until the owner confirms a final budget through `StartTrackingGate`. The `start_project_tracking` RPC is owner-guarded, idempotent and `SECURITY INVOKER`; in one transaction it writes the budget, re-derives every stage's `payment_milestone_usd`, activates stage 1 and unlocks its substages (migration 018).

Once tracking starts, `/projects/:id` shows **7 tabs** for an owner — Overview, Stages, Costing, Timeline, Payments, Documents, Messages — and a reduced set for an invited contractor.

---

## The take-off engine

[`src/lib/budget/`](src/lib/budget/) is the commercial core, not a rate-per-m² multiplier. It runs a real quantity take-off:

| Module | Does |
|---|---|
| `geometry.ts` | Derives quantities from the wizard answers — footprint, rooms, openings |
| `roof.ts` | Roof forms and coverings, pitched vs. flat area maths |
| `engine.ts` | Runs the take-off into 9 trade sections |
| `lines.ts` | Individual BQ lines, plus contractor overrides |
| `bq-items.ts` | The BQ item catalogue |
| `model.ts` | City rate tables, `CM_TAKEOFF`, baseline city, `hasLocalBq` |
| `derivation.ts` | Re-derives a stored budget back into its parts |
| `index.ts` | Composes it all — `projectBudget`, `composeBudget`/`decomposeBudget`, and the per-stage payment schedule |
| `legacy.ts` | Flat-multiplier fallback for countries with no local BQ |

Nine trade sections: preliminary, foundation, ground floor, upper floor, roof, joinery, electrical, plumbing, finishing.

Rates live in the database (`construction_rates`, `construction_city_rates`) and have been calibrated against real Cameroonian bills of quantities — see [docs/BQ-QUESTIONS.md](docs/BQ-QUESTIONS.md) and the spreadsheets in `docs/`. Contractors can file their own take-off at `/projects/:id/takeoff` and it is compared line by line against the estimate.

This engine has **7 test files and the heaviest coverage in the repo.** Change a rate or a formula and run `pnpm test` before anything else.

---

## Database

Supabase Postgres with **Row Level Security on everything** — a user can only ever read or write their own data, even at the raw DB level. Privileged reads go through `SECURITY DEFINER` RPCs, which migration 066 pins to a fixed `search_path`.

Migrations live in [`supabase/migrations/`](supabase/migrations/) and are applied in filename order:

```bash
npx supabase db push     # needs SUPABASE_ACCESS_TOKEN
```

In practice most have been applied by pasting into **Supabase → SQL Editor**, which is what the setup docs assume.

**Storage buckets** (all private): `evidence`, `documents`, `id-documents`, `contractor-docs`, `agent-outputs`.

**Tables** — 31, grouped by what they serve:

| Area | Tables |
|---|---|
| Projects | `projects`, `project_stages`, `project_substages`, `project_documents`, `project_messages`, `project_takeoffs`, `project_fees`, `project_audit_log` |
| People | `profiles`, `user_profiles`, `user_roles`, `contractors`, `contractor_invites`, `contractor_applications`, `contractor_application_drafts` |
| Growth | `waitlist_members`, `waitlist_emails` |
| Money | `billing_events`, `certificates` |
| Rates | `construction_rates`, `construction_city_rates` |
| CRM | `ghl_outbox`, `ghl_inbound_events`, `ghl_oauth_tokens`, `ghl_delivery_log`, `ghl_sync_failures` |
| Ops | `notifications`, `app_config`, `agent_requests`, `agent_notify_log`, `admin_deleted_projects` |

**Rules enforced in the database, not just the UI:**

- **Free-plan project cap** — `check_starter_project_limit()` (migration 053) allows 3 `self_verify` projects. Archived ones **count**, and owners cannot delete, so the number only goes up — the one exception being an admin deleting a project (069). [`src/lib/plan-limits.ts`](src/lib/plan-limits.ts) mirrors that function deliberately; the two must stay identical or the UI and the database disagree in ways that produce visible bugs.
- **Tier changes** — migrations 060–062 guard `projects.tier` so only the Stripe webhook (service role) can grant a paid tier. The browser cannot promote itself.
- **`app_config`** — RLS on, no policies. Only `SECURITY DEFINER` functions read it. It holds runtime settings (CRM credentials, notification recipients) *because Vercel's free plan ran out of environment variables*, and because a row takes effect in a minute with no redeploy.

> **Migration numbering has collisions:** two `043_` and two `045_` files, `006` renamed `.sql.applied`, and no `007`. Harmless as applied, but don't assume filename order is a total order.

---

## `api/` — two rules that have each broken production

Read [api/README.md](api/README.md) before touching anything in there. Both rules below are enforced by tests in `src/lib/email/`.

### 1. Twelve serverless functions, maximum

Vercel's Hobby plan allows **12 functions per deployment, and every `.ts` file under `api/` is one** (paths with a leading-underscore segment are exempt).

Going over does not fail loudly. The build fails, **the previous deployment keeps serving**, and the site looks completely normal — so pushes appear to succeed while production quietly freezes. This happened: seven endpoints were added over two days, every deployment failed from the first one, and two separate bugs were chased for hours that had both already been fixed and merged.

The fix is not to delete features but to **collapse entry points**: handlers live one per file under `api/_handlers/`, behind the dispatcher in [`api/events.ts`](api/events.ts). Add an *action* there, not a file.

`src/lib/email/api-function-count.test.ts` is the smoke alarm, and it fails at 12 so there is always one slot of headroom. Currently **11 of 12**.

### 2. Relative imports need a `.js` extension

Vercel transpiles each file on its own and does **not** bundle. `package.json` is `"type": "module"`, so Node's ESM resolver loads the output — which demands an explicit extension, refuses `@/*` aliases, and has no `import.meta.env`.

```ts
import { getStripe } from '../_lib/stripe';      // ERR_MODULE_NOT_FOUND
import { getStripe } from '../_lib/stripe.js';   // correct
```

**This applies transitively**, which is why `src/lib/email/*` and `src/lib/i18n/{translate,fr}.ts` carry extensions while the rest of `src/` does not. It has been broken twice, and the second time was invisible: a *dynamic* import failed at call time, so the function booted and answered while applicants saw "submitted" and the email reached nobody. `api-import-graph.test.ts` walks the whole graph for exactly this reason — `vite dev` re-implements these endpoints in middleware and never loads the real handler, so nothing else catches it.

---

## Payments

**Two rails, and they are no longer in the same state.** Both flags live in [`src/lib/payments/config.ts`](src/lib/payments/config.ts), which is also the single source of truth for tier economics.

| Rail | What | Status |
|---|---|---|
| **Stripe** | Jalla Verify subscription, client → Jalla | **Live** — `SUBSCRIPTIONS_ARE_PREVIEW = false` |
| **Switchr** | Milestone funds + contractor payouts in XAF | **Not wired** — `MILESTONE_PAYMENTS_ARE_PREVIEW = true` |

Contractors are **never** paid through Stripe: Stripe Connect does not support payouts to Cameroon, and no milestone money passes through a Stripe balance.

| Plan | Price | Processing fee | Verification |
|---|---|---|---|
| Self Verify | Free — 3 projects | 10% | the owner approves their own stages |
| Jalla Verify | $199/mo | 3% | Jalla reviews and approves each stage |
| Jalla Management | Negotiated | custom | Jalla runs the project |

Numbers live in `TIER_ECONOMICS`; every user-facing string for a tier lives in the i18n dictionary and is read through `useTierBilling()` in [`src/lib/tier-labels.ts`](src/lib/tier-labels.ts). They used to live together and had already drifted — **one home for the money, one home for the words.**

**Real today:** Stripe Checkout, the customer portal, subscription webhooks (migration 021), and per-stage `payment_status` (`unpaid`/`partial`/`paid`) with realtime updates.
**Simulated:** escrow hold, fee split, FX conversion, the payout tracker's five nodes.

Setup and webhook configuration: [docs/STRIPE.md](docs/STRIPE.md). Say **"processing fee"**, never "platform fee" — see [docs/SCREEN-DESIGNS.md](docs/SCREEN-DESIGNS.md).

---

## CRM — GoHighLevel

The largest subsystem outside the app itself, and the focus of most recent work. Lifecycle events (signup, application filed, application decided, project created, subscription changed) are mirrored into GoHighLevel while **Supabase stays the source of truth**.

**Three transports, in order of preference:**

1. **API v2** — contacts upserted by email so one person is one record, which is what makes tags and pipeline moves possible at all.
2. **Inbound webhooks** — the fallback when no API token is configured, or while one is broken.
3. **`ghl_outbox`** — anything that fails is queued with its error and attempt count, replayable from `/admin/crm` or `/api/events?action=crm-retry`.

Also implemented: OAuth token management for the Marketplace app, transactional emails recorded onto the contact's **conversation thread** (sent by Resend, *logged* to GHL), phone normalisation to E.164, duplicate detection, and an audit that finds misrouted contacts.

**A CRM outage must never break a signup.** Every path fails soft and logs a warning — which is exactly why `/admin/crm` exists: it reads the live configuration, shows a tick per setting, tests the token against GHL, and lists everything waiting in the outbox. It is the only way to tell "working" from "quietly doing nothing."

Full step-by-step setup: **[docs/GHL-SETUP.md](docs/GHL-SETUP.md)** — including three undocumented GoHighLevel behaviours that each cost real debugging time. Field mapping: [docs/GHL-CUSTOM-FIELDS.md](docs/GHL-CUSTOM-FIELDS.md).

---

## Account security

One password policy in [`src/lib/auth/password-policy.ts`](src/lib/auth/password-policy.ts),
shared by `/auth/signup` and `/auth/new-password`: 10 characters, upper, lower, a digit,
not a common password, and not containing the user's own name or email. A strength meter
([`PasswordStrength`](src/components/ui/PasswordStrength.tsx)) sits on both.

**TOTP two-factor** is enrolled at `/profile` → Security and challenged at `/auth/login`
and `/auth/callback` — the callback included, because Google sign-in lands there and
leaving it out would make the OAuth button a way past 2FA. The challenge runs *before* the
password-recovery branch, so a reset cannot be used to skip the second factor.

> ⚠️ **Two Supabase dashboard settings are required** before the policy and 2FA are more
> than a client-side courtesy — the password minimum and enabling TOTP. A third decision
> (enforcing AAL at the database, so a half-authenticated session cannot be used against
> PostgREST directly) is **not done**, and is written up honestly in
> [docs/SECURITY.md](docs/SECURITY.md).

---

## Internationalisation

The app is **bilingual English / French** — most Cameroonian users are francophone.

- **Detection:** `localStorage.lang` → any `fr-*` in `navigator.languages` → English. A French-browser visitor lands in French without touching anything. Also persisted to `profiles.preferred_lang` (migration 025) so it follows the account.
- **No flash:** a blocking script in `root.tsx` sets `<html lang>` before first paint.
- **Compile-enforced parity:** `fr.ts` is typed as `Mirror<EnDict>` — adding an English key without its French translation **fails the build**. A half-translated screen cannot ship by accident.
- **French plural rules:** `tPlural()` treats 0 and 1 as singular, unlike English.
- **Terminology** is Central/West African construction French, not literal translation: *chantier*, *étape*, *sous-étape*, *entrepreneur*, *justificatifs*, *maître d'ouvrage*, *dépendance*.

```ts
// 1. src/lib/i18n/en.ts
nav: { dashboard: 'Dashboard' }

// 2. src/lib/i18n/fr.ts   ← omit this and the build fails
nav: { dashboard: 'Tableau de bord' }

// 3. in your component
const t = useT();
<h1>{t('nav.dashboard')}</h1>
```

The **entire public site** (landing page included, down to the text inside the animated illustrations), the full auth funnel, the dashboard and the admin CRM screens are translated. Some deeper authenticated screens are still English — the pattern to continue is mechanical.

> **One known limit:** the contractor application form embedded on `/contractor-apply` is a cross-origin GoHighLevel iframe. Its contents **cannot** be translated from this codebase — the fix is a duplicated French form built in GHL. Instructions are in [`src/lib/i18n/external-forms.ts`](src/lib/i18n/external-forms.ts). While a locale points at another language's form, an amber notice says so, rather than a toggle that silently does nothing.

---

## Theming

Dark mode is an **account preference**, not a device setting: stored in `localStorage` (read by the pre-paint script in `root.tsx`, so no flash) and in `profiles.preferred_theme` (migration 043) so it follows the account to a new device. If the browser has no explicit choice, the profile value wins; otherwise the local choice wins and is pushed up.

[`ThemeProvider`](src/contexts/ThemeContext.tsx) is the **single writer** of the `dark` class on `<html>`. Never touch `document.documentElement.classList` for theme anywhere else.

**Five surfaces are deliberately light-only** and call `useForceLight()` — `/`, `/pricing`, `/contractor-apply`, `/jalla-management`, and the legal pages. They contain zero `dark:` classes. This is a decision, not a bug: do not add `dark:` classes to them piecemeal, which would produce exactly the half-dark page the opt-out prevents.

---

## Testing

```bash
pnpm test          # 335 tests, 28 files, ~3s
pnpm typecheck     # react-router typegen && tsc
```

Coverage is deliberately uneven — it sits where a mistake is expensive or invisible:

| Area | Why it's tested |
|---|---|
| `lib/budget/*` (7 files) | Money. A wrong rate is a wrong quote to a real client. |
| `lib/contractor/*` (12 files) | CRM payload shapes, phone E.164, pipeline/stage mapping |
| `lib/email/*` | The two `api/` deploy rules above, plus email validity and rendering |
| `lib/i18n/data-keys.test.ts` | Pins dictionary keys to the tier feature counts |
| `lib/supabase/stage-seeds.test.ts` | The 10-stage pipeline generated per project type |

Manual QA walkthrough: [docs/TESTING.md](docs/TESTING.md).

---

## Deployment

Vercel, configured in [vercel.json](vercel.json):

```json
{ "buildCommand": "pnpm build", "outputDirectory": "build/client",
  "rewrites": [
    { "source": "/api/crm-oauth", "destination": "/api/events?action=crm-oauth" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ] }
```

The SPA rewrite is required — every route is client-side, so all paths must serve `index.html`. The negative lookahead on `api/` is **load-bearing**: without it the rewrite swallows the serverless functions. The `crm-oauth` alias exists because GoHighLevel's Marketplace app needs a fixed, clean redirect URL.

**Use `www.tryjalla.com`, never the apex.** `tryjalla.com` issues a 308 redirect, and neither Stripe's webhook delivery nor Postgres `pg_net` follows redirects — so an apex URL in either place fails silently. This has bitten the Stripe webhook and the notification pipeline.

Environment variables go in the Vercel project settings; see [`.env.example`](.env.example). Anything that can instead live in `app_config` should, because a Vercel variable needs a redeploy before it does anything.

**Supabase Auth → URL Configuration → Site URL** must point at the production domain, or confirmation emails link to localhost.

The `send-email` and `send-invite` functions have dev-server equivalents hand-wired into [vite.config.ts](vite.config.ts), so email works locally. **Note this means dev never loads the real handlers** — which is why the import-graph test exists.

---

## Automation — agent requests

A request filed at `/admin/requests` produces itself: `agent_requests` insert → trigger (migration 056) → `/api/agent-dispatch` → GitHub `repository_dispatch` → [`.github/workflows/`](.github/workflows/) → plan (Claude) → record (headless Chrome) → QC → upload → status.

Two things make it safe to leave alone: **the model plans but does not drive** (it returns a shot list from a fixed vocabulary that `docs/recording/play_plan.py` executes; off-site paths are refused), and **nothing ships unchecked** (`qc.py` catches blank frames, stalled drivers and short runs — all three have happened for real).

Notification emails are sent **by the database itself**, calling Resend directly from the insert trigger, bypassing Vercel and GitHub entirely.

**Currently dormant:** `ANTHROPIC_API_KEY` is not configured, so automatic production is off. That is a supported state — the runner exits 0, requests stay at `new`, and `pnpm agent:queue` still works by hand. Full detail: [docs/AGENT-AUTOMATION.md](docs/AGENT-AUTOMATION.md).

---

## Documentation

Everything except this README lives in [`docs/`](docs/).

| File | What's in it |
|---|---|
| [docs/PAGES.md](docs/PAGES.md) | Every route, section by section — the reference |
| [docs/GHL-SETUP.md](docs/GHL-SETUP.md) | GoHighLevel setup, step by step — **current** |
| [docs/GHL-CUSTOM-FIELDS.md](docs/GHL-CUSTOM-FIELDS.md) | CRM field mapping |
| [docs/SECURITY.md](docs/SECURITY.md) | Password policy, 2FA, reset flow — **and the two Supabase settings they need** |
| [docs/STRIPE.md](docs/STRIPE.md) | Stripe products, webhook, going live |
| [docs/SCREEN-DESIGNS.md](docs/SCREEN-DESIGNS.md) | The decided A/B variant for all 20 screens — **read before restyling anything** |
| [docs/BQ-QUESTIONS.md](docs/BQ-QUESTIONS.md) | Quantity-surveying questions and answers behind the rate tables |
| [docs/AGENT-AUTOMATION.md](docs/AGENT-AUTOMATION.md) | The `/admin/requests` production pipeline |
| [docs/TESTING.md](docs/TESTING.md) | Manual QA walkthrough *(says port 5173 — it's 5174)* |
| [docs/corrections/](docs/corrections/) | Drafted customer corrections — **`false-payment-confirmation.md` is unsent** |
| [docs/memo.md](docs/memo.md) | Session log, 31 July 2026 *(stale in places)* |
| [docs/EXECUTION.md](docs/EXECUTION.md) | Phase-by-phase build history *(stale — predates payments, CRM, take-off)* |
| [docs/prompt.md](docs/prompt.md) | ⚠️ **Do not follow.** Specifies a different stack (`src/pages/`, TanStack Query, shadcn/ui) and ~14 tables that don't exist. Following it would fork the codebase. |

`docs/` also holds the generated decks, walkthrough videos and the source `.xlsx` bills of quantities.

---

## Gotchas

- **pnpm, not npm.** The lockfile is pnpm's.
- **Dev port is 5174.**
- **12 serverless functions, hard cap.** See above — it fails silently and freezes production.
- **`api/` relative imports need `.js`.** Transitively. See above.
- **`www.tryjalla.com`, never the apex** — 308 redirects break Stripe webhooks and `pg_net`.
- **Not SSR.** `ssr: false` — no loaders or actions; all data is fetched client-side after auth resolves.
- **Settings prefer `app_config` over Vercel env** — a table row takes effect in a minute, an env var needs a redeploy.
- **No emoji in the app UI.** Icons are black and white. Platform-wide rule from [docs/SCREEN-DESIGNS.md](docs/SCREEN-DESIGNS.md), along with "processing fee" over "platform fee" and colour as a status accent rather than a data channel.
- **Cameroon is the default country everywhere.** Import `DEFAULT_COUNTRY_CODE`; never write `'CM'` inline.
- **Archived projects still count against the free cap**, and owners cannot delete projects (migration 053). Only an admin can delete one, from `/admin/projects` (migration 069) — which does hand the owner a free-plan slot back, on purpose.
- **Deleting a project is two calls that cannot be one.** The row is in Postgres, the files are in Storage, and nothing joins them — so `admin_delete_project()` returns the storage paths it gathered *before* the cascade, and the client removes the bytes *after*. Never reverse that: purging storage first can destroy a live project's evidence if the delete then fails.
- **Multiple tier vocabularies coexist.** Canonical is `self_verify`/`jalla_verify`/`jalla_management`; legacy `starter`/`pro`/`enterprise` values are still handled defensively. `normalizeTier()` in `payments/config.ts` is the start of a fix.
- **Dark mode uses ~447 hardcoded hex values** (`dark:bg-[#1e1e1e]`) across 41 files rather than tokens, so shades drift between files.
- **`CONTRACTORS_LOCKED_FOR_DEMO`** in [`src/lib/demo-gate.ts`](src/lib/demo-gate.ts) still reads as temporary but is now the real Jalla Verify paywall on the contractor directory. Read the header before removing it.
- **`PaymentsTab.tsx` is dead code** — `ProjectPayments` replaced it and it is no longer rendered.
- **The GHL v2 API contract is unverified** — the base URL, version header and paths in `api/ghl/_client.ts` were transcribed from published documentation. They sit in one block at the top of that file, so a 404 or 422 on a first real call is a five-line correction rather than an investigation.

---

© Jalla · Groundwork
