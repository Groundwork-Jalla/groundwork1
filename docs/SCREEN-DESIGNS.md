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
| Stages | **A** ✅ done 9 Aug | Substage rows are now B's rounded-square check-boxes (ticked + struck through, amber clock awaiting review, camera for evidence-not-yet-submitted, empty when open). Pipeline labels take the *translated* stage name and no longer end on a dangling "&" |
| Budget / Costing | **A** ✅ done 9 Aug | Each trade line opens in place to its per-stage distribution — Materials $17,425 → Foundation $2,788, Structure $3,659 … — derived from the same stage weights as the milestones, so it reconciles with the payment schedule below. Trade slices and per-floor bars greyscaled; stage-status colours kept |

## Payment screens

| Screen | Design | Modifiers |
|---|---|---|
| Upgrade / Plan selection | **A** ✅ done 9 Aug | Three plan columns side by side, Jalla Verify the dark featured column. (Overrides the 3 Aug note, which said B.) Monochrome ticks; only Jalla Verify has a Stripe checkout — Self Verify is free, Management goes to sales |
| Milestone Payment | **B** ✅ done 9 Aug | Stage budget leads; processing fee and card processing sit behind a "Fee details" disclosure. Fixed a Rules-of-Hooks violation — `useT`/`useState` were being called after an early `return null` |
| Payment History | **B** ✅ done 9 Aug | + Export CSV (client-side, quoted fields, UTF-8 BOM for Excel); fee line removed; totals resolve through `projectBudget()` |
| Payout Status | **B** ✅ done 9 Aug | Fee-split node removed entirely — the chain is Received → Payout sent → Converting → Delivered. Same hooks fix as the milestone modal; unused `tier` prop dropped |
| Escrow Wallet | **B** ✅ done 9 Aug | Copy now reads "held in a secure wallet". **Ten** strings across en/fr named Switchr or Stripe and were rewritten provider-neutral; "payment fee" → "processing fee" platform-wide |

## App screens

| Screen | Design | Modifiers |
|---|---|---|
| Timeline | **A** | **Keep the current live implementation** — Favour is happy with it. Matches the 3 Aug note to leave it and let user feedback drive changes. Both List and Gantt views stay available |
| Documents | **A** ⚠️ diverges | Fully translated (was entirely hardcoded English). **The mockup's taxonomy does not match the data**: Design A assumed a flat file list with Legal / Contracts / Permits categories, but the app stores *certificates* and *per-stage evidence*. Kept the real Certificates / Evidence tabs rather than inventing categories the data cannot fill — needs your call if you want the mockup's shape instead |
| Messages | **B** ⚠️ diverges | Empty state translated. **B's two-pane layout does not fit the data**: chat is per-project and reached from that project's Messages tab, so the conversation-list sidebar would always list exactly one chat. Kept the single thread — needs your call if you want a cross-project inbox, which is a new feature, not a restyle |
| Notifications | **B** ✅ done 9 Aug | + A's filter chips, Mark-all-read and unread dots. B's NEW / EARLIER grouping added — split on unread-vs-read rather than a date window, so a 3-day-old unread approval stays at the top where it still needs action. Whole screen translated (was hardcoded English) |
| Resources | **A** ✅ done 9 Aug | Coloured tag highlights removed — all tags neutral except `essential`, which keeps the inverted treatment because it genuinely ranks rather than labels |
| Settings | **A** ✅ done 9 Aug | + **Team tab** (client-side, read-only — admin contractor *management* stays in Admin → Contractors, which is a different table and a different question): every contractor across every project you own, with Active / Invited / Declined status. New `fetchTeam()` query; loads lazily since most Settings visits never open it. Tab labels translated (were English constants) |
| Contractor Directory | **A** ✅ done 9 Aug | + search over name/trade/location/specialty, accent-insensitive so "Yaounde" finds "Yaoundé". Filter chips now translated (were rendering raw English constants). Star rating replaced by a **score out of 5**. Professions still to extend (plumbers, lawyers, land experts) |
| Pre-Tracking / Budget Verification | **A** ✅ verified 9 Aug | Already matched Design A — shortened CTA ("Confirm & Start Tracking"), quote upload marked optional, fully translated. No changes needed |
| Contractor Profile | **B** ✅ done 9 Aug | Dark centred hero opened from a directory card (not its own route — the decision is made in the list, and a separate page loses your place). Score out of 5, never stars. From A: the blurred upgrade-gated contact block and an explicit "Specialties" heading, which B showed as bare unlabelled chips |
| Help & Support | **B** ✅ done 9 Aug | "Book a Call" tile removed per Philip (unmanageable call volume); the existing Contact Support tile already scrolls to the message form. Tile copy translated |

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
- **No emoji anywhere in the UI.** ✅ Swept 9 Aug — app chrome is emoji-free (lightbulb
  banner, certificate tier marks, invite tick all converted to lucide icons). Two
  deliberate exceptions remain and need your call: the **weather widget**'s condition
  glyphs (☀️ ⛅ 🌧️), where emoji are the conventional vocabulary, and a decorative ✦ on
  the contractor landing page. Philip's reasoning: coloured emoji read as amateur.
- **Colour is an accent, not a data channel.** Green/amber/blue mark status; they do
  not carry the primary information.
- **Architectural blueprint schematic** is the consistent visual theme across the platform.
- **"Processing fee"** is the platform-wide term. Never "platform fee".
