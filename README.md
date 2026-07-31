# Groundwork by Jalla

**Construction management for the African diaspora.**

Building a home in Africa while living abroad is hard — not because of money, but because of distance, trust, and lack of visibility. You send money, you get photos, you have no way to verify any of it. Groundwork replaces trust-based construction management with a structured, evidence-driven system: **every payment is tied to proof, every stage is independently reviewed, and the whole record lives in one place you can see from anywhere.**

**Live:** [groundwork1-phi.vercel.app](https://groundwork1-phi.vercel.app)

---

## Stack

| Layer | Choice |
|---|---|
| UI | React 19 · TypeScript · Tailwind CSS v4 · Framer Motion · Lucide |
| Routing | React Router v7 — **framework mode, SPA** (`ssr: false`) |
| Backend | Supabase — Postgres, Auth, Storage, Realtime, RLS |
| Email | Resend, via Vercel serverless functions in [`api/`](api/) |
| Payments | Stripe (escrow) + Switchr (XAF mobile-money payouts) — **preview, not live** |
| Hosting | Vercel |
| Monitoring | Sentry · Vercel Analytics · Google Analytics |

The app directory is `src/app` (set in [react-router.config.ts](react-router.config.ts)), not the React Router default.

---

## Quick start

**Requires:** Node 20+ and **pnpm** (the repo commits `pnpm-lock.yaml` — don't use npm).

```bash
pnpm install
```

Create a `.env` in the repo root:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
RESEND_API_KEY=re_your_key        # optional in dev — emails are skipped without it
```

> ⚠️ **The build fails without `VITE_SUPABASE_URL`.** [`src/lib/supabase/client.ts`](src/lib/supabase/client.ts) passes it straight to `createClient` with no guard, so the SPA prerender step throws `supabaseUrl is required`. This is config, not a code bug — but it's the first thing that trips up a fresh clone.

```bash
pnpm dev
```

**→ http://localhost:5174** (port set in [vite.config.ts](vite.config.ts) — *not* Vite's default 5173).

### Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Dev server on :5174 with HMR |
| `pnpm build` | Production build → `build/client/` |
| `pnpm typecheck` | `react-router typegen && tsc` |
| `pnpm start` | ⚠️ Vestigial — SPA mode deletes the server build, so this won't run |

---

## Project structure

```
src/
├── app/
│   ├── root.tsx              # HTML shell, providers, anti-flash theme + lang scripts
│   ├── routes.ts             # Route config — all 34 routes
│   └── routes/               # Route modules, grouped by layout
├── components/
│   ├── landing/              # Marketing page sections
│   ├── contractor/           # Contractor recruitment page sections
│   ├── wizard/               # 10-step project creation wizard
│   ├── project/              # Project detail tabs (stages, budget, docs, chat…)
│   ├── payments/             # Escrow wallet, payment + payout modals, upgrade screen
│   └── ui/                   # Shared primitives
├── contexts/                 # AuthContext, WizardContext
├── lib/
│   ├── supabase/             # All DB access, grouped by domain
│   ├── i18n/                 # EN/FR dictionaries + provider
│   ├── payments/config.ts    # Tier pricing, fees — single source of truth
│   ├── budget.ts             # Cost estimation engine
│   └── countries.ts          # 24 supported countries
├── types/project.ts
└── styles/globals.css

api/                          # Vercel serverless: send-email, send-invite
docs/                         # All project documentation
supabase/migrations/          # 18 SQL migrations
```

Illustrations (blueprints, floor plans, building types, roof types) are **hand-authored inline SVG**, not image assets — which is why files like `BuildingPreview.tsx` are large.

---

## Routes

34 routes in 6 groups. **Full page-by-page reference: [PAGES.md](docs/PAGES.md).**

| Group | Layout | Auth | Count |
|---|---|---|---|
| Public marketing | each page owns its nav | public | 5 |
| Auth | `_auth-layout.tsx` | public | 6 |
| Project wizard | `WizardShell` owns viewport | required | 1 |
| Protected app | `_layout.tsx` (sidebar) | required | 12 |
| Free tools | `tools/_tools-layout.tsx` | public | 5 |
| Admin | `admin/_admin-layout.tsx` | `role === 'admin'` | 5 |

**Core flow:** `/` → `/auth/signup` → `/onboarding` → `/projects/new` (10-step wizard) → `/projects/:id`.

A project starts in a **planning** state and only exposes its tabs once the owner confirms a final budget — see the tracking gate in [PAGES.md](docs/PAGES.md#projectsid--project-detail).

---

## Database

Supabase Postgres with **Row Level Security on everything** — a user can only ever read or write their own data, even at the raw DB level.

Migrations live in [`supabase/migrations/`](supabase/migrations/) and are applied in filename order:

```bash
npx supabase db push     # needs SUPABASE_ACCESS_TOKEN
```

**Storage buckets** (all private): `evidence`, `documents`, `id-documents`.

**Key tables:** `projects`, `project_stages`, `project_substages`, `project_documents`, `project_messages`, `contractor_invites`, `contractors`, `certificates`, `construction_rates`, `notifications`, `profiles`.

---

## Internationalisation

The app is **bilingual English / French** — most Cameroonian users are francophone.

- **Detection:** `localStorage.lang` → any `fr-*` in `navigator.languages` → English. A French-browser visitor lands in French without touching anything.
- **No flash:** a blocking script in `root.tsx` sets `<html lang>` before first paint.
- **Compile-enforced parity:** `fr.ts` is typed as `Mirror<EnDict>` — adding an English key without its French translation **fails the build**.
- **Toggle:** [`LanguageToggle`](src/components/ui/LanguageToggle.tsx) — three variants, present on every layout and nav.

Adding a string:

```ts
// 1. src/lib/i18n/en.ts
nav: { dashboard: 'Dashboard' }

// 2. src/lib/i18n/fr.ts   ← omit this and the build fails
nav: { dashboard: 'Tableau de bord' }

// 3. in your component
const t = useT();
<h1>{t('nav.dashboard')}</h1>
```

The **entire public site** (landing page included, down to the text inside the animated illustrations) and the full auth funnel are translated. The deeper authenticated screens are still English — see [docs/memo.md](docs/memo.md) for the backlog.

> **One known limit:** the contractor application form on `/contractor-apply` is a cross-origin GoHighLevel iframe. Its contents **cannot** be translated from this codebase — the fix is a duplicated French form built in GHL. Instructions are in [`src/lib/i18n/external-forms.ts`](src/lib/i18n/external-forms.ts).

---

## Payments

**The UI is built; the rails are not connected yet.** Everything is gated behind `PAYMENTS_ARE_PREVIEW` in [`src/lib/payments/config.ts`](src/lib/payments/config.ts), which is also the single source of truth for tier pricing and fees.

| Plan | Price | Platform fee |
|---|---|---|
| Self Verify | Free | 10% |
| Jalla Verify | $199/mo | 3% |
| Jalla Management | Custom | negotiated |

**Real today:** per-stage `payment_status` (`unpaid`/`partial`/`paid`) with realtime updates, and stage milestone amounts derived from the confirmed budget.
**Simulated:** escrow hold, fee split, FX conversion, payout tracking.

---

## Deployment

Vercel, configured in [vercel.json](vercel.json):

```json
{ "buildCommand": "pnpm build", "outputDirectory": "build/client",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

The SPA rewrite is required — every route is client-side, so all paths must serve `index.html`.

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `RESEND_API_KEY` in the Vercel project environment.

**Supabase Auth → URL Configuration → Site URL** must point at the production domain, or confirmation emails will link to localhost.

The `api/` functions have dev-server equivalents hand-wired into [vite.config.ts](vite.config.ts), so email works locally too.

---

## Documentation

Everything except this README lives in [`docs/`](docs/).

| File | What's in it |
|---|---|
| [docs/PAGES.md](docs/PAGES.md) | Every route, section by section — the reference |
| [docs/memo.md](docs/memo.md) | Latest session log + open items |
| [docs/EXECUTION.md](docs/EXECUTION.md) | Phase-by-phase build history *(partly stale)* |
| [docs/TESTING.md](docs/TESTING.md) | Manual QA walkthrough *(says port 5173 — it's 5174)* |
| [docs/prompt.md](docs/prompt.md) | ⚠️ **Do not follow.** Specifies a different stack (`src/pages/`, TanStack Query, shadcn/ui) and ~14 tables that don't exist. Following it would fork the codebase. |

---

## Gotchas

- **pnpm, not npm.** The lockfile is pnpm's.
- **Dev port is 5174.**
- **Not SSR.** `ssr: false` — there are no loaders/actions; all data is fetched client-side after auth resolves.
- **Four tier vocabularies coexist.** Canonical is `self_verify`/`jalla_verify`/`jalla_management`; legacy `starter`/`pro`/`enterprise` values are still handled defensively across the app. `normalizeTier()` in `payments/config.ts` is the start of a fix.
- **Dark mode uses ~350 hardcoded hex values** (`dark:bg-[#1e1e1e]`) across 27 files rather than tokens, so shades drift between files.
- **Four marketing pages force light mode** via `useForceLight()` — `/`, `/community`, `/contractor-apply`, `/pricing`.

---

© Jalla · Groundwork
