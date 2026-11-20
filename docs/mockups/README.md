# Screen mockups

*Updated: 20 Nov 2026*

Reference mockups — nothing in this folder is imported by the app.

## Active November 2026 mockup sets

| Directory | Focus |
|---|---|
| `2026-11-15-ui-concepts/` | High-level visual & layout concepts (Option 1 design, screen coverage, implementation notes) |
| `2026-11-18-admin-screens/` | Admin portal screen redesigns (Overview, Workspace tabs, Finance, People, Inbox) |
| `2026-11-18-admin-whatsapp/` | Admin WhatsApp messaging & CRM views |
| `2026-11-18-contractor-project/` | Contractor `/work/projects/:id` stage, payment verification & substage views |
| `2026-11-18-payment-history/` | Homeowner & contractor direct-payment receipt history views |

## Original August 2026 A/B mockups (baseline reference)

Reviewed with Philip on 3 Aug 2026 and confirmed screen by screen with Favour on 9 Aug:

| File | Screens | Status (Nov 2026) |
|---|---|---|
| `client-dashboard-mockups.jsx` | Dashboard, My Projects, Project Overview, Stages, Budget | Implemented (project cap removed; direct receipt payments) |
| `payment-screen-mockups.jsx` | Upgrade Plan, Milestone Pay, Payment History, Payout Status, Escrow Wallet | **Superseded** — free access, Stripe checkout disabled (410), Escrow Wallet removed; see `2026-11-18-payment-history/` |
| `app-screens-part1.jsx` | Timeline, Documents, Messages, Notifications, Resources | Implemented (Documents unified across Homeowner/Contractor) |
| `app-screens-part2.jsx` | Settings, Contractors, Pre-Tracking, Contractor Profile, Help Centre | Implemented (Contractor Directory staff-locked Nov 9; Subscription tab removed) |

**Which variant won, and current superseding rules, are in [`../SCREEN-DESIGNS.md`](../SCREEN-DESIGNS.md)** — read that first.

Two things in the mockups are deliberately NOT carried into the app, and the
decision record explains why:

- **Emoji icons.** Every mockup uses emoji (📁, 💬, 🔒). The app uses monochrome
  lucide icons — Philip's call, on the grounds that coloured emoji read as amateur.
- **Hue-coded data.** Several mockups colour categories or tiers by hue. In the app
  colour is reserved for *status* (active, held, overdue); category and identity are
  greyscale, so the signal that means something stays legible.

The mockups also hardcode English and US-style figures. Everything built from them
goes through the `en`/`fr` dictionaries.
