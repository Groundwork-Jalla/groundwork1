# Screen design decisions

Which mockup variant each screen implements, confirmed by Favour on 9 Aug 2026.
Source mockups: `payment-screens.html`, `client-dashboard-screens.html`,
`app-screens-part1.html`, `app-screens-part2.html` (A/B variants of each screen).

Where a row says **+**, the chosen variant is modified — those modifiers are part of
the decision, not suggestions. Most originate in the 3 Aug UI review with Philip.

## Client screens

| Screen | Design | Modifiers |
|---|---|---|
| Dashboard | **B** ✅ done 9 Aug | + profile completion tracker, + costing allocation widget. Hero shows released/held/remaining derived from stage payment state; costing donut is greyscale and resolves its total through `projectBudget()` |
| My Projects | **A** ✅ done 9 Aug | Chosen for the "2 of 3 used → Upgrade" indicator — which was inert text and is now a real link to `/upgrade`. Cards resolve their figure through `projectBudget()` rather than showing an em dash when no budget is confirmed |
| Project Overview | **A** ✅ done 9 Aug | + vertical check-mark substage system from B: each stage in the Stage Progress panel opens to its ticked substages, active stage open by default. Costing donut and payment bar greyscaled; duplicate stage tracker removed from the sidebar; weather now resolves the **build city**, not the country capital |
| Stages | **A** | + vertical check-mark substage list from B |
| Budget / Costing | **A** | Cost boxes expand in place to show material and labour lines — no export required to see detail |

## Payment screens

| Screen | Design | Modifiers |
|---|---|---|
| Upgrade / Plan selection | **A** | Three plan columns side by side. (Overrides the 3 Aug meeting note, which said B — Favour changed this on 9 Aug.) Less body text, larger buttons |
| Milestone Payment | **B** | "Processing fee", **not** "platform fee"; fee lives in a dropdown rather than on the face of the screen |
| Payment History | **B** | + Export button; fee column removed — the view is about funds reaching construction |
| Payout Status | **B** | All fee references removed; wording tightened. Visible to both client and contractor |
| Escrow Wallet | **B** | Footer reads "funds held in secure wallet" — never name the external provider. Colour used sparingly, as accent only |

## App screens

| Screen | Design | Modifiers |
|---|---|---|
| Timeline | **A** | **Keep the current live implementation** — Favour is happy with it. Matches the 3 Aug note to leave it and let user feedback drive changes. Both List and Gantt views stay available |
| Documents | **A** | — |
| Messages | **B** | Two-pane. (Meeting notes said "design D", which doesn't exist; Favour chose B on 9 Aug) |
| Notifications | **B** | + filter chips, Mark-all-read and unread indicators from A. No emoji; bell and all icons black and white |
| Resources | **A** | Coloured tag highlights removed |
| Settings | **A** | + new Team section listing invited and Jalla-assigned contractors |
| Contractor Directory | **A** | + search bar. Professions extended (plumbers, lawyers, land experts …). Lock icon black and white, not an emoji |
| Pre-Tracking / Budget Verification | **A** | Shortened CTA. Optional step — users without a contractor quote proceed on Jalla's estimate |
| Contractor Profile | **B** | **No star ratings — show a score instead.** + faded/upgrade-gated contact block from A, + clear specialty labelling |
| Help & Support | **B** | "Book a call" removed — messaging only, for complaints and issues |

## Cross-cutting

These apply to every screen above, not to any one of them:

- **High fidelity and dynamic.** Screens are built to the finished visual standard —
  real type hierarchy, real spacing, real states — and driven by live data with loading,
  empty, and error states. No static mockup fidelity, no placeholder-only screens.
- **One shell, used everywhere.** ✅ Done 9 Aug 2026. `src/components/shell/` holds the
  single implementation; layouts apply it, pages never import it.

  | Component | Applied by | Covers |
  |---|---|---|
  | `AppShell` + `AppSidebar` | `_layout.tsx`, `admin/_admin-layout.tsx` | every signed-in page |
  | `SiteNav` + `SiteFooter` | `_public-layout.tsx`, `tools/_tools-layout.tsx` | every signed-out page |

  `projects/new` stays exempt by design — `WizardShell` owns the viewport.

  Nav destinations live in `shell/nav-config.ts` as data, so the sidebar, the mobile
  drawer and the mobile tab bar cannot disagree about what exists. A new page is added
  there, not in three components.

  What this removed: a second divergent admin sidebar (different radii and padding,
  hardcoded English labels, and no mobile navigation at all — the admin area was
  unusable on a phone), three hand-rolled public navbars, and three hand-rolled
  footers. `contractor-apply` and `community` had no navbar or footer whatsoever.
- **Translation.** Every screen must be fully translated. `en.ts` is the source of
  truth and `fr.ts` is typed `Mirror<EnDict>`, so `npx tsc --noEmit` proves key parity —
  but it cannot catch a hardcoded English string that never entered the dictionary.
  New screens go into the dictionary as they are built, not afterwards.
- **No emoji anywhere in the UI.** Icons are black and white. Philip's reasoning:
  coloured emoji read as amateur.
- **Colour is an accent, not a data channel.** Green/amber/blue mark status; they do
  not carry the primary information.
- **Architectural blueprint schematic** is the consistent visual theme across the platform.
- **"Processing fee"** is the platform-wide term. Never "platform fee".
