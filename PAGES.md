# Groundwork — Complete Page & Route Reference

Every route in the app, what it renders, and what each section does.

**Stack:** React 19 · React Router v7 (framework mode, SPA — `ssr: false`) · Tailwind v4 · Supabase · Framer Motion · Vercel

**Route config:** [src/app/routes.ts](src/app/routes.ts) · **App dir:** `src/app` (set in [react-router.config.ts](react-router.config.ts))

**34 routes** across 6 groups, wrapped by 4 layouts and one root shell.

| Group | Layout | Auth | Routes |
|---|---|---|---|
| Public marketing | none (each page owns its nav) | public | 5 |
| Auth | `_auth-layout.tsx` | public | 6 |
| Project wizard | none (WizardShell owns viewport) | required | 1 |
| Protected app | `_layout.tsx` (sidebar) | required | 12 |
| Free tools | `tools/_tools-layout.tsx` | public | 5 |
| Admin | `admin/_admin-layout.tsx` | admin role | 5 |

> **Two cross-cutting behaviours added after the initial write-up:**
> 1. **Bilingual (EN/FR)** — a language toggle appears on every layout and nav. See [Appendix: Internationalisation](#appendix-internationalisation).
> 2. **Project lifecycle gate** — projects now start in a *planning* state and only expose their tabs once the owner confirms a final budget. See [`/projects/:id`](#projectsid--project-detail).

---

## 0. The Root Shell — [src/app/root.tsx](src/app/root.tsx)

Wraps every route in the app. Not a page itself.

**`Layout` export** — the HTML document:
- `<title>Groundwork by Jalla</title>`, viewport meta, favicon (SVG + ICO + apple-touch)
- Google Fonts preconnect + stylesheet: **Plus Jakarta Sans** (400–900) and **Inter** (400–600)
- **Anti-flash theme script** — a blocking inline script reads `localStorage.theme`, falls back to `prefers-color-scheme`, and stamps `.dark` on `<html>` *before first paint* ([root.tsx:39](src/app/root.tsx#L39))
- Google Analytics `gtag` snippet, injected only when `GA_ID` is set
- **Skip-to-main-content** link — screen-reader-only until focused
- `<ScrollRestoration />`, `<Scripts />`, Vercel `<Analytics />`

There is also a **second anti-flash script** that resolves the language before first paint — reading `localStorage.lang`, falling back to any `fr-*` entry in `navigator.languages`, then stamping `document.documentElement.lang`. It mirrors `detectLang()` exactly so the server-rendered `lang` attribute and the React state never disagree.

**`AppInner` (default export)** — `LanguageProvider` → `AuthProvider` → `Sentry.ErrorBoundary` → `#main-content` → `<Outlet />`. Exported through `Sentry.withProfiler`.

> The skip-to-content link lives in `Layout`, **outside** `LanguageProvider`, so it is the one string in the app that stays English.

**`ErrorBoundary` export** — catches route errors. Shows "404 / The requested page could not be found" for 404s, and in dev mode prints the error message plus a scrollable stack trace.

---

# 1. Public Marketing Routes

## `/` — Landing Page
[routes/landing.tsx](src/app/routes/landing.tsx) → [components/landing/LandingPage.tsx](src/components/landing/LandingPage.tsx)

The route file is a small wrapper that does two things: **if a session exists, redirect to `/dashboard`** (logged-in users never see the marketing page), and call **`useForceLight()`**.

> **`useForceLight`** ([src/hooks/useForceLight.ts](src/hooks/useForceLight.ts)) strips `.dark` from `<html>` on mount and restores it on unmount if the user's stored preference was dark. It is applied to **`/`, `/community`, `/contractor-apply`, and `/pricing`** — those four pages are art-directed for a light background and now **always render light, regardless of the theme toggle**. The theme toggle is deliberately absent from their navs; the *language* toggle is present on all four.

`LandingPage` composes 12 components top to bottom:

| # | Section | Contents |
|---|---|---|
| 1 | `LandingNav` | Sticky top nav, logo, a segmented **EN\|FR** language toggle (dark variant), and links to `/community` ("Join for Free") and `/contractor-apply` |
| 2 | `HeroSection` | Headline "Introducing the New Way of Building Back Home / Without Losing Control", animated `HeroScene` illustration |
| 3 | `StatsBar` | Scroll-triggered counting numbers: "Diaspora builds go over budget", "Average cost overrun", "Verified construction stages", "Substage checkpoints" |
| 4 | `WhatJallaDoes` | "WHAT JALLA DOES" eyebrow + explainer; contains a video placeholder still marked *"Video coming soon"* |
| 5 | `ComparisonSection` | Side-by-side "Without Structure" (light) vs "With Groundwork" (dark), driven by `ComparisonScenes` |
| 6 | `RiskSection` | Six risk cards — Budget Drains Silently · No Clear Milestones · No One Verifies the Work · No Photo or Video Proof · Costly Delays · Builder & Owner Misaligned. Animated via `RiskScenes` + `LossCounter` |
| 7 | `PlatformCarousel` | Four-step how-it-works carousel — "Create a project" → "Contractor submits evidence" → "Jalla verifies the work" → "Payment gets sent out". Slides live in `CarouselSlides`, driven by the `useCarousel` hook |
| 8 | `WhyUseJalla` | Three value props — "Your money stays protected", "Every stage is independently checked", "Full visibility from anywhere" |
| 9 | `CTASection` | Closing conversion block |
| 10 | `FooterSection` | Logo bottom-left, social icons right |
| 11 | `SocialProofToast` | Floating bottom-left toast cycling fake-but-plausible joins ("Emmanuel from Douala joined"), fed by `SocialProofFeed` |
| 12 | `BackToTop` | Arrow button that appears after scrolling |

Wrapper uses `overflow-x-clip` to stop horizontal bleed from the animated scenes.

## `/contractor-apply` — Contractor Recruitment
[routes/contractor-apply.tsx](src/app/routes/contractor-apply.tsx)

A separate long-form sales page aimed at construction professionals, not homeowners. Own sticky **dark** nav (`bg-brand-near-black`) with light-variant logo, a segmented **EN|FR** toggle, and a "← Back to Home" link. Calls `useForceLight()`.

Eleven sections from [components/contractor/](src/components/contractor/):

1. `ContractorHero` — "Founding Partner Application"
2. `RealitySection` — "The system around you is broken." (labelled *THE PROBLEM*)
3. `IntroducingJalla` — *THE SOLUTION* — "Jalla is not random leads. It's coordinated execution."
4. `FoundingAdvantage` — early-partner incentives
5. `ValueStack` — what the contractor receives
6. `RolesPipeline` — *THE NETWORK* — the trades Jalla recruits
7. `FitSection` — qualification / who this is for
8. `HowItWorks` — the onboarding process
9. `ContractorComparison` — "Without Jalla" vs with
10. `SocialProof` — "We're onboarding a limited number of partners per trade, per region."
11. `ContractorCTA` — the application form itself (see below)

Footer is distinct from the main site: reads **"Jalla — THE FIRM"** rather than Groundwork branding. `BackToTop` included.

### The GHL application form — [ContractorCTA.tsx](src/components/contractor/ContractorCTA.tsx)

The only place in the app that embeds third-party content. Section header, a 4-item perks grid, and a pulsing "Apply as a Founding Partner" button that reveals the form on click and smooth-scrolls to it.

The form is a **cross-origin `<iframe>`** served from `api.leadconnectorhq.com`, with GoHighLevel's `form_embed.js` injected into `<body>` only once the form is opened (and removed on unmount). Because it is a different origin, **its contents cannot be read, restyled, or translated by any code in this project** — same-origin policy forbids it.

Language handling therefore works by **swapping which form is embedded**, configured in [src/lib/i18n/external-forms.ts](src/lib/i18n/external-forms.ts):
- `GHL_CONTRACTOR_FORM` maps each language to a `{ id, height, fallback? }` config
- The iframe is `key={lang}`, forcing a full remount on switch — GHL's embed script does not react to `src` changes in place
- While a locale still points at another language's form (`fallback: true`), an **amber notice** renders above the iframe stating the form is English-only and that the team speaks French

Finishing this requires duplicating and translating the form inside the GHL dashboard, then pasting the new form ID into that config. The file carries step-by-step instructions in its header comment.

## `/community` — Waitlist Signup
[routes/community.tsx](src/app/routes/community.tsx)

**Split-screen, locked to viewport** (`h-dvh overflow-hidden`) — the page itself never scrolls. Calls `useForceLight()`.

**Left panel (44–46% width, desktop only)** — `BlueprintPanel`: a hand-authored 520×700 SVG architectural floor plan on `#0a0a0a`. Deliberately drawn with **no outer bounding box** — walls run off-canvas so the plan bleeds to the edges. Includes a fine grid pattern, interior partitions, dashed door arcs, top and left dimension lines with real measurements (7,200 / 2,500 / 4,400 / 3,600 / 5,400 / 1,800), four numbered room circles, and window notches. Groundwork logo (light, `xl`) centred on top.

**Right panel (white, scrollable within itself)**:
- Mobile-only dark top bar with logo, EN|FR toggle, and "← Home"
- Desktop-only EN|FR toggle pinned top-right, plus a "← Back to Home" link
- H1 "Join the Community"
- `CountdownClock` (dark variant) — live ticking launch countdown, shared with the landing page
- Copy: "We're putting on the finishing touches…"
- **Form** — Full name (required), Email (required), "Where are you building?" (optional, e.g. "Lagos, Nigeria")

**Submit** writes to **two tables**: `waitlist_emails` (email; a `23505` unique-violation is caught and shown as *"You're already on the list."*), then `waitlist_members` (name + location). Fires `trackEvent('waitlist_joined')`.

**Success state** — `AnimatePresence` swap to a spring-scaled check circle, "You're in.", and a primary CTA to the Skool community at `skool.com/jalla-community-1888/about`.

## `/pricing` — Public Pricing
[routes/pricing.tsx](src/app/routes/pricing.tsx)

Own nav (logo + EN|FR toggle + "Log in" + "Get started") and own footer (Home / Community links). Calls `useForceLight()`.

**Hero** — eyebrow "Simple, transparent pricing", H1 "Build with confidence. / Pay only when work is done."

**Three plan cards** (`md:grid-cols-3`), each with staggered entry animation and a full 9-item feature list where excluded items render struck-through with a hollow circle:

| Plan | Price | Tagline | Key features |
|---|---|---|---|
| **Self Verify** (`BadgeCheck`) | Free | "For hands-on homeowners who want full control." | 3 projects, self-approve stages, evidence upload, document vault, project chat, 1 contractor per project |
| **Jalla Verify** (`ShieldCheck`) — *highlighted, "Most popular" ribbon* | **$199 / mo** | "Independent verification on every stage" | Unlimited projects, Jalla-verified stages, unlimited contractors, priority support |
| **Jalla Management** (`Briefcase`) | Custom | "Full-service. Jalla manages your project end-to-end." | Dedicated PM, on-site representation, procurement oversight, custom reporting, white-glove onboarding |

CTAs: first two → `/auth/signup`; Management → `mailto:hello@tryjalla.com`.

**FAQ** — 4 plain Q&As (no accordion): what "Jalla-verified" means, upgrading from Self Verify, data retention (90 days after cancellation), international coverage.

**Bottom CTA** — dark rounded panel, "Ready to track your build?" → `/auth/signup`.

## `/verify/:id` — Public Certificate Verification
[routes/verify.tsx](src/app/routes/verify.tsx)

The only page designed to be opened by a **third party** (bank, buyer, family member) with no account. Fetches via `getCertificate(id)` from the `certificates` table.

- **Nav** — logo + "Back to Groundwork"
- **Three states**: spinner → `NotFound` → `CertificateCard`
- **`NotFound`** — grey `XCircle`, "Certificate not found", explains the ID may be invalid, expired, or the link truncated
- **`CertificateCard`** — `CheckCircle2` + "VERIFIED" eyebrow + "Certificate of Stage Completion". Card has a black header band reading "Groundwork by Jalla · Verified Construction Record", then five labelled fields: **Issued to**, **Project**, **Stage completed** (`Stage {n}: {name}`), **Date issued** (long-form en-GB), **Certificate ID** (monospace, breakable). A "Download Certificate PDF" button appears only when `pdf_url` is set.
- **Footer** — states the canonical verification URL: `tryjalla.com/verify/{id}`

---

# 2. Auth Routes — inside `_auth-layout.tsx`

## The Auth Layout
[routes/_auth-layout.tsx](src/app/routes/_auth-layout.tsx)

`h-dvh overflow-hidden`, `flex-col` on mobile → `flex-row` on desktop.

**Left panel** — `bg-brand-near-black`. On desktop it's a full 50% panel containing `ArchDrawing`: a 420×520 SVG technical drawing with a two-level grid pattern, a **floor plan** (labelled BEDROOM / LIVING / DINING / KITCHEN / BATH in monospace, with door arcs and window breaks), a **section cut line** marked A-A, a **north arrow**, an **elevation** (roof gable, three mullioned windows, door with swing arc), **dimension lines** reading 12 000 and 8 500, and a drawing border with a title block: `SITE PLAN + ELEVATION — SCALE 1:100` / `GW-01`. A radial vignette darkens the edges. Logo animates in top-left; tagline *"Protect your build. From anywhere."* sits bottom-right in italic.

On **mobile** the whole left panel collapses to a compact inline header bar — drawing, vignette, and tagline are all hidden.

**Right panel** — white, scrollable, `max-w-sm` centred form slot with an **EN|FR toggle and a `ThemeToggle`** pinned top-right. Content fades and slides up on mount.

## `/auth/login`
[routes/auth/login.tsx](src/app/routes/auth/login.tsx)

H1 "Log in" / "Welcome back. Pick up where you left off."

- Email + password fields; "Forgot password?" link sits inline with the password label
- Error banner animates in on `bg-brand-light-grey`
- "OR" divider → **Continue with Google** (`signInWithOAuth`, redirect `/auth/callback`)
- Footer link to signup

**Post-login routing logic** ([login.tsx:40-54](src/app/routes/auth/login.tsx#L40-L54)) — reads a pending invite token from either the `?invite=` param **or** `localStorage.pendingInvite`. If found, calls `acceptInvite(token)` and lands the user directly on `/projects/{id}`; a failed invite silently falls through. Otherwise: `onboarding_complete` metadata decides `/onboarding` vs `/dashboard`.

## `/auth/signup`
[routes/auth/signup.tsx](src/app/routes/auth/signup.tsx)

Two modes, switched by the presence of `?invite=`:

**Normal mode** — H1 "Sign up", subtitle "Join the diaspora builders who never lost track of their money." Google OAuth offered.

**Invite mode** — H1 "Create your account", subtitle "Set a password to accept your project invite." The email field becomes **read-only with a lock icon**, prefilled from `?email=`. Google OAuth is hidden (the email must match the invite). The "Log in" footer link carries the invite token forward.

**Fields** — Full name, Email, Password, Confirm password.

**Live password checklist** appears once typing starts, each item switching between `Check` and `X`: at least 8 characters · one uppercase letter · one number. Submit is blocked on failure and on mismatch, with distinct inline messages.

The invite token is written to `localStorage.pendingInvite` **before** `signUp` so it survives the user opening the confirmation email in a different tab.

**Two success paths** — if `data.session` exists (email confirmation disabled) it hard-navigates to `/auth/callback`; otherwise it renders the **"Check your email"** state with a `Mail` icon, the target address, and — in invite mode — an extra line promising direct delivery to the assigned project.

## `/auth/reset-password`
[routes/auth/reset-password.tsx](src/app/routes/auth/reset-password.tsx)

H1 "Reset password" / "We'll email you a link to get back in." Single email field → `resetPasswordForEmail` with `redirectTo: /auth/callback`. On success, swaps to a "Check your email" panel with the address echoed back and a "Back to login" link.

## `/auth/callback`
[routes/auth/callback.tsx](src/app/routes/auth/callback.tsx)

Not a visual page — a **routing hub**. Renders only "Signing you in…" or an error panel.

Logic:
1. Read `?code` from the URL. If present → `exchangeCodeForSession(code)`
2. Check `localStorage.pendingInvite` → `acceptInvite` → `/projects/{id}`
3. Else read `onboarding_complete`; if new, fire `trackEvent('signup_complete')` → `/onboarding`, else `/dashboard`
4. No code at all → check for an existing session → `/dashboard` or `/auth/login`

Handles three separate inbound flows: email confirmation, Google OAuth return, and password-reset links.

## `/onboarding`
[routes/onboarding.tsx](src/app/routes/onboarding.tsx)

A **single screen** despite the name. Eyebrow "Account setup", H1 "Welcome, {firstName}." (name on its own line), copy "Let's get your account ready. It takes 30 seconds.", and one "Get started" button.

Redirects straight to `/dashboard` if `onboarding_complete` is already set.

Pressing the button writes `{ tier: 'self_verify', onboarding_complete: true }` to user metadata, fires `trackEvent('tier_selected')`, and navigates to the dashboard. **There is no plan-selection screen here** — the tier is silently defaulted to free, and the real plan choice happens later, at wizard Step 10.

## `/invite/:token`
[routes/invite.tsx](src/app/routes/invite.tsx)

Contractor invite landing page. Fetches `getInviteByToken(token)`.

**Four states:**
- **Loading** — centred spinner
- **Invalid** — grey `UserPlus` circle, "Invite not found", "This invite link is invalid or has already been used."
- **Already accepted** — green circle, "Invite already accepted", CTA to log in
- **Valid** — a project badge chip (`Building2` + truncated project name), H1 "You've been invited", the inviter's name and project in bold, the target email, and an explainer: *"As a contractor, you'll be able to upload progress evidence and message the project owner directly from the project dashboard."*

**CTA branches on auth state.** Logged in → shows "Logged in as {email}" and a single **Accept Invite** button that calls `acceptInvite` and jumps to the project. Logged out → **Create account** and **I already have an account**, both of which write the token to `localStorage` via `storeToken()` on click and carry it in the query string.

---

# 3. Project Creation Wizard

## `/projects/new`
[routes/projects/new.tsx](src/app/routes/projects/new.tsx)

Registered **outside** the sidebar layout so `WizardShell` owns the whole viewport. Guards on session (spinner, then redirect to login), then mounts `WizardProvider` → `WizardRouter`, which indexes a flat 10-element array of step components by `step - 1`.

### Wizard state — [contexts/WizardContext.tsx](src/contexts/WizardContext.tsx)

Holds `step`, `direction` ('forward' | 'back' — drives slide direction), `data` (`WizardFormData`), plus `constructionRate` and `rateLoading`. Exposes `update` (shallow patch), `next`, `back`, `goTo`, `reset`.

A `useEffect` watches `data.country` and refetches `getConstructionRate(country)` whenever it changes, with a `cancelled` flag to drop stale responses. `TOTAL_STEPS = 10`.

### Wizard chrome — [components/wizard/WizardShell.tsx](src/components/wizard/WizardShell.tsx)

Full-height two-pane frame reused by all 10 steps:

- **Header** — logo (links to `/dashboard`), mobile-only `ProgressBar`, the compact **`LanguageToggle`**, `ThemeToggle`, and a Back button that becomes "← Cancel" on step 1
- **Main** — `max-w-lg` centred, with `AnimatePresence mode="wait"` sliding steps ±32px horizontally based on `direction`
- **Footer** — right-aligned Continue button; label, disabled state, and spinner are all controlled by props (`canContinue`, `continueLabel`, `isSubmitting`, `hideContinue`)
- **Right aside (desktop only, 50%)** — `ProgressBar` over a live [`BuildingPreview`](src/components/wizard/BuildingPreview.tsx) (1,149 lines) that redraws the building as answers change

### The 10 steps

| # | File | Question | Interaction |
|---|---|---|---|
| 1 | `Step1Country` | "Where will you be building?" | Search input filtering all **24 countries** by name or code (top 8 results, flag + name + code). With an empty query it shows an 8-tile **Popular** grid (CM, NG, GH, KE, ZA, UG, TZ, ET) with a "Recommended" ribbon on flagged entries. Selecting shows a confirmation chip with a "Change" reset. |
| 2 | `Step2ProjectType` | "What are you building?" | 2×2 `StepCard` grid — Residential / Commercial / Industrial / Mixed Use, each with a bespoke hand-drawn inline SVG. **Changing the type resets `buildingType` to null.** |
| 3 | `Step3BuildingType` | Heading varies by type ("What type of residential building?" etc.) | 2×2 grid whose options come from a `Record<ProjectType, BuildingOption[]>` map — 16 building types total, each with its own SVG. Residential: Single Family / Multi-Family / Townhouse / Semi-Detached. Commercial: Office / Retail / Warehouse / Hotel. Industrial: Factory / Warehouse / Industrial Complex / Distribution. Mixed: Res+Commercial / Live-Work / Retail+Residential / Transit-Oriented. |
| 4 | `Step4Floors` | "How many floors?" | Animated `FloorStack` bar visual (caps display at 8) plus a large −/+ stepper with a spring-flipping digit. Clamped 1–20. **Resets `floorRooms: []`** so Step 5 rebuilds its tabs. |
| 5 | `Step5Rooms` | "Rooms per floor" | Horizontal floor tabs (GF, F1, F2…). Per active floor: four `Stepper` rows — Bedrooms (0–20), Bathrooms (0–20), Living Areas (0–5), Kitchens (0–5). Re-initialises when the floor count changes and preserves existing per-floor data. Writes both `floorRooms` and computed cross-floor totals. Multi-floor projects get a totals chip row. Switching tabs also drives `previewActiveFloor` in the right-hand preview. |
| 6 | `Step6BoysQuarters` | "Will there be a boys' quarters?" | Yes/No pill toggle with an explainer of what a BQ is. "Yes" reveals (height-animated) a 1–6 room `Stepper` labelled "Each room includes a bathroom", plus the cost hint *"Adds ~$8,000 per room"*. |
| 7 | `Step7RoofType` | "What roof type do you prefer?" | 2×2 SVG grid with a **cost-delta badge** on each card: Long Span Aluminum ("Base cost", noted as most common in West Africa) · Clay Tiles (+5%) · Concrete/Flat (+3%) · Shingle (+4%). |
| 8 | `Step8Details` | "Tell us about your project" | Project name (min 2 chars, required), City/location (min 2 chars, required, placeholder derived from the chosen country), optional floor area in sqm, finish level, optional target start date. **Contains the smart sqm estimator** — see below. |
| 9 | `Step9Summary` | "Your project at a glance" | Read-only review. See below. |
| 10 | `Step10PlanSelection` | "Choose your plan" | Three `TierCard`s (Self Verify free / Jalla Verify $199-mo, "Most popular" / Jalla Management custom) with a selected-plan confirmation strip. **Continue reads "Create Project"** and calls `calculateBudget` → `createProject(user.id, data, budget)` → `reset()` → navigate to `/projects/{id}`. Errors surface inline and re-enable the button. |

**Step 8's sqm estimator** ([Step8Details.tsx:30-67](src/components/wizard/steps/Step8Details.tsx#L30-L67)) — aggregates room counts across floors, applies benchmark areas (bed 14 m², bath 5.5, living 26, kitchen 13), multiplies by **1.22 for circulation** (corridors, landings, stairs, wall thickness), then applies a building-type multiplier (multi-family 0.88 · townhouse 0.92 · semi-detached 0.95 · office 1.40 · retail 1.20). Produces a typical figure rounded to 5 m², plus a −20% / +30% range and a natural-language label like *"4-bedroom 2-storey house"*. Renders as a `Lightbulb` hint card with a range bar, a typical-value marker, a live indicator of the user's own entry, and a one-click **"Use {n} sqm as my estimate"**.

**Step 9's three blocks:**
1. **Summary grid** — five labelled rows: Location · Type (project · building) · Scale (floors · sqm · beds · baths · BQ count) · Roof · Finish
2. **`BudgetBreakdownCard`** — the headline USD total plus local-currency approximation, and per-trade bars with percentages, animated in sequence. Carries a **data-provenance badge**: green *"Verified data"* when `dataSource === 'real_bq'` ("Based on real BQ data for this country"), amber *"Regional estimate"* otherwise ("Indexed from comparable markets — no verified BQ yet"). Closes with a disclaimer urging confirmation by a certified quantity surveyor. Has its own skeleton for `rateLoading`.
3. **Predicted Build Timeline** — derived from `PREDICTED_DAYS = 196`: estimated start, projected completion, total duration (~196 days / 7 months), plus a caveat about contractor pace, weather, approvals, and material availability.

---

# 4. Protected App — inside `_layout.tsx`

## The Protected Layout
[routes/_layout.tsx](src/app/routes/_layout.tsx)

Guards on session — spinner while loading, `navigate('/auth/login')` when absent.

**Sidebar (`w-56`)** — logo, then 8 nav items:

`/dashboard` Dashboard · `/projects` My Projects · `/documents` Documents · `/resources` Resources · `/contractors` Contractors · `/payments` Payments · `/notifications` Notifications · `/profile` **Settings**

(Note the label/route mismatch: the nav item reads "Settings" but points at `/profile`.)

`/upgrade` is registered inside this layout but **has no sidebar entry** — it is reached only by direct link or an in-app CTA.

Active items get `bg-brand-near-black text-white`. Footer holds a profile link with generated initials, the **`LanguageToggle`**, the `ThemeToggle`, and Log out.

**Mobile** — the sidebar becomes a spring-animated drawer behind a scrim, opened by a hamburger in the top bar.

**Top bar (`h-14`)** — hamburger + logo on mobile, the translated page title on desktop (resolved by `getPageTitleKey(pathname)` → `t()`); right side has the compact **`LanguageToggle`**, `ThemeToggle`, `NotificationBell`, and an initials avatar linking to `/profile`.

**Mobile bottom tab bar** — first 5 nav items only, with "My Projects" relabelled to just "Projects" and a thicker stroke on the active icon.

## `/dashboard`
[routes/dashboard.tsx](src/app/routes/dashboard.tsx) — ~1,100 lines, the densest page in the app

**Data** — `fetchProjects(user.id)`, or `fetchContractorProjects(user.id)` when `user_metadata.role === 'contractor'`. Once projects load, a follow-up query sums `payment_milestone_usd` across all stages with `payment_status = 'paid'` to produce **Total Paid**. A separate effect fetches `project_stages` for the single "active project", chosen as the most recently updated `status === 'active'` project, falling back to `projects[0]`.

Sections top to bottom:

1. **Page header** — a plain "Dashboard" title with the subtitle "Welcome back — your build, verified and protected." A **New Project** button appears only for non-contractors below the Starter limit. *(This replaced the earlier time-aware greeting hero with the blueprint-grid overlay.)*

2. **`ProfileCompletion`** — 4-item checklist (Account created / Display name set / ID uploaded / First project created) with a percentage and bar. **Auto-hides at 100%.** Done items render struck-through.

3. **`JourneyCard`** — lifecycle guidance choosing one of several states from project count and completed-stage count, each with a status pill, a headline, a one-line instruction, and a labelled CTA: *Planning* ("Let's get building" → Create project) → *Onboarding* ("Almost there" → Open projects) → and on through the active build states.

4. **Stat row** (`lg:grid-cols-4`) — Projects (accent/inverted card) · Total Budget · **Total Paid** (with outstanding remainder, or "No payments yet") · Stages Done (`x/y` + percentage).

5. **Two-column grid** (`lg:grid-cols-5`):
   - **Left (3 cols) — `StageProgressPanel`**: merges stage progress *and* payment schedule. Header has an on-track/complete/not-started pill and names the current stage. A 3-cell strip shows **Spent / Active / Remaining** in dollars derived from each stage's `budget_pct` against the project total. Then one row per stage with a status circle (green check / blue `CircleDot` / amber for review / lock icon), name (struck-through when done), dollar allocation, a budget-share bar, the percentage, and a status badge. Has a 6-row skeleton.
   - **Right (2 cols)** — **`CostingDonut`**, now split by **cost category rather than payment state**: Materials 41% (blue, "Cement, blocks, rebar, fittings") · Professional Fees 34% (amber, "Architects, engineers, project mgmt") · Labor 23% (green, "Site workers + supervision") · Permits 2% (near-black). Leads with "Your biggest cost is **Materials** at 41% of total budget." Below it, **`NewsfeedCard`** — "Platform Updates" with **three hardcoded feed items**.

   `VelocityChart` still exists in the file (a hand-rolled SVG area+line chart of stage completions over time) but is no longer placed in the main column.

6. **Empty-state variant** — when there are no projects at all, the analytics block is replaced by three how-it-works cards: Create a build / Add your contractor / Approve stages.

7. **Recent Projects** — up to 4 `ProjectCard`s (`xl:grid-cols-4`) with "View all →". Each card: tier chip, status pill with coloured dot, name, building type + location, stage progress bar, estimated budget, and an "Open" affordance. Loading shows 3 skeletons; empty shows **`EmptyBuilds`**, a dashed dropzone-style panel with a floating `HardHat` (infinite 2.8s y-oscillation) and a "Create a build" CTA. Contractors get a plain "No assigned builds yet" note instead.

## `/projects`
[routes/projects/index.tsx](src/app/routes/projects/index.tsx)

Header "My Builds" + total count, and a "New Build" button (hidden for contractors and at the Starter cap).

- **Starter limit banner** — shows `{n} / 3 Self Verify projects used`; turns amber with "— limit reached" and an "Upgrade to Jalla Verify" nudge at the cap
- **Filter pills** — All / Active / On Hold / Complete, each with a live count
- **Card grid** — same `ProjectCard` design as the dashboard (tier chip, status pill, building type, location, `Stage {done} of 10` bar, budget). A dashed **"New Build"** tile is appended as the last grid cell
- **Empty state** — the floating-`HardHat` panel; contractors instead get "No builds in this category yet."

## `/projects/:id` — Project Detail
[routes/projects/detail.tsx](src/app/routes/projects/detail.tsx) — the deepest page in the app

**Data** — three parallel fetches: `fetchProject`, `fetchProjectStages`, `fetchProjectSubstages`. Error → "Project not found." with a link back.

**Chrome** — breadcrumb nav (`← Dashboard / {project name}`), then a header with an eyebrow (`{building type} · {country}`), the project name, a meta line (beds · floors · roof type), a lifecycle pill, the tier badge, and the completion percentage.

### ⚠️ The pre-tracking gate

A project now has **two lifecycle states**, keyed off `project.tracking_started_at` ([migration 018](supabase/migrations/018_project_tracking.sql)):

| State | `tracking_started_at` | Header pill | Body |
|---|---|---|---|
| **Planning** | `NULL` | amber | `StartTrackingGate` — **the entire tab bar is hidden** |
| **Tracking** | timestamp | green "Live" | the 7-tab interface below |

**`StartTrackingGate`** ([src/components/project/StartTrackingGate.tsx](src/components/project/StartTrackingGate.tsx)) is a single centred card, "Confirm your budget to start tracking", explaining that the wizard figure was only a planning estimate and the owner should now enter the budget actually agreed with their contractor. It contains:
- The **wizard estimate**, read-only, in a muted panel
- A **final budget** input with a `$` prefix and live thousands-separator formatting
- A **side-by-side comparison** that animates open only when the figure differs — struck-through estimate vs bordered final, plus an amber (higher) or green (lower) delta strip showing the absolute and percentage difference
- An **optional contractor quote upload** (PDF/JPG/PNG) filed straight into the documents vault under the `contract` category
- A footer warning that confirming **activates Stage 1 and locks in the payment schedule**

Confirming calls the `start_project_tracking` RPC, which is owner-guarded, idempotent, and `SECURITY INVOKER` so RLS still applies. In one transaction it writes the confirmed budget, stamps `tracking_started_at`, **re-derives every stage's `payment_milestone_usd` from the confirmed figure**, flips stage 1 to `active`, and promotes stage 1's substages from `locked` to `pending` so evidence upload can begin. Existing projects were grandfathered to their `created_at`, so nobody sees this gate retroactively.

**Tabs (only once tracking has started) are role-dependent:**
- **Owner** — Overview · Stages · Costing · Timeline · Payments · Documents · Messages
- **Contractor** — Stages · Messages only

Mutations are handled optimistically in the page and passed down as callbacks. `renderEvidenceUpload` is a **render prop** used specifically to hand `EvidenceUpload` down to `SubstageRow` without a circular import ([detail.tsx:198-220](src/app/routes/projects/detail.tsx#L198-L220)).

Every tab except Overview appends a `<RelatedGuides tab="…" />` block.

### Tab: Overview — [OverviewTab.tsx](src/components/project/OverviewTab.tsx) (1,102 lines)

Two columns (`lg:grid-cols-[1fr_300px]`).

**Left:**
- **4 stat cards** — Days Active (since creation) · Complete (%, `x of y` stages) · Now (In Progress / Complete / Starting, with the stage name) · Next Milestone (dollar amount + start date)
- **`BudgetDonut`** — colourful allocation donut with a "how is this calculated?" trigger
- **`PaymentBar`** — horizontal paid-vs-outstanding bar with an axis
- **Stage Progress** — a percentage bar, then a **10-circle grid** (`grid-cols-5`) where complete = filled + check, active = pulsing dot (`opacity` keyframe loop), pending_review = amber `AlertCircle`, locked = padlock; then a full per-stage list with status words (Done / In Progress / In Review / Locked)
- `RelatedGuides`

**Right sidebar:**
- **`LatestFromSite`** — most recent evidence images; **renders nothing at all when there are no images** (deliberately no placeholder)
- Compact 10-circle stage tracker (repeat, smaller)
- **`WeatherWidget`** — live conditions for the build country
- Days-active card
- **Predicted Timeline** — Start / Projected end / Days remaining (turns red and reads "Overdue" at 0) / Total duration ~196 days
- Build location card with country flag

**Three explainer modals** (`AnimatePresence`) exist purely to justify the numbers: `BudgetBreakdownModal` (step-by-step with numbered `StepBadge`s and `FormulaBox`es), `PaymentBreakdownModal`, and `StageProgressModal`.

### Tab: Stages — [StageTracker.tsx](src/components/project/StageTracker.tsx)

For owners, a `ContractorInvite` panel sits above the tracker.

**Header** — "Construction Pipeline" + `{done} / {total} complete`.

**Horizontal scrollable pipeline** — one node per stage with connector lines. `StageCircle` renders three ways: complete (filled black + check), active/pending_review (filled black + number + an `animate-ping` halo), locked (hollow, grey border). Labels are truncated to two words / 13 chars by `shortLabel`. **Completed stages get a "Certificate" download button** underneath.

**Selected stage detail** — stage number, name, dollar milestone + budget percentage, status badge. Locked stages just say "Complete the previous stage to unlock this one." Otherwise a divided list of `SubstageRow`s, each with evidence upload and a mark-complete action.

**The approve button is tier-gated.** It shows only when: not a contractor, stage is `active`, all substages are ready (`complete` on Self Verify; `pending_review` or `complete` on Jalla tiers), and tier isn't `jalla_management`/`enterprise`. Label and confirm copy switch accordingly:
- **Self Verify** → "Approve Stage {n}" / *"This will mark the stage complete, release the milestone payment, and unlock the next stage."*
- **Jalla Verify** → "Request Verification" / *"This will submit all your evidence for Jalla review."*
- **Jalla Management** → no button; instead *"This stage is managed by Jalla. Progress will be updated by your project manager."*

`StageCertificateModal` is `lazy()`-loaded so the certificate HTML stays out of the main bundle.

### Tab: Costing — [BudgetView.tsx](src/components/project/BudgetView.tsx)

Five stacked sections:
1. **Budget Estimate card** — the total in 3xl black type, an "USD · indicative" note, a **PDF export button** (`exportBudgetPDF` via jsPDF), animated per-trade `OverviewBar`s, and a disclaimer
2. **2×2 metric grid** — Total Budget / Released / Held / Remaining (dimmed at zero)
3. **Per-floor cost distribution** — rendered **only for multi-floor projects**; `computeFloorCosts` splits the total across floors and `roomSummary` describes each floor's rooms
4. **Stage Breakdown** — one `StageBar` per stage
5. **Payment Timeline** — vertical dot-and-connector timeline; connector turns green behind completed stages. Each entry is colour-coded by state: green *"released"* (with completion date), blue *"held · in progress"*, amber *"awaiting approval"*, grey *"locked"*

### Tab: Timeline — [TimelineTab.tsx](src/components/project/TimelineTab.tsx)

"Project Timeline" with **two switchable views**: `ListView` and `GanttView`. `computeTimeline` derives per-stage start/end dates from the project start plus per-stage durations. Status pills and month/year headers throughout.

### Tab: Payments — [ProjectPayments.tsx](src/components/project/ProjectPayments.tsx)

> Replaces the older `PaymentsTab`, which still exists in the tree but is **no longer rendered by `detail.tsx`**.

A two-view container with a segmented **Wallet | History** switch and an "Upgrade plan →" link to `/upgrade` (hidden on `jalla_management`). It loads the country FX rate and looks up the accepted contractor's email from `contractor_invites` to label the payee. Tier is passed through `normalizeTier()` so legacy `starter`/`pro`/`enterprise` rows still resolve.

**`EscrowWallet`** — the default view:
- A **dark escrow hero** showing funds held (`total − released`), the count of remaining stages, and a **segmented allocation bar** where each stage is a slice weighted by `budget_pct` and coloured by fund state — Released (green) · In Transit (blue) · Held (amber) · Locked (grey) — with a legend
- Two summary cards: **Total project** and **Released** (with % of total)
- A **stage list** where each row is one of: a **Pay** button (only when the stage is active and unpaid), a clickable Released/Transit badge that opens the payout tracker, or an inert Locked badge

**`PaymentHistory`** — a vertical timeline of paid and in-transit stages with coloured node dots, per-stage amount, the platform fee, the completion date, the payout rail, and a "View payout →" affordance.

**`MilestonePaymentModal`** — a two-panel modal. The dark left panel renders the **money flow as three chained steps**: *You pay* (stage amount + platform fee) → *Platform holds* (in escrow) → *Contractor gets* (converted to local currency). The right panel carries the confirm action.

**`PayoutStatusModal`** — a **5-node payout tracker** (Received → Fee Split → Payout Sent → Converting → Delivered) that fills to node 3 while in transit and completes when paid, over a details table: contractor, phone, method, amount sent, amount received, exchange rate, date. Has a "Download Receipt" button.

All four carry preview disclaimers — see [Payments status](#payments-status-stripe--switchr) below.

### Tab: Documents — [DocumentVault.tsx](src/components/project/DocumentVault.tsx)

Per-project file cabinet. **25 MB per-file cap.** Upload flow opens a `CategorySelectModal` to tag the file before it lands. Documents group into ordered categories with counts, filterable by category. Desktop renders table-style rows (`DesktopDocRow`), mobile renders cards (`MobileDocCard`); both offer download and a confirm-gated delete. Includes an upload `ProgressBar`, skeleton rows, and per-filter empty states.

### Tab: Messages — [ProjectChat.tsx](src/components/project/ProjectChat.tsx)

Realtime chat between owner and invited contractors. Fetches history on mount, then `subscribeToMessages(projectId, cb)` for live inserts. `MessageBubble` distinguishes own vs other messages and shows the sender name only when it changes between consecutive messages. Has a `MessageSkeleton` loading state.

## `/documents` — Cross-Project Document Hub
[routes/documents.tsx](src/app/routes/documents.tsx)

Distinct from a project's Documents tab: this aggregates across **all** builds. Header "Documents" / "Certificates and evidence across all your builds".

**Two tabs with live counts** in a segmented pill control:

**Certificates** — queries `certificates` for all owned project IDs. Each `CertCard` shows a black `Award` tile, a green "Verified" badge, `Stage {n}`, the stage name, the project name, "Issued to {name}", the issue date, and a **Download PDF** button plus an external-link button to `/verify/{id}`. When `pdf_url` is null the button becomes a disabled "PDF generating…". If the query errors, an amber banner reads *"Certificates table not yet set up. Apply migration 014 to enable this feature."*

**Evidence** — a two-hop query (`project_stages` → `project_substages`) that counts `evidence_urls` per stage. Renders a black summary banner ("N evidence files across M projects"), then one card per project with a header row and file/stage counts, and inside it one `EvidenceRow` per stage linking into the project. Stage names come from a **hardcoded 10-name array** in this file ([documents.tsx:206-210](src/app/routes/documents.tsx#L206-L210)): Land Secured, Design Completed, Site Preparation, Foundation, Structure & Walls, Roofing, Electrical & Plumbing, Finishing, Exterior Work, Final Handover.

Both tabs have dashed-border empty states explaining how the content gets created.

## `/resources` — Resource Library
[routes/resources.tsx](src/app/routes/resources.tsx)

Reads from the **static** [src/lib/resources-data.ts](src/lib/resources-data.ts) — **14 resources**, no database call.

**Two rows of filter pills**, both client-side:
- **Category** — All / Guides / Checklists / Legal & Finance / Videos (each mapped to an icon: `BookOpen`, `CheckSquare`, `Scale`, `Video`)
- **Stage** — All Stages plus only those stage numbers that actually have a resource

**Card grid** (`sm:grid-cols-2`) — title, an optional colour-coded tag (Popular blue / Essential inverted / New green / Important amber / "Start here" purple), description, then a footer with the category icon + name, a `Clock` + read time, and a hover `ArrowRight`.

**Empty state** — "No resources found / Try adjusting the filters above."

**Footer card** — "Missing something?" with a `mailto:hello@jalla.build` "Suggest a resource" button.

The 14 slugs: `how-to-read-a-bq`, `hiring-a-contractor`, `understanding-build-stages`, `diaspora-builders-checklist`, `site-visit-checklist`, `stage-approval-checklist`, `foundation-inspection-checklist`, `contractor-payment-template`, `title-deed-verification`, `building-permit-process`, `currency-transfer-tips`, `groundwork-walkthrough`, `reading-site-evidence`, `roof-types-explained`.

## `/resources/:slug` — Resource Article
[routes/resources.detail.tsx](src/app/routes/resources.detail.tsx)

Finds the resource in the static array by slug; renders a "Resource not found" panel with a back link if absent.

Layout is `lg:grid-cols-[1fr_272px]`:
- **Article** — "← Resources" back link, a badge row (tag + category-with-icon + read time), the title, an optional stage badge reading `Relevant: Stage {n} — {STAGE_NAMES[n]}`, a divider, then `resource.content` rendered as a simple array of paragraphs (no markdown parsing)
- **Sidebar** (sticky, only when related items exist) — "Related {category}" with up to 3 same-category links

## `/contractors` — Contractor Directory
[routes/contractors.tsx](src/app/routes/contractors.tsx)

Header "Contractor Directory" / "Verified professionals for your build". Queries `contractors` where `active = true`, ordered by `verified` then `rating` descending.

**Filter pills** — All / General Contractor / Engineer / Surveyor / Designer, matched by substring against the `trade` field.

**`ContractorCard`** — initials avatar, name, trade, a green "Verified" badge, location, `StarRating` (rating to one decimal + review count), a two-line bio clamp, and a stats row (years Experience / completed Projects).

**Tier gating is the point of this page** ([contractors.tsx:75-133](src/app/routes/contractors.tsx#L75-L133)). Plan comes from `user_metadata.tier`, coerced into `'starter' | 'pro' | 'enterprise'`:
- **Pro / Enterprise** — real phone, email, and a WhatsApp deep link (`wa.me/…`)
- **Starter** — fake contact chips rendered **`blur-sm`, `select-none`, `pointer-events-none`, `aria-hidden`**, with a black **"Unlock with Pro"** lock badge absolutely positioned over them

**`QuoteRequestDialog`** — a modal quote-request form (name, location, project description) with a submitted state.

**States** — 6 card skeletons while loading; an error panel; a "No contractors listed yet" empty state pointing at `/contractor-apply`; and a separate "No professionals in this category yet" for over-filtering. Footer note: "All listed professionals are screened by the Jalla team." Includes `BackToTop`.

> Note: this page still uses the **legacy** `starter`/`pro`/`enterprise` tier vocabulary, not `self_verify`/`jalla_verify`/`jalla_management`.

## `/payments` — Finances
[routes/payments.tsx](src/app/routes/payments.tsx)

Header "Finances" / "Budget overview across all your builds" with an **Export CSV** button (disabled when empty).

**Info banner** — *"Estimated spend is calculated based on completed stages. Actual payments via Stripe + Switchr are coming soon."*

**Three stat cards** — Total Budget (accent) / Est. Spent / Est. Remaining. Spend is **not real payment data** — it's `budget_usd × (completedStages / 10)`.

**Per-build breakdown** — one row per project: name (links to the project), location, total budget, a **Record** button, then "Est. spent: $X" with a "Z% used" figure over a nested double bar (outer width = this project's share of the largest budget, inner = spend within it).

**CSV export** is fully client-side ([payments.tsx:263-290](src/app/routes/payments.tsx#L263-L290)) — builds `Project,Location,Total Budget (USD),Est. Spent (USD),Completion %`, escapes commas by quoting, and triggers a Blob download named `groundwork-finances.csv`.

**`RecordPaymentModal`** — amount, method, note; labelled *"Coming soon — this records locally for your tracking."* Success fires a bottom-centred `Toast` that self-dismisses after 3s.

## `/upgrade` — Plan Selection

[routes/upgrade.tsx](src/app/routes/upgrade.tsx) → [components/payments/UpgradeScreen.tsx](src/components/payments/UpgradeScreen.tsx)

The route file is a 9-line wrapper; all the substance is in `UpgradeScreen`. Registered inside the protected sidebar layout, but **absent from the sidebar nav** — reached from the "Upgrade plan →" link on a project's Payments tab, or by direct URL. The layout's page title resolves to "Upgrade Plan".

**Dark hero** — "SELECT YOUR PLAN" eyebrow over "How do you want to build?", with a **3-way segmented toggle** (Self Verify · Jalla Verify · Management), each carrying its tier icon. Defaults to `jalla_verify`.

**Revealed plan card** — animates on every switch (`AnimatePresence` keyed on selection). Shows an optional "MOST POPULAR" sparkle tag, the price in 5xl black type with its period, the plan name and description, then a green-check feature list. The CTA is disabled and reads **"Your current plan"** when it matches the viewer's tier. Selecting Jalla Verify appends "Cancel anytime. Downgrade at end of billing period."

All copy, pricing, fees, and features come from **[src/lib/payments/config.ts](src/lib/payments/config.ts)** rather than being hardcoded — see below.

### The billing config

`TIER_BILLING` is the single source of truth for plan economics, deliberately decoupled from the already-approved public `/pricing` page so the two can diverge while numbers are still being settled:

| Tier | Price | Platform fee | Features shown |
|---|---|---|---|
| `self_verify` | Free | **10%** | 3 projects, 1 contractor, self-approve stages, 500MB storage |
| `jalla_verify` | $199/mo | **3%** | Unlimited projects & contractors, Jalla verification, stage certificates, weekly reports, community |
| `jalla_management` | Custom | negotiated (`null`) | Dedicated PM, on-site team, daily updates, procurement oversight, custom reporting |

Also exports `STRIPE_PROCESSING_PCT` (2.9%, display-only), `FALLBACK_FX` (XAF @ 600), `platformFee()`, `stripeProcessing()`, and `normalizeTier()` for legacy tier strings.

**`PAYMENTS_ARE_PREVIEW = true`** gates every disclaimer in the payments UI. The file's header comment states plainly that these numbers are placeholders pending confirmation.

## `/notifications`
[routes/notifications.tsx](src/app/routes/notifications.tsx)

Header shows "N unread" or "All caught up", plus a **Mark all read** button (bulk update where `read = false`).

**Filter tabs** — All / Unread / Projects / Payments / System.

**Realtime** — subscribes to a `notifications-realtime` channel filtered to `user_id=eq.{id}` on `INSERT`, prepending new rows live. Channel is removed on unmount.

**Rows** — a type icon in a circle (`stage_approved` green `BadgeCheck` · `evidence_uploaded` blue `Upload` · `message_received` purple `MessageSquare` · `project_created` grey `Building2` · `verification_requested` amber `AlertCircle`, defaulting to `Bell`), the title with an unread dot, the body, and a relative timestamp. **Unread rows have a tinted background**; clicking a row marks just that one read.

**Pagination** — initial `limit(50)`; a "Load older notifications" button appears once 50 are loaded (All filter only) and pages via `.range()`.

**States** — 4 skeleton rows; a dashed empty panel whose copy changes between "No notifications yet" (with an explanation of what triggers them) and "Nothing here" for an over-narrow filter.

## `/profile` — Settings
[routes/profile.tsx](src/app/routes/profile.tsx) — 1,006 lines

Reached from the sidebar item labelled **"Settings"**. Header is an initials avatar + display name + email. **Five tabs**, animated with `AnimatePresence`; the Danger tab's label turns red on hover and when active.

### Tab: Profile
- **`CompletionMeter`** — percentage plus a per-item checklist computed by `calcCompletion`
- **Account details** form — Display name (`User` icon), Phone number (`Phone`), Country (`Globe`), all with inset icons
- **ID verification** — upload a government-issued ID (passport, national ID, or driver's licence), **max 5 MB**. Shows an "ID uploaded" confirmation with a replace option, an `UploadBar` during transfer, and a dismissible error state

### Tab: Account
- **Email address** — read-only; *"Email changes coming soon"*
- **Password** — triggers a Supabase reset email
- **Two-factor authentication** — present but marked *"Coming soon"*

### Tab: Notifications
Five `ToggleSwitch` rows persisted to user metadata via an effect:
`stage_approvals` (When a stage is approved or rejected) · `evidence` (When evidence is uploaded to your project) · `messages` (When you receive a project message) · `payments` (When a payment milestone is due) · `announcements` (Product updates and new features)

### Tab: Subscription
"Your plan" with the current tier resolved for display, then three plan cards. The current plan is marked "Current plan"; the others show an "Upgrade →" link.

> This tab reads tier values `'free'`, `'jalla_verified'`, and `'enterprise'` ([profile.tsx:414](src/app/routes/profile.tsx#L414), 800–910) — a **third** naming scheme, matching neither `ProjectTier` nor the `starter`/`pro` legacy set used on `/contractors`.

### Tab: Danger
- **Export your data** — `handleDataExport`
- **Delete account** — two-step: reveals a confirm box requiring the user to type **`DELETE`** before the red destructive button enables

## `/help` — Help & Support
[routes/help.tsx](src/app/routes/help.tsx)

H1 "Help & Support" / "Everything you need to build with confidence".

**Quick actions grid** (`md:grid-cols-4`):
| Icon | Card | Action |
|---|---|---|
| `PlayCircle` | Video Walkthroughs | External link (currently a bare `youtube.com` URL) |
| `CalendarDays` | Book a Call — "Schedule a 30-min onboarding session" | `mailto:hello@groundwork.build` |
| `Users` | Join Community | → `/community` |
| `Mail` | Contact Support — "we'll respond within 24h" | Smooth-scrolls to the form via a ref |

**FAQ accordion** — **15 questions across 3 headed sections**, with a single-open accordion driven by a flat global index computed from per-section offsets:
- *Getting Started* — creating a first project · supported countries · data privacy · mobile use · inviting a contractor
- *Plans & Billing* — the plan tiers · Jalla Verification cost · free plan · when Stripe arrives · what Switchr is
- *Verification & Stages* — how stage verification works · what evidence to upload · what happens on rejection · completing stages out of order · what a Stage Completion Certificate is

**Contact form** — "Send us a message / We typically respond within 24 hours on business days." Fields: name, email (prefilled from the session), subject, message.

> Two different support addresses appear across the app: `hello@groundwork.build` here, `hello@jalla.build` on `/resources`, and `hello@tryjalla.com` on `/pricing`.

---

# 5. Free Public Tools — inside `tools/_tools-layout.tsx`

Ungated lead-generation tools. No auth, no sidebar.

## The Tools Layout
[routes/tools/_tools-layout.tsx](src/app/routes/tools/_tools-layout.tsx)

Slim sticky `backdrop-blur` header: logo → `/` , a `/` separator, then "Free Tools" → `/tools`. Right side has a "Sign in" link (hidden on mobile), the segmented **EN|FR toggle**, and the `ThemeToggle`. Footer reads "Groundwork by Jalla · Free planning tools for African construction" with Tools / Pricing / Create account links.

## `/tools`
[routes/tools/index.tsx](src/app/routes/tools/index.tsx)

Hero: "Free Planning Tools" eyebrow, H1 "Build smarter, / before you break ground.", subtitle "Four free tools for African homebuilders. No account required — just open and use."

Four cards (`sm:grid-cols-2`), each with an icon tile, title, description, and a CTA whose gap widens on hover:
1. **Build Budget Calculator** → "Calculate cost"
2. **Construction Stage Planner** → "View stages"
3. **Payment Milestone Generator** → "Generate plan"
4. **DIY Project Tracker** → "Start tracking"

Closing CTA strip: "Want the full picture?" → `/auth/signup`.

## `/tools/budget` — Build Budget Calculator
[routes/tools/budget.tsx](src/app/routes/tools/budget.tsx)

Two-column (`lg:grid-cols-[1fr_360px]`).

**Left — inputs:** Country `<select>` (all 24 with flags) · Floor Area with a **linked range slider + number input** (30–1000 sqm, step 10, clamped both ways) · Floors `Stepper` (1–10) · Finish Level as three radio-style cards that invert to solid black when selected.

**Right — sticky result panel:** the total in 4xl black type, a context line (`{sqm} sqm · {n} floors · {finish}`), then one bar per budget slice with its label, proportional fill, and dollar figure. Disclaimer: "Indicative only. Actual costs vary by site, contractor, and local market." Below it a conversion card → `/auth/signup`.

## `/tools/stages` — Construction Stage Planner
[routes/tools/stages.tsx](src/app/routes/tools/stages.tsx)

Reads the canonical pipeline via `getStageSeed('residential', 'single_family', 1)`.

- **Proportional summary bar** — 10 segments whose widths are each stage's `budget_pct`, with a `title` tooltip and hover opacity
- **Accordion list** (stage 1 open by default) — numbered badge that inverts when open, stage name, duration from `STAGE_DAYS = [14, 21, 7, 14, 70, 14, 14, 21, 14, 7]` (note stage 5 dominates at 70 days), and expandable substages plus a payment note from `PAYMENT_NOTE` ("Pay before work begins" → "Pay on handover")

## `/tools/milestones` — Payment Milestone Generator
[routes/tools/milestones.tsx](src/app/routes/tools/milestones.tsx)

**Inputs** — Total Budget in USD (10,000–5,000,000, step 1,000, default 100,000) and Country.

Splits the budget across the 10 stages by `budget_pct`, attaching each stage's duration and a `WHEN_TO_PAY` string ("Before work begins" · "On foundation completion" · … · "On final handover").

**Print-optimised** — `print:hidden` on the header and inputs, `print:px-0 print:py-4` on the container, and a `window.print()` button, so the generated schedule can be handed to a contractor on paper.

## `/tools/tracker` — DIY Project Tracker
[routes/tools/tracker.tsx](src/app/routes/tools/tracker.tsx)

An **offline, account-free** tracker. State (`projectName`, `startDate`, per-stage `notes`, per-substage `checked`) persists to `localStorage` under `gw_tracker`, hydrated in an effect so it stays SSR-safe and saved on every change.

- Project meta inputs (name, start date)
- Overall progress from `totalChecked / TOTAL_SUBSTAGES` across every substage of all 10 stages
- Accordion per stage with checkboxes for each substage and a free-text notes textarea
- **Reset** button behind a `window.confirm`
- Print-friendly, same `print:` treatment as the milestones tool

---

# 6. Admin Panel — inside `admin/_admin-layout.tsx`

## The Admin Layout
[routes/admin/_admin-layout.tsx](src/app/routes/admin/_admin-layout.tsx)

**Double-guarded**: no session → `/auth/login`; session but `user_metadata.role !== 'admin'` → `/dashboard`. Renders a spinner until both checks pass, so non-admins never see a frame of admin UI.

Its own `w-56` sidebar (logo with a small "Admin" subtitle) with 5 links — Overview · Reviews · Projects · Users · Contractors — plus a footer showing the admin's name, the **`LanguageToggle`**, and a log-out button. No mobile drawer; this panel is desktop-oriented.

## `/admin` — Overview
[routes/admin/index.tsx](src/app/routes/admin/index.tsx)

Four clickable `StatCard`s, each a link into the matching section, populated by parallel `count: 'exact', head: true` queries:

| Card | Query | Colour |
|---|---|---|
| Total Projects | `projects` count | blue |
| Pending Reviews | `project_stages` where `status = 'pending_review'` | amber when > 0, grey otherwise |
| Total Users | `profiles` count | green |
| Pending Contractors | `contractors` where `status = 'pending'` | purple when > 0 |

The contractors query is wrapped in `try/catch` with the comment *"contractors table may not exist"*, so the page degrades rather than crashing.

## `/admin/reviews` — Stage Review Queue
[routes/admin/reviews.tsx](src/app/routes/admin/reviews.tsx) — the operational heart of the Jalla Verify tier

Lists stages in `pending_review`, each carrying its project name, owner name and email, submission time, and its substages with evidence.

- **`EvidenceGrid`** — renders each evidence URL as an "Evidence {n}" external link; falls back to "No evidence uploaded"
- **Approve** → `adminApproveStage`, behind a `ConfirmModal`
- **Request changes** → `ReworkModal`, a textarea ("Describe the required changes...") whose Send button stays disabled until non-empty; calls `adminRequestRework`. Copy: *"Explain what needs to be corrected. The homeowner will be notified."*

## `/admin/projects` — All Projects
[routes/admin/projects.tsx](src/app/routes/admin/projects.tsx)

Header with a total count and a search box filtering on project name, owner email, or owner name.

Table columns: **Project · Owner** (name with email as `title`) **· Tier** (mapped through `TIER_LABELS`, which handles both naming schemes) **· Status** (coloured pill, underscores replaced with spaces) **· Stage** (`{current} / 10`) **· Created** · and an external-link icon opening `/projects/{id}` in a new tab.

Empty result shows `No projects match "{query}"`.

## `/admin/users` — All Users
[routes/admin/users.tsx](src/app/routes/admin/users.tsx)

Reads `profiles` ordered newest first. Search filters on email or full name.

Columns: **Name · Email · Role** (coloured pill — admin purple, contractor blue, homeowner green, defaulting to homeowner) **· Plan** (via `TIER_LABELS`, again dual-vocabulary) **· Joined ·** truncated 8-char monospace user ID.

## `/admin/contractors` — Contractor Applications
[routes/admin/contractors.tsx](src/app/routes/admin/contractors.tsx)

Header shows "{n} pending · {m} total". Search filters on name, email, or trade.

The list is **split into pending and everything else** so the actionable queue sits on top. Rows carry name, email, trade, years of experience, city, country, and a status pill (pending amber / approved green / rejected grey).

**Approve** and **Reject** write `status` straight back to the `contractors` table and update local state optimistically, with a per-row `actioning` lock preventing double-submits.

---

# Appendix: Cross-Cutting Notes

**Auth** — [contexts/AuthContext.tsx](src/contexts/AuthContext.tsx) exposes `{ user, session, loading, signOut }`. Every guard follows the same shape: wait on `loading`, then redirect. Roles live in `user_metadata.role` (`admin` / `contractor` / default homeowner) and tier in `user_metadata.tier`.

**Contractor view** — not a separate route tree. `/dashboard`, `/projects`, `/payments`, and `/projects/:id` all branch internally on `role === 'contractor'`, swapping the data loader to `fetchContractorProjects` and hiding creation actions. On `/projects/:id` it also cuts the tab bar from 7 tabs to 2.

**Tier vocabulary is inconsistent across pages.** Four sets are live simultaneously:
- `ProjectTier` type + wizard + project pages: `self_verify` / `jalla_verify` / `jalla_management`
- Legacy DB values still defensively handled: `starter` / `pro` / `enterprise`
- `/contractors`: only `starter` / `pro` / `enterprise`
- `/profile` Subscription tab: `free` / `jalla_verified` / `enterprise`

**Constants duplicated across files** rather than centralised: `TOTAL_STAGES = 10`, `STARTER_LIMIT = 3`, `PREDICTED_DAYS = 196`, `STAGE_DAYS`, and the `BT_LABELS` / `TIER_META` / `STATUS_META` maps (each re-declared in dashboard, projects index, and project detail).

**Design system** — greyscale brand tokens (`brand-near-black`, `brand-off-white`, `brand-mid-grey`, `brand-border-grey`, `brand-light-grey`) with semantic colour reserved for status only: green = complete/paid, blue = active, amber = pending review/outstanding, red = destructive. Cards are `rounded-2xl border`; inner cards `rounded-xl`.

**Dark mode** is retrofitted with **229 hardcoded hex values** (`dark:bg-[#1e1e1e]`, `dark:border-[#2c2c2c]`, `dark:bg-[#111]`) across 27 files rather than tokens — heaviest in `OverviewTab` (51), `profile` (25), and `payments` (20). Shades are inconsistent between files.

**Illustration approach** — no image assets for structural art. Every blueprint, floor plan, building type, and roof type is a hand-authored inline SVG, which is why files like `Step3BuildingType.tsx` (313 lines) and `BuildingPreview.tsx` (1,149 lines) are so large.

**Not yet wired** — live payment processing (see below), profile email change, 2FA, and the Help page's video walkthrough link (currently a bare `youtube.com` URL).

---

## Payments status: Stripe + Switchr

The payments **UI is fully built**; the **rails are not connected yet**.

| Rail | Role | Status |
|---|---|---|
| **Stripe** | Card charge + escrow hold on the diaspora payer's side | API key almost ready — billing goes live once connected |
| **Switchr** | Mobile-money payout to contractors on the XAF/FCFA corridor (Cameroon) | Not yet live |

Everything is gated behind **`PAYMENTS_ARE_PREVIEW`** in [config.ts](src/lib/payments/config.ts), and the disclaimers appear in six places:

| Surface | Copy |
|---|---|
| `/upgrade` | "Preview — billing goes live once Stripe is connected. Prices and fees shown are not final." |
| `EscrowWallet` | "Preview — funds held via Stripe, released on verified completion and paid out through Switchr. Not yet live." |
| `PayoutStatusModal` | "Preview — payout flow illustrative until Switchr is live." |
| `/payments` | "Actual payments via Stripe + Switchr are coming soon." |
| `PaymentsTab` *(legacy, unrendered)* | "Full Stripe payment processing and contractor payouts via Switchr are coming soon." |
| `/help` FAQ | "What is Switchr?" — explains the mobile-money payout partner for the XAF/FCFA corridor |

What is **real** today: the per-stage `payment_status` field (`unpaid` / `partial` / `paid`), written through `updatePaymentStatus`, with realtime updates on the project detail page and payments tab. Stage milestone amounts are real too, re-derived from the confirmed budget by the tracking gate. What is **simulated**: the escrow hold, the fee split, the FX conversion, and the payout tracker's 5 nodes.

> `/payments` (the cross-project Finances page) still shows **"Est. Spent" as `budget_usd × (completedStages / 10)`** — a derived figure, not the actual `payment_status` data that the project-level wallet uses. These two numbers can disagree.

---

## Appendix: Internationalisation

The app is **bilingual English / French**, built for the Cameroonian market where most users are francophone.

**Core** — [src/lib/i18n/](src/lib/i18n/): `types.ts` (the `Lang` union, `LANG_META`, and a recursive `DeepKeys` type), `en.ts` (source of truth), `fr.ts`, `index.tsx` (provider + hooks), `external-forms.ts` (GHL config).

**Detection order** — `localStorage.lang` → any `fr-*` entry in `navigator.languages` → English. A Cameroonian visitor with a French browser lands in French without touching the toggle.

**Compile-enforced parity** — `fr.ts` is typed as `Mirror<EnDict>`. Adding an English key without its French translation **fails the build**, so a half-translated screen cannot ship. `t()` autocompletes every dot-path key and warns in dev on a miss; at runtime it falls back English → raw key rather than rendering blank.

**Plurals** — `tPlural()` applies French rules (0 and 1 are singular) versus English (only 1), via `{key}` / `{key}_plural` pairs.

**The toggle** — [LanguageToggle.tsx](src/components/ui/LanguageToggle.tsx), three variants: `segmented` (EN|FR, with an `onDark` mode for the black marketing navs), `compact` (icon-sized, for app top bars), and the default full-width row that matches `ThemeToggle` in sidebars. Present on **every** layout and standalone nav.

**Terminology** — French copy uses Central/West African construction vocabulary, not literal translation: *chantier* (build), *étape* (stage), *sous-étape* (substage), *entrepreneur* (contractor), *justificatifs* (evidence), *maître d'ouvrage* (project owner), *dépendance* (boys' quarters).

**Coverage today** — fully translated: all layouts and navigation, the landing nav, `/pricing`, `/community`, `/contractor-apply`, all six auth routes, `/onboarding`, `/invite/:token`, `/dashboard`, and `/projects`. Still English: the project detail tabs, `/payments`, `/profile`, `/help`, `/resources` (including the 14 long-form articles), the wizard step bodies, the free tools, and the admin panel — roughly 500 of ~870 strings.

**The one thing that cannot be translated from this codebase** — the GoHighLevel application form on `/contractor-apply`. It is a cross-origin iframe; same-origin policy makes its DOM unreachable. The fix is a duplicated French form built inside GHL, then its ID pasted into `external-forms.ts`. Until then French visitors see the English form with an explicit notice.
