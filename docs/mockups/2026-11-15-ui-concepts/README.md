# Groundwork UI concepts — 15 November 2026

Design previews and the record of the first approved implementation. The generated boards remain illustrative design references.

The original request was for client and admin design previews before implementation, while GoDaddy access was pending. The contractor workspace is outside this visual refresh.

**Current approved scope:** the user has returned to **01 — Calm & clear for the client dashboard**, asking for a quiet overview. It replaces the earlier 02 home implementation. **03 — Client stages/payment** and **06 — Client confirmations** remain in place. Other client screens and the Admin redesign await separate design approval. See [implementation, screenshots and validation](IMPLEMENTATION.md).

The later notification-menu refinement is also implemented: six client menu destinations, the header bell and access to full history through “View all notifications.” See the implementation record for routing checks.

| Concept | Preview | Design intent |
| --- | --- | --- |
| 01 — Calm & clear | [Selected client home](01-client-home-calm.png) | White sidebar, project/photo overview, one next action, concise money summary and responsive phone layout. |
| 02 — Architectural | [Alternative client home](02-client-home-architectural.png) | Earlier direction, retained as a reference; no longer the selected dashboard. |
| 03 — Stages & payments | [Client project](03-client-stages-payments.png) | Separate work/payment states; contractor files above payment controls; full/two-installment plan, received amount and outstanding balance. |
| 04 — Clear operations | [Admin overview](04-admin-overview.png) | Grouped navigation, attention queue, human follow-up, project records and provider setup status. |
| 05 — Client mobile states | [Mobile flow](05-client-mobile-states.png) | Empty dashboard, contractor-created review, client-created payment and receipt awaiting contractor confirmation. |
| 06 — Clear confirmations | [Client confirmations](06-client-confirmations.png) | Final-update consequences and current/proposed pricing with preserved receipt history. |
| 07 — Admin communications | [Inbox and follow-up](07-admin-communications.png) | Conversations beside the actual next action, staff ownership, contact history and setup status. |

The refinement brief is [OPTION-1-DESIGN.md](OPTION-1-DESIGN.md); the latest scoped approval above governs implementation. The additional image prompts are in [OPTION-1-PROMPTS.md](OPTION-1-PROMPTS.md).

These are representative previews, not the complete screen set. The route-checked [screen coverage inventory](SCREEN-COVERAGE.md) distinguishes what is shown, what still needs design and which existing Admin destinations remain placeholders.

## Review boundaries

- All names, amounts, counts, avatars and site photographs in the generated boards are illustrative. Implementation screenshots use explicitly controlled local test data; neither set is production site evidence.
- Site imagery in a real UI must come from the project's authorized uploaded material. A missing photo needs an honest neutral fallback.
- Only contractors upload construction evidence. Primary clients review evidence and submit payment receipts when eligible. Observer/family permissions remain read-only.
- Work completion and payment receipt are separate. Historical completed stages retain actual prices/history; zero-cost stages follow existing rules and approved revisions.
- Contractor confirmation/progression decisions and outstanding balances stay intact. The receipt form in concept 03 represents a client who is already eligible to submit it.
- The design abbreviates the ten-stage list for space; implementation must show every stage, including completed and zero-cost stages.
- Admin controls are for oversight, communication and records. Client approvals, contractor evidence and receipt/progression decisions stay with their project roles.
- Navigation grouping and the client home are proposals. An implementation must retain existing destinations, action links, both project-origin flows and all current permissions.
- The original boards predate the approved removal of Notifications from the client menu. The implementation keeps six client destinations and the notification bell with full-history access.
- Communication statuses depict the known setup work; template approval, signed events and delivery must be established independently.
- Existing data sources are required for metrics. Mock numbers must never ship as application defaults.
- Generated text and tiny visual details are design guidance, not a final interaction specification.

## Generation

Generated with the built-in image generation tool using the current repository's palette, typography, navigation, project/payment code and existing screenshots as review context. The new images were generated from text briefs. Concept 03 received one targeted image edit to remove invented prices from completed-stage rows and simplify status styling.

Full generation and refinement prompts are saved in [PROMPTS.md](PROMPTS.md).

