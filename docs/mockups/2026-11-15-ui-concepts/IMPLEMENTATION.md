# First client UI implementation — 15 November 2026

The current selection is **01 — Calm & clear for the client dashboard**, replacing the intermediate 02 home. The user specifically requested a quiet overview. The already approved **03 client stages/payment presentation** and **06 client confirmation dialogs** remain in place. The other client destinations and Admin concepts await their own design reviews.

## What changed

| Area | Result |
| --- | --- |
| `/dashboard` | White sidebar with green accents, compact project/photo card, progress summary, one green next-action card, three real financial figures and links to messages, documents and the project team. Other projects are collapsed until needed. One create-project action replaces the duplicate header/footer actions. Account guidance and retry states remain available. |
| `/projects/:id?tab=stages` | Stage navigation beside the work/payment panel on wide screens, a scrolling stage strip on smaller screens, larger evidence previews, readable approved-work rows and a separate receipt/payment section. The selected stage is revealed in the phone strip. |
| Client confirmations | Work approval, payment-plan confirmation and proposed-price decisions use larger responsive dialogs. Price decisions compare current/proposed stage and project totals; confirmed receipts and the resulting stage balance remain separate. Phone comparisons stack vertically. |

The application keeps its existing typography and English/French translations. The calm home treatment is scoped to the client dashboard; other workspaces keep their existing default presentation. Detailed stages, receipt history, documents and conversations stay in the existing project views.

## Behavior retained

- Both creation origins keep their existing payment gates: contractor-origin work is reviewed before payment for that stage; client-origin work follows the existing funding-first gates.
- Only contractors upload construction evidence. Primary-client approval and receipt permissions still come from the existing project access data; observers retain their restrictions.
- All ten stages remain visible, including historical work and zero-cost allocations. Stage selection, Back links, certificates, project tabs and notification query destinations remain connected to their existing routes.
- BOQ totals and stage prices use the existing saved currency basis and actual native amounts. Submitted proof remains separate from confirmed money. The dashboard's remaining budget still excludes historical allocations according to the existing payout calculation.
- Full payment, two installments, multiple receipts, file/camera controls, receipt correction, currency/amount validation, contractor confirmation and separate progression authorization retain their existing handlers and rules.
- Cancellation sends no approval. Existing duplicate-click protection and stale-price checks remain in force. Errors, unavailable figures and retry controls remain visible.

The dashboard reads authorized project evidence for its cover photo. If no suitable image can be read, it shows a neutral architectural outline. Generated mockup photographs are not application data.

## Implementation previews

These screenshots render the actual application components with isolated, illustrative fixtures. The site picture is explicitly marked as a controlled UI fixture. Amounts, people and receipts are test data, not production records.

- [Current calm client home — desktop](implemented-client-home-calm-desktop.png)
- [Current calm client home — phone](implemented-client-home-calm-phone.png)
- [Current calm client home — tablet](implemented-client-home-calm-tablet.png)
- [Client stage view — desktop](implemented-client-stages-desktop.png)
- [Client stage payment panel — desktop](implemented-client-payment-desktop.png)
- [Client receipt form — desktop](implemented-client-receipt-desktop.png)
- [Work approval — phone](implemented-client-work-confirmation.png)
- [Price confirmation — desktop](implemented-client-price-confirmation-desktop.png)
- [Price confirmation — small phone](implemented-client-price-confirmation-phone.png)

## Validation

- **851 tests passed across 43 files** covering project/stage progression, pricing, both origins, permissions, payment plans, receipt balances, native money, account roles, navigation and translations. Added coverage checks that pending/replaced proofs do not become confirmed funds in the pricing dialog, and that missing legacy amounts stay unknown.
- **Typecheck and production build passed.**
- **18 controlled browser layout combinations:** home, stages/payment and pricing confirmation at 320×740, 390×844, 768×1024, 1024×768, 1440×960 and 1920×1080. No page/main horizontal overflow, no dialog outside its viewport and no runtime exceptions were reported.
- **15 controlled browser interaction checks passed:** second-confirmation focus, keyboard containment, Escape/cancel without writes, phone stage selection, observer restrictions, both project origins, currency/file/camera/payment choices, phone input sizes, price/receipt distinction, French and dark theme.

Saved browser observations: [layout measurements](validation-layout-results.json) and [interaction results](validation-interaction-results.json).

Repeatable repository checks:

```sh
pnpm test --run src/lib/projects src/lib/payments/receipt-payout-screen.test.ts src/lib/payments/stage-receipt-balance.test.ts src/lib/budget/project-money.test.ts src/lib/auth/account-role-sync.test.ts src/lib/i18n/data-keys.test.ts src/lib/i18n/stage-names-translated.test.ts src/components/shell/nav-config.test.ts --maxWorkers=1
pnpm typecheck
NODE_OPTIONS=--max-old-space-size=3072 pnpm build
```

Browser checks ran in headless Chromium with external requests blocked and a mocked Supabase client. They did not read or mutate live projects or send messages. Physical Safari/iPad testing and production acceptance remain release checks. The full repository suite was not rerun for this scoped visual change.

No database migration, provider setting or dependency change is required. The application changes have not been deployed by this task.

## Notification navigation follow-up

The user subsequently approved removing Notifications from the client sidebar. The client menu now has six destinations; the mobile bar follows the same list. The header bell remains available, with **View all notifications** linking to the existing history page. The history URL, filters and read/unread behavior remain available. Admin retains its own notification menu and history; contractor/verifier users retain their existing in-bell history.

Bell and history clicks now share normalization for older notices whose project reference is stored outside the payload. Navigation still resolves the recipient's current accepted project role. Client and contractor stage links accept exact stage IDs as well as stage numbers. Message-only notices infer the messages tab, approved-work notices focus work, and Admin action links preserve their actual tab names. Missing targets show a clear message; revoked membership does not route to an unrelated workspace.

Validation for this follow-up: **920 tests across 47 files**, typecheck and production build passed. **23 controlled browser checks** passed: the menu/history link at five viewport sizes (including a short landscape screen), plus receipt, proposal, non-current-stage and legacy-project clicks on phone and desktop. These checks used the same isolated local mock setup described above.

- [Phone notification bell](implemented-client-notifications-phone.png)
- [Desktop notification bell](implemented-client-notifications-desktop.png)
- [Browser check results](validation-notification-results.json)

No migration is required for this follow-up. Deployment and live acceptance remain release steps.

## Calm overview revision

The latest home revision uses board 01 and keeps the overview light. The project card and next action share a row on wide screens and stack on smaller screens. Other projects use a disclosure, the duplicate bottom create button is removed, and the mobile create control is a labelled plus button. Financial calculations, project membership, notification destinations and both creation-origin gates are unchanged.

The numbered mockups and older architectural implementation captures remain historical design references. The current home links above point to the new calm implementation. The remaining client design groups are recorded in [SCREEN-COVERAGE.md](SCREEN-COVERAGE.md).

Validation for the calm revision: **231 targeted tests across nine files passed**, plus typecheck and production build. Controlled browser checks covered **320, 390, 768, 1024, 1440 and 1920px** widths without page/main overflow, and **21 assertions** for the white sidebar, one next-action card, desktop composition, retained precision, single create action, other-project access, funding-first and observer/empty-account states, French and dark mode. The dark-mode action uses an explicit light surface so the application's global dark-card override cannot obscure its label.

- [Calm dashboard browser results](validation-calm-results.json)
- [Calm dashboard in dark mode](implemented-client-home-calm-dark.png)

These are local Chromium checks with illustrative fixtures; live-device acceptance remains a release step. No database migration or provider configuration is part of this revision.

## Main source locations

- [Dashboard](../../../src/app/routes/dashboard.tsx), [next-action reader](../../../src/components/dashboard/ClientProjectNextAction.tsx), [permission-aware action helper](../../../src/lib/projects/client-dashboard-action.ts), [project cover](../../../src/components/dashboard/ProjectCoverImage.tsx).
- [Client project route](../../../src/app/routes/projects/detail.tsx), [stage tracker](../../../src/components/project/StageTracker.tsx), [receipt presentation](../../../src/components/project/StagePaymentGate.tsx), [payment plans](../../../src/components/project/StagePaymentPlanPanel.tsx).
- [Confirmation component](../../../src/components/ui/ConfirmModal.tsx), [work approval](../../../src/components/project/SubstageRow.tsx), [price decisions](../../../src/components/project/StagePricingPanel.tsx).
