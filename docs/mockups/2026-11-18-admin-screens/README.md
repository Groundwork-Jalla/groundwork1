# Admin screens, redesigned (18 Nov 2026)

> **Implementation Status (20 Nov 2026 — Partially Built):** Overview, Action Center, Projects, Project Workspace (Overview, Stages, Financials, Site Updates, Documents, Conversations, Team tabs), Reviews, Finance (per-project split + Budgets + shared Ledger), Homeowners, Contractors, Audit Log, Inbox base, and the dropdown sidebar (including the `?channel=` active highlight fix) have shipped. **Still unbuilt from this set:** `ActivityTab` refresh, `/admin/site-updates`, `/admin/contractors/records`, `/admin/partners`, `/admin/verifiers`, `/admin/users*`, `/admin/notifications`, `/admin/support`, `/admin/analytics`, `/admin/applications*`, `/admin/drafts`, `/admin/waitlist`, `/admin/inquiries`, `/admin/crm`, `/admin/sequences` visual redesign, and the 4 placeholder modules (`inspections`, `tasks`, `site-managers`, `agents`).

Original design concept (18 Nov 2026, illustrative data). Same theme as the WhatsApp CRM
(`../2026-11-18-admin-whatsapp/`): white cards on the canvas, green highlight, dropdown sidebar.
Every screen keeps every figure, filter, list, action and dialog it has today (inventory taken
from the code on 18 Nov). The sidebar is ADMIN_NAV unchanged: 38 items, same labels and links.

| Screen | Route | Desktop | Phone |
|---|---|---|---|
| Overview | `/admin` | `overview-desktop.png` | `overview-mobile.png` |
| Action Center | `/admin/action-center` | `action-center-desktop.png` | `action-center-mobile.png` |
| Projects | `/admin/projects` | `projects-desktop.png` | `projects-mobile.png` |
| Project workspace (Overview tab) | `/admin/projects/:id` | `workspace-desktop.png` | `workspace-mobile.png` |
| Reviews & Approvals | `/admin/reviews` | `reviews-desktop.png` | `reviews-mobile.png` |
| Finance overview | `/admin/finance` | `finance-desktop.png` | `finance-mobile.png` |
| Homeowners | `/admin/clients` | `homeowners-desktop.png` | `homeowners-mobile.png` |
| Inbox (all channels) | `/admin/inbox` | `inbox-desktop.png` | `inbox-mobile.png` |

## What changes, screen by screen

- **Overview:** same eight figures, each still a link to its filtered list; map, trades, funnel,
  attention list, activity, inspections, support tickets and GoHighLevel status laid out in
  three columns.
- **Action Center:** same priority tabs and items, grouped under Critical / High / Medium / Low
  headings; each row still opens where it does today.
- **Projects:** same search, date, origin and owner filters, tiles and four row actions (assign
  contractor, assign verifier, homeowner view, delete). **Added:** a Health column (the page
  already computes health, it was never shown) and a stage progress bar. On a phone the four
  actions sit behind a ⋯ menu.
- **Project workspace:** same header facts and actions (Assign verifier, Jalla message,
  WhatsApp ▾, Open homeowner view) and the same eight tabs. Overview tab: stage ladder and
  progress on the left; selected stage, blockers, recent activity, financial summary (six figures,
  Available to release emphasised) and the duplicate review on the right. The other seven tabs
  keep their content and take the same card styling.
- **Reviews & Approvals:** same per-stage content and actions, shown as a queue on the left and
  the selected stage on the right instead of a long column of cards.
- **Finance:** same four figures, needs-a-person banner and recent movements, as a table.
- **Homeowners:** same search, Building now chip and cards; Signup details opens beside the list
  instead of over it (full-screen sheet on a phone).
- **Inbox:** same list, project context, assign/resolve, thread and composer; each conversation
  tagged with its channel. `?channel=whatsapp` stays the separate WhatsApp CRM.

On a phone, admin keeps today's bottom tab bar (the first five sidebar items) and the menu button
opens the full dropdown sidebar.

Re-render with `./shot.sh <name> <desktop|mobile> [height]`.
