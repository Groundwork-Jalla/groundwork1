# Session Memo — Bilingual Rollout, Docs & Vendor Correction

**Date:** 31 July 2026
**Branch:** `main` · **Baseline at session start:** `0ca1ebd` · **HEAD now:** `647e228`
**State:** working tree clean, in sync with `origin/main`
**Verification:** `pnpm typecheck` clean · `pnpm build` succeeds

---

## At a glance

| # | Work | Outcome |
|---|---|---|
| 1 | Pulled 6 commits from `origin/main` | Fast-forward, no conflicts |
| 2 | Installed dependencies | `node_modules` was missing entirely |
| 3 | Wrote `PAGES.md` | Full route-by-route reference, all 34 routes |
| 4 | Built EN/FR i18n system | New `src/lib/i18n/` + toggle on every layout |
| 5 | Translated the full public site + auth funnel | 456 keys — landing page complete |
| 6 | Made the GHL form language-aware | Config-driven swap; **needs a FR form built in GHL** |
| 7 | Corrected vendor: pawaPay → **Switchr** | 9 UI references + docs |
| 8 | Updated `PAGES.md` for everything above | Re-pinned from `0ca1ebd` to current |

---

## 1. The pull (before any of my changes)

Fast-forwarded `0ca1ebd` → `64ece81`. **6 commits, 27 files, +1,761 / −301.** No conflicts; there were no local commits to rebase.

| Commit | What it added |
|---|---|
| `86a9084` | `useForceLight` hook, applied to landing / community / contractor-apply / pricing |
| `7b07f24` | Realtime stage payment status on project detail + payments tab |
| `2bb841c` | Project tracking gate + budget confirmation process |
| `0ab35f4` | Tracking status display + pre-tracking gate confirmation |
| `63f05ca` | Payment components: `EscrowWallet`, `MilestonePaymentModal`, `PaymentHistory`, `PayoutStatusModal`, `UpgradeScreen` |
| `64ece81` | `/upgrade` route + page, `PaymentsTab` update, import refactor |

**Three things this changed materially:**

1. **New route `/upgrade`** — inside the protected sidebar layout, but with **no sidebar nav entry**. Reachable only via the "Upgrade plan →" link on a project's Payments tab, or direct URL.

2. **Project lifecycle gate** — [migration 018](../supabase/migrations/018_project_tracking.sql) adds `tracking_started_at`. Projects now sit in **planning** until the owner confirms a final budget via `StartTrackingGate`. The `start_project_tracking` RPC is owner-guarded, idempotent, and `SECURITY INVOKER`; in one transaction it writes the budget, re-derives every stage's `payment_milestone_usd`, activates stage 1, and unlocks its substages. Existing projects were grandfathered to `created_at`.
   **Consequence:** the entire 7-tab bar on `/projects/:id` is hidden until the budget is confirmed.

3. **`ProjectPayments` replaced `PaymentsTab`** in `detail.tsx`. `PaymentsTab` still exists in the tree but is no longer rendered.

---

## 2. Dependencies — a correction

I stated earlier in the session that `node_modules` existed. **That was wrong.** My check was `ls node_modules 2>/dev/null | head -3 && echo "EXISTS"` — the `ls` failed silently and the `&&` still fired on `head`'s success.

`node_modules` did not exist. Ran `pnpm install` (the repo uses pnpm; `pnpm-lock.yaml` is committed). Two build scripts are unapproved by default — `core-js` and `esbuild` — run `pnpm approve-builds` if that matters.

---

## 3. `PAGES.md` — route reference

Created a complete page-by-page reference: every route's sections, data sources, states, and conditional logic. Covers all 34 routes across 6 groups, plus the 4 layouts and the root shell.

Initially written against `0ca1ebd`, then **updated in full** at the end of the session for the pull + i18n changes (see §7).

---

## 4. EN/FR internationalisation

**Why:** most Cameroonian users are francophone.

### New files

| File | Purpose |
|---|---|
| `src/lib/i18n/types.ts` | `Lang` union, `LANG_META`, recursive `DeepKeys` type |
| `src/lib/i18n/en.ts` | English source of truth (468 lines) |
| `src/lib/i18n/fr.ts` | French, typed against EN (480 lines) |
| `src/lib/i18n/index.tsx` | Provider, `useT()`, `useLanguage()`, `detectLang()` |
| `src/lib/i18n/external-forms.ts` | GHL form config per language |
| `src/components/ui/LanguageToggle.tsx` | Three toggle variants |

### Design decisions

**Compile-enforced parity.** `fr.ts` is typed as `Mirror<EnDict>`. Add an English key without the French one and **the build fails**. A half-translated screen cannot ship by accident.

**Detection order** — `localStorage.lang` → any `fr-*` in `navigator.languages` → English. A Cameroonian visitor with a French browser **lands in French without touching the toggle**.

**No flash.** A blocking inline script in `root.tsx` resolves the language and stamps `document.documentElement.lang` before first paint, mirroring `detectLang()` exactly. Same pattern as the existing theme script.

**Graceful degradation.** `t()` falls back French → English → raw key, and warns in dev on a miss. Never renders blank.

**French plural rules.** `tPlural()` treats 0 and 1 as singular (French), unlike English which only treats 1 as singular.

**Terminology** — Central/West African construction French, not literal translation: *chantier* (build), *étape* (stage), *sous-étape* (substage), *entrepreneur* (contractor), *justificatifs* (evidence), *maître d'ouvrage* (project owner), *dépendance* (boys' quarters).

### Toggle placement — all 8 chrome surfaces

App sidebar (footer row) · app top bar (compact) · auth layout (segmented, top-right) · tools layout · admin sidebar · landing nav (dark segmented) · wizard header (compact) · plus the standalone navs on `/pricing`, `/community`, `/contractor-apply`.

### Translation coverage

**Done (456 keys)** — all layouts and navigation; the **entire landing page** (hero, stats bar, What Jalla Does, comparison, the 6 risk cards, the 4-step carousel, Why Jalla, closing CTA, countdown, social-proof toast and feed — *including text baked into the animated SVG illustrations*); `/pricing`, `/community`, `/contractor-apply`; all six auth routes; `/onboarding`; `/invite/:token`; `/dashboard`; `/projects`.

**Still English (~500 strings)** — project detail and its 7 tabs, `/payments`, `/profile`, `/help`, `/resources` (incl. the 14 long-form articles), the 10 wizard step bodies, the 5 free tools, the admin panel.

The pattern to continue is mechanical: add keys to `en.ts` → add French to `fr.ts` (compiler catches omissions) → `const t = useT()` → swap the literal.

---

## 5. The GHL form — the one hard limit

**This cannot be solved from this codebase.** The contractor application form on `/contractor-apply` is an `<iframe>` from `api.leadconnectorhq.com` — a different origin. Same-origin policy makes its DOM unreachable to our JavaScript. No library changes this.

**What was built instead:** a config-driven form swap in `src/lib/i18n/external-forms.ts`. The iframe is `key={lang}` so it hard-remounts on switch (GHL's embed script does not react to `src` changes in place). While a locale still points at another language's form, an **amber notice** renders above it saying the form is English-only and that the team speaks French — honest, rather than a toggle that silently does nothing.

### ⚠️ Action required — ~15 min in the GHL dashboard

1. Sites → Forms → open **"Contractor Form"**
2. `...` menu → **Duplicate** → name it "Contractor Form — FR"
3. Translate every field label, placeholder, dropdown option, button, validation message, and the post-submit thank-you screen
4. Save → Integrate/Embed → copy the new form ID (the segment after `/widget/form/`)
5. Paste it into `GHL_CONTRACTOR_FORM.fr.id` in `external-forms.ts` and **delete `fallback: true`**

Step-by-step instructions are also in that file's header comment.

---

## 6. Vendor correction — pawaPay → Switchr

Confirmed: the payment rails are **Stripe + Switchr**, not pawaPay. The old vendor name was in **9 places of shipping UI**, so it was replaced in code as well as docs:

| File | Where |
|---|---|
| `src/app/routes/help.tsx` | FAQ question *and* answer |
| `src/app/routes/payments.tsx` | Info banner |
| `src/components/payments/EscrowWallet.tsx` | Preview disclaimer |
| `src/components/payments/MilestonePaymentModal.tsx` | "via Switchr MoMo" in the money-flow step |
| `src/components/payments/PaymentHistory.tsx` | Payout rail label |
| `src/components/payments/PayoutStatusModal.tsx` | Method row + preview disclaimer |
| `src/components/project/PaymentsTab.tsx` | Footer notice (legacy, unrendered) |
| `src/lib/payments/config.ts` | Header comment |

> **Assumption to confirm:** capitalisation as **"Switchr"**. It was written lowercase in the brief. One-pass fix if it's styled differently.

### Payments status

| Rail | Role | Status |
|---|---|---|
| **Stripe** | Card charge + escrow hold (diaspora payer side) | **API key almost ready** — billing goes live once connected |
| **Switchr** | Mobile-money payout to contractors, XAF/FCFA corridor | Not yet live |

All gated behind `PAYMENTS_ARE_PREVIEW` in `src/lib/payments/config.ts`.

**Real today:** per-stage `payment_status` (`unpaid`/`partial`/`paid`) via `updatePaymentStatus`, with realtime updates; stage milestone amounts re-derived from the confirmed budget.
**Simulated:** the escrow hold, fee split, FX conversion, and the payout tracker's 5 nodes.

---

## 7. `PAGES.md` update

Re-pinned from `0ca1ebd` to current. Patched rather than regenerated:

- Route count **33 → 34**; protected group 11 → 12
- **`/upgrade` documented** — segmented plan selector, reveal card, and the `TIER_BILLING` economics table (10% / 3% / negotiated)
- **`/projects/:id` rewritten** around the lifecycle gate, with a planning-vs-tracking state table and the full `StartTrackingGate` breakdown
- **Payments tab section replaced** — `ProjectPayments`, `EscrowWallet`, `MilestonePaymentModal`, `PayoutStatusModal`; flagged `PaymentsTab` as unrendered
- **Force-light documented** on the four marketing pages
- **New "Payments status: Stripe + Switchr"** section — rail table, all six disclaimer surfaces, real-vs-simulated split
- **New i18n appendix**
- **Dashboard section rewritten** — `JourneyCard` replaced `FunnelCard`; new Total Paid stat; `CostingDonut` now splits by cost *category* (Materials 41% / Fees 34% / Labor 23% / Permits 2%) rather than payment state; `VelocityChart` still in the file but no longer placed

---

## 8. Commits

Both committed and pushed to `origin/main`:

| Commit | Scope |
|---|---|
| `dcd55c9` | i18n + external forms — 26 files, +2,451 / −333 |
| `647e228` | pawaPay → Switchr — 9 files, +177 / −49 |

---

## Open items

### Blocking someone else
1. **Build the French GHL form** (§5) — the only way French applicants get a French form
2. **Confirm "Switchr" capitalisation**

### Environment
3. **No `.env` in the repo.** `pnpm build` fails with `supabaseUrl is required` — `src/lib/supabase/client.ts` passes `import.meta.env.VITE_SUPABASE_URL` to `createClient` unguarded, so the SPA prerender step throws. Needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `RESEND_API_KEY`. Build passes cleanly with placeholder values, so this is config, not code — though guarding the client with a clear error would be kinder than a stack trace.
4. **Dev server runs on port 5174**, not 5173 as `TESTING.md` states.

### Worth deciding before Stripe goes live
5. **`/payments` "Est. Spent" is a guess** — `budget_usd × (completedStages / 10)` — while the project-level wallet uses real `payment_status` data. Once real charges flow, these two figures will visibly disagree. Point `/payments` at the actual payment records when wiring Stripe.

### Carried over from earlier review (still true)
6. **Four tier vocabularies live simultaneously** — `self_verify`/`jalla_verify`/`jalla_management` (canonical), `starter`/`pro`/`enterprise` (legacy, defensively handled everywhere), `/contractors` uses only the legacy set, and `/profile`'s Subscription tab uses a fourth: `free`/`jalla_verified`/`enterprise`. `normalizeTier()` in `payments/config.ts` is the beginning of a fix.
7. **~350 hardcoded dark-mode hex values** across 27 files (`dark:bg-[#1e1e1e]` etc.) instead of tokens — heaviest in `OverviewTab` (51), `profile` (25), `payments` (20).
8. **`prompt.md`** (added in `0ca1ebd`) specifies a different stack — `src/pages/*`, TanStack Query, full shadcn/ui, sonner, react-helmet-async — and ~14 database tables that don't exist. Following it would fork the codebase.
9. **Migration sequence oddities** — `007` missing, `006` renamed `.sql.applied`, `user_roles` created twice, both `profiles` and `user_profiles` exist.

### Translation backlog
10. ~500 strings remain in the authenticated app (§4). Public + auth funnel — the conversion path — is done.
