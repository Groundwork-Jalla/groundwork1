# Admin WhatsApp, redesigned as a CRM (18 Nov 2026)

> **Implementation Status (20 Nov 2026):** The **dropdown sidebar and `?channel=` exact active highlight fix** described below **have shipped** (`src/components/shell/nav-groups.ts`, `AppSidebar.tsx`). The **WhatsApp CRM UI itself** (per-person side pane, unread/needs-reply filters, template composer, 24h window indicator, calling UI) is **not yet built** (and browser WhatsApp calling requires Meta's WhatsApp Business Calling API).

Original design concept (18 Nov 2026, illustrative data). Light theme, real tokens; WhatsApp keeps
its brand green (#25D366).

| Screen | Desktop (1440 × 900 @2x) | Phone (390 × 844 @3x) |
|---|---|---|
| WhatsApp CRM: chats, conversation with calls in the timeline, the person's record | `crm-desktop.png` | `list-mobile.png` (chats), `crm-mobile.png` (conversation) |
| Start a WhatsApp chat: pick a person, approved template, preview | `newchat-desktop.png` | `newchat-mobile.png` |
| WhatsApp call in progress, with notes saved to the timeline | `call-desktop.png` | `call-mobile.png` |
| The admin sidebar: every item and where it goes | `sidebar-spec.png` | `menu-mobile.png` |

**The sidebar keeps every item, in dropdowns.** All 38 items stay with the same labels, order
and destinations as `src/components/shell/nav-config.ts` (ADMIN_NAV); only the look is new.
Work, Finance, People, Communication, Acquisition and System are dropdowns: the one holding the
current page opens by itself, any other opens on a click, and the sidebar no longer scrolls.
Overview and Action Center stay at the top; Support and Analytics (one item each) stay plain
links. `sidebar-spec.png` shows the default state, a second group opened, and every item with
its destination; `menu-mobile.png` is the phone menu.

**One fix, no content change:** an item is highlighted only when its whole address matches,
including `?channel=`. Today Inbox, WhatsApp, Jalla Messages, Email and Calls are all
`/admin/inbox` with a different `?channel=`, and the link check ignores the `?` part, so all
five light up together. WhatsApp keeps its address (`/admin/inbox?channel=whatsapp`).

**What the CRM adds:** per-person record beside every chat (role, consent, automatic messages
on/off, owner, linked project, follow-up date, notes, activity); filters for unread, needs reply
and new numbers; quick replies and templates in the composer; the 24-hour reply window shown;
calls logged in the same timeline as messages.

**Before building:** sending a first message needs Meta-approved templates. Placing and taking
WhatsApp calls from the browser needs Meta's WhatsApp Business Calling API on our number (or a
provider that supports it); it is not part of today's message integration.

Re-render with `./shot.sh <name> <desktop|mobile> [height]`.
