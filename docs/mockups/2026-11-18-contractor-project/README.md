# Contractor project view, simplified (18 Nov 2026)

Proposed redesign of the contractor's project screens in the calm style of the
homeowner's project view: white sidebar, one green "Your next step" card, three
money figures, the stage list beside one stage's detail, and far fewer words.

Design concept only, not built. Illustrative data; all three screens show the same
moment: Part 2 of stage 5 is approved and the homeowner has just uploaded the
receipt for Part 3.

| Screen | Desktop (1440 × 900 @2x) | Phone (390 wide @3x) |
|---|---|---|
| Work: stages, parts, updates, price by part | `work-desktop.png` | `work-mobile.png` |
| Money: needs you, figures, payment history with receipt previews, by stage | `money-desktop.png` | `money-mobile.png` |
| Confirm a receipt: one question, three answers | `confirm-desktop.png` | `confirm-mobile.png` |

"The amount is different" leads to today's three choices (allow work anyway, record and
decide later, ask for the rest). "It hasn't arrived" flags the receipt with a note.
Documents, Messages and People keep their current layout inside the new header and tabs.

Re-render a screen with `./shot.sh <name> <desktop|mobile> [height]`.
