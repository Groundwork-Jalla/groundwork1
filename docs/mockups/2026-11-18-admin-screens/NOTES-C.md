# Group C: Communication, Support, Analytics (18 Nov 2026)

Design concept only, nothing built. Illustrative data. Uses the shared kit (`common.css`, `m.css`, `sidebar.js`) unchanged.
Inventories were taken from the code on 18 Nov: `notifications.tsx`, `AdminTopBarActions.tsx` + `NotificationBell.tsx`,
`inbox.tsx`, `NewJallaMessage.tsx`, `ConversationThread.tsx`, `support.tsx`, `analytics.tsx`, copy from `en.ts`.

| Screen | Route | Desktop | Phone |
|---|---|---|---|
| Notifications | `/admin/notifications` | `notifications-desktop.png` | `notifications-mobile.png` |
| Jalla Messages | `/admin/inbox?channel=jalla` | `jalla-messages-desktop.png`, `jalla-messages-new-desktop.png` | `jalla-messages-mobile.png` |
| Email | `/admin/inbox?channel=email` | `email-desktop.png` | `email-mobile.png` |
| Calls | `/admin/inbox?channel=call` | `calls-desktop.png` | `calls-mobile.png` |
| Support | `/admin/support` | `support-desktop.png` | `support-mobile.png` |
| Analytics | `/admin/analytics` | `analytics-desktop.png`, `analytics-proposed-desktop.png` | `analytics-mobile.png` |

---

## 1. Notifications: `/admin/notifications`

**Idea.** A feed grouped by day (Today / Yesterday / Earlier), unread rows tinted with a green dot, a type icon,
and one plain "Open …" link per row. All / Unread is a segmented control next to Mark all read. A side column shows the
bell dropdown (same rows) and the empty and error states.

| Today | In the design |
|---|---|
| Title + subtitle | Header, copy unchanged |
| Unread toggle with count (`?state=unread`) | Seg "All 100 / Unread 7" (Unread = the same URL toggle) |
| Mark all read (only when unread > 0, spinner while busy) | Outline button next to the seg |
| Controls hidden until rows exist | Same rule (noted) |
| Row: unread dot, title, body, relative time, full date on hover | Kept; hover tooltip noted in the footer |
| Click opens the destination and marks it read | Whole row clickable; "Open …" link names where it goes |
| Row with no destination: "nothing to open", not clickable once read | Shown in italics, with no link or chevron |
| Latest 100 (PAGE) | Footer: "Showing the latest 100" |
| Loading | Spinner line (not drawn) |
| Error + Retry (`loadFailed`), `readFailed`, `openFailed` | Red state cards in the side column |
| Empty: "No notifications yet" / filtered: "Nothing unread" | State cards in the side column |
| Bell: badge (9+), 20 rows + "Load older", Mark all read, "View all notifications" | Bell dropdown drawn in the side column; badge on the top bar bell |

**Added:** day grouping and type icons (presentation only; the type comes from the destination the row already resolves).
**Dropped:** nothing. The bell's `filters` copy (Projects/Payments/System) is not used by any screen today, so it is not drawn.

## 2. Jalla Messages: `/admin/inbox?channel=jalla`

**Idea.** A sibling of the WhatsApp CRM in Groundwork green. Three panes: threads named by **project** first (Jalla
threads are project threads), the conversation in the middle, and a homeowner + project rail on the right. "New message"
is the primary green button.

| Today | In the design |
|---|---|
| Title / channel subtitle | Page is titled "Jalla Messages" (sidebar label), with a one-line lead |
| New message (jalla only) → dialog | Green primary button; dialog in `jalla-messages-new-desktop.png` |
| Needs reply chip + count (`?status=waiting_on_us`) | First filter chip in the list header |
| `?status=active` (from Overview), any `?status=` | Chips: All / Needs reply / Waiting on them / Resolved; "Active" shows as an extra active chip when the URL carries it (not drawn) |
| Row: status dot, title (person or subject), relative time, last message with "You:" / "Internal note:" prefix, channel · status · linked project | Project name, person · city, preview with prefixes, status · owner, time |
| `?conversation=` selection, refetch for unknown id | Selected row highlighted (behaviour unchanged) |
| ContextHeader: person + secondary, linked / account / several projects, Open project, "This conversation is about this", link errors, "No project yet" | Right rail: Homeowner, Project card (stage bar, status, city, Open project). Account and several-projects variants drawn in `email-desktop.png` and `email-mobile.png` |
| Thread header: title, status, channel, resolved-at; Assign select (Unassigned / No staff account), Assign, Resolve (hidden when resolved) | Header of the middle pane |
| Messages: inbound / outbound bubbles, internal notes (dashed), attachments, "not delivered", sender · time | All drawn; internal note in amber dashed |
| Composer: textarea, pending attachments with remove, attach, voice note, Send, Internal note, hint, error / delivery lines | All drawn |
| Loading / error / unavailable / empty / "Choose a conversation" | Not drawn: unchanged copy in the same panes |

**Added:** a "This thread" block in the rail (channel, owner, started, last message). All are fields already on the conversation row.
**Unsure:** "Waiting on them" and "Resolved" chips put the existing `?status=` parameter on screen; today only Needs reply has a control.

### New message dialog (`NewJallaMessage.tsx`)
**Idea.** Today's two steps (account list → back arrow → project list) become **two columns in one dialog**: homeowners
on the left, the chosen homeowner's projects on the right, with one search box. The step indicator keeps the order visible.
Kept: title + sub copy, search placeholder, "{n} projects" / disabled "No projects", project rows with city · status · Stage n,
disabled "No homeowner on this project", footer "{project} — with {homeowner}" + "Open conversation" (spinner while busy),
Esc / close, and every state (loading, "Projects could not be read.", "There are no accounts yet.", "No project matches that.",
error banner). The states are listed inside the dialog.

## 3. Email: `/admin/inbox?channel=email`

**Idea.** A mail client: the list leads with **subject lines** (sender, subject, preview, status line). The reading pane
puts the subject as the title, shows older messages collapsed and the latest in full as mail cards ("to Groundwork" / "to Ama
Kouam"). The project context sits in a strip under the subject.

Checklist: same as Jalla (filters, row fields, Assign / Resolve, notes, attachments, composer). Specific to email:
- Subject shown in the thread header (today's ConversationThread already prefers `subject`).
- Delivery: an outbound message is delivered server-side. A failure shows "not delivered" on the message and the
  `admin.inbox.notDelivered — {detail}` line above the composer. Both are drawn.
- Account-project variant with "This conversation is about this" (desktop), several-projects "Projects (2)" variant with
  "This conversation is not linked to a project yet." (mobile).
- No "New" button: the code allows starting a thread only on Jalla.

**Added:** collapsing older messages (display only).

## 4. Calls: `/admin/inbox?channel=call`

**Idea.** A **call log table** (person + project, last note, status tag, owner, when) with the selected call's record
in a side sheet: a timeline of the call notes, staff notes inline, then the same composer.

Checklist: same thread functions (Assign select + Assign, Resolve, messages, internal notes, attachments / voice note,
Send / Internal note, hint, errors), the same status filters, unidentified-sender rows, linked project + Open project.

**Not placed (needs data):** call **duration and outcome**. A call conversation is stored as a thread of messages, with
no length, direction or result. They appear only as dashed "Proposed" samples in the table footer.
**Unsure:** what "Send" means on a call thread. The code sends an outbound message and asks for delivery, which
likely returns `not_deliverable`. The button is kept as it is today.

## 5. Support: `/admin/support`

**Idea.** A ticket **queue in master-detail**. Deletion requests are pinned to the top in red, with the existing deletion banner
above the queue. The detail shows the sender's own words read-only, and a **status stepper** (Open → In progress → Resolved →
Closed) replaces the select. The conversation chooser moves from a modal into the detail pane.

| Today | In the design |
|---|---|
| Title + subtitle | Kept |
| Deletion banner "{count} account-deletion request(s) awaiting action…" | Full-width alert above the queue |
| Filter Open · n (status = open) / All · n | Seg in the queue header |
| Search by name, email or message | Search field in the queue header |
| Sort: deletions first | Same, with a "Deletion requests first" hint |
| Row: Deletion badge, subject, name · email · date, "account closed" | Queue row, plus a thread tag (Linked / 1 thread / 2 threads / No conversation) |
| Status select (4 statuses), disabled while saving, `saveFailed` | Stepper in the detail; error line drawn |
| Message (read-only) | "The sender's own words · cannot be edited" block |
| Open conversation (linked or single) | Button state, shown in "Other tickets show" |
| Choose conversation (n) → chooser: channel, when / "No messages yet", project context (linked / "Account holder on" / "{n} projects" / "No project context"), last message, foot text | Inline chooser in the detail pane, every field kept |
| No conversation (dashed) with hints: none / unavailable / linked-missing | Dashed button with its tooltip |
| Loading / loadFailed / empty / emptyFiltered | Listed in the queue footer |

**Changed:** the chooser is inline, not a modal (no data change: picking a thread still links the ticket and opens the Inbox).
**Note:** "Open" here means status = open only, as in the code today. Overview's "open tickets" counts open + in_progress
(see Support Ticket Meaning). The two counts differ by design and the design does not change either.

## 6. Analytics: `/admin/analytics`

**Idea.** A headline KPI strip, then real charts. **Only what `loadAdminAnalytics()` returns today.** It returns no time
series, so there is **no period selector**: an "As of today" pill replaces it, and the no-trend note stays.

| Computed today | In the design |
|---|---|
| projects.total, tracking | Hero KPI "Active projects 48 · 42 of 48 are being tracked"; also the footer of the Active projects card |
| projects.byStatus (Unknown key → "Unknown") | Status bars |
| projects.byTier | Plan bars (Self Verify / Jalla Verify / Jalla Management) |
| projects.byStage ("Stage n" / "No stage recorded") | Column chart, stages 1–10 + No stage (grey) |
| finance: expected, funded, authorised, inTransit, disbursed | Money bars (USD, against the largest), green ramp |
| finance.needsAttention → /admin/budgets | KPI "Need a person 5" + footer link |
| verification: pending / verified / rejected / needs more evidence | Lifetime outcome bars; pending also as a KPI (with the lifetime total) |
| communication: conversations, needsReply, resolved → Open the Inbox (?status=waiting_on_us) | Card + KPI "Needs reply" |
| acquisition: applicationsPending, drafts, waitlist, quoteRequests, support.open | "Coming in" bars; applications also as a KPI |
| field: siteUpdates, contributors → Open the feed | "From site" figures; also as a KPI |
| A section that cannot be read → "Not available" (not zero) | Stated in the note under the charts |
| Loading / whole-page error | Not drawn: unchanged |

**Proposed (`analytics-proposed-desktop.png`, labelled "Proposed — needs a data source"):** period seg (7 / 30 / 90 days, 12 months),
new projects per week, money disbursed per month, median first reply, verification turnaround, with deltas. Each chart
names the history it would need.

---

## Could not place / unsure
- **Calls: duration and outcome.** No column exists. Shown only as proposed.
- **Inbox status chips beyond Needs reply.** They use the existing `?status=` parameter, but today's UI exposes only Needs reply.
- **Use a message as the source of a decision** (click a bubble). The Inbox does not pass `decision`, so the Record decision
  button never shows there. Not drawn.
- **Bell "filters" copy** (All / Unread / Projects / Payments / System) exists in en.ts but is not used. Not drawn.
- **Phone numbers in Calls.** The Inbox loads name and email only (`personLabel`), so the call log shows no phone column.
