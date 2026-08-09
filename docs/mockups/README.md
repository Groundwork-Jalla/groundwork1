# Screen mockups

The A/B design variants reviewed with Philip on 3 Aug 2026 and confirmed screen by
screen with Favour on 9 Aug. Reference only — nothing here is imported by the app.

| File | Screens |
|---|---|
| `client-dashboard-mockups.jsx` | Dashboard, My Projects, Project Overview, Stages, Budget |
| `payment-screen-mockups.jsx` | Upgrade Plan, Milestone Pay, Payment History, Payout Status, Escrow Wallet |
| `app-screens-part1.jsx` | Timeline, Documents, Messages, Notifications, Resources |
| `app-screens-part2.jsx` | Settings, Contractors, Pre-Tracking, Contractor Profile, Help Centre |

**Which variant won, and with what modifiers, is in [`../SCREEN-DESIGNS.md`](../SCREEN-DESIGNS.md)** —
read that first. These files are the visual source; that file is the decision record.

Two things in the mockups are deliberately NOT carried into the app, and the
decision record explains why:

- **Emoji icons.** Every mockup uses emoji (📁, 💬, 🔒). The app uses monochrome
  lucide icons — Philip's call, on the grounds that coloured emoji read as amateur.
- **Hue-coded data.** Several mockups colour categories or tiers by hue. In the app
  colour is reserved for *status* (active, held, overdue); category and identity are
  greyscale, so the signal that means something stays legible.

The mockups also hardcode English and US-style figures. Everything built from them
goes through the `en`/`fr` dictionaries.
