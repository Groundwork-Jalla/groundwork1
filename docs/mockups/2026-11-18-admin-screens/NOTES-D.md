# Group D: Acquisition screens (design notes, 18 Nov 2026)

Design concept only, nothing built. Illustrative data. Shared kit (`common.css`, `sidebar.js`) unchanged;
page CSS is inline. Every checklist item below is taken from the code on 18 Nov and mapped to where it
now lives.

| Screen | Route | Desktop | Phone |
|---|---|---|---|
| Applications | `/admin/applications` | `applications-desktop.png` | `applications-mobile.png` |
| Application detail | `/admin/applications/:id` | `application-detail-desktop.png` | `application-detail-mobile.png` |
| Started Applications | `/admin/drafts` | `drafts-desktop.png` | `drafts-mobile.png` |
| Waitlist | `/admin/waitlist` | `waitlist-desktop.png` | `waitlist-mobile.png` |
| Communications | `/admin/sequences` | `communications-desktop.png` (Needs attention) + `communications-{tracking,journeys,sequences,log,inbox,whatsapp,settings}-desktop.png` | `communications-mobile.png` |
| Quote Requests | `/admin/inquiries` | `quote-requests-desktop.png` | `quote-requests-mobile.png` |
| CRM | `/admin/crm` | `crm-desktop.png` (Pipeline) + `crm-setup-desktop.png` (Setup & health) | `crm-mobile.png` |

---

## 1. Applications: `/admin/applications`

**Idea.** A review queue with a decision panel. Status tabs and search above; the queue on the left;
the selected applicant's summary and the three decision buttons on the right, so the common
"pending → accept / reject" pass happens without opening every application.

**Checklist → design**
- Title, subtitle → page header.
- Acknowledgement backlog banner "{n} applicant(s) have not been told…", a toggle that narrows the
  table and adds "showing only these" → amber alert card with a **Show only these** button (same toggle).
- CRM backlog line "{n} application(s) never reached the CRM." → second alert card.
- `CrmBackfillPanel` (title, blurb, Preview, "Page {n}…" while running, "Send to {n} and backfill the
  rest" only after a preview with sends, "Backfill {n} threads" when sends = 0, counts line, confirm
  dialog before sending, raw result `<pre>`) → **Send everyone to the CRM** card under the decision
  panel, shown in its after-preview state.
- Status filter chips All/Pending/Reviewing/Accepted/Rejected/Disqualified with counts (in the URL) →
  segmented tabs with counts.
- Search (name, email, business, city) → search field.
- "{shown} of {total}" → queue header.
- Columns Applicant (name + business or email), Role, Location, Status, CRM (In GoHighLevel / Not
  forwarded), Submitted (+ "Not acknowledged" flag) → each queue row carries all of them.
- Row actions **Edit** (opens detail with `?edit=1`) and **Open application** arrow → both kept per row.
- Loading / load-failed / "No applications yet." / "No applications match this filter." → unchanged
  states (not drawn).

**Added:** the right-hand preview panel (role, experience, regions, standards, credentials count, "why
they want to join") and the Mark reviewing / Accept / Reject buttons there. They call the same actions
as the detail page; Reject opens the same reason picker. **Dropped:** nothing.

## 2. Application detail: `/admin/applications/:id`

**Idea.** The application reads as a two-column dossier; everything you *do* sits in a sticky
right rail: Decision, Applicant contact, CRM.

**Checklist → design**
- Back link, name, business · city/country, status pill, Edit button, "Edited by an admin on {date}" →
  header (crumb back-link, tags line, Edit top right).
- Decision: Mark reviewing / Accept / Reject (current one disabled) → Decision card.
- Reject form: "Why are you rejecting this?", six reasons, internal note, Confirm rejection
  (disabled until a reason), Cancel, "Choose a reason first." → shown open inside the Decision card.
- Result notice (ok / failed variants: status saved, published to directory, publish failed, applicant
  emailed, notify failed, address undeliverable, claim invite sent/failed, ack sent/failed variants,
  CRM resynced/failed, edit saved + directory/CRM refreshed/stale) → green/red banner under the header.
- **Invite to create account** + hint (accepted only) → Applicant contact card (drawn dimmed with
  "Appears once accepted").
- **Send acknowledgement / Send it again** + "Acknowledgement sent {date}" / "Never acknowledged…" →
  Applicant contact card.
- Disqualified note → banner position (not drawn; status here is Reviewing).
- CRM block: synced/pending text + **Send to CRM now / Send to CRM again** → CRM card.
- Sections: Basic information (email, phone links, business, location, portfolio, submitted in),
  Professional category (role, role other), Experience & operations (years, operates as, team size,
  project types), Credentials (answers + uploads with size, Download, "Preparing link…", sign-failed
  error, "No credentials uploaded."), Project history & references (Project n, details, homeowner
  reference, "No project history recorded."), Professional standards (3 yes/no), Future alignment
  (why join, what sets apart, ready early, video), Regional capacity, Final agreement → all present;
  category + experience share one card, capacity + agreement share one card.
- Edit mode (`ApplicationEditor`) → reached by Edit; not redrawn (form unchanged).
- Not found / loading → unchanged states.

**Added:** a one-line rail hint that Accept publishes and both decisions email the applicant (this is
what the code already does). **Dropped:** nothing.

## 3. Started Applications: `/admin/drafts`

**Idea.** A call list. Rows are grouped "Closest to done · call these first / Part way / Just started",
which is the existing progress-descending sort made visible; Email and Call are labelled buttons.

**Checklist → design**
- Title, subtitle → header.
- Not finished / Everyone filter → segmented control (drawn on Everyone so the "Applied" badge shows).
- Search (name, email, phone, source label) → search field.
- Row: name or email or "No name yet", Partner/Contractor source badge, role · email · phone,
  progress bar + %, updated date/time, "Applied" badge, Email (mailto, only when email), Call (tel,
  only when phone), Delete → all on each row; missing contact hides that button.
- Expand row → answers grid with field labels; unanswered fields faded "Not answered yet" → first row
  shown expanded.
- Delete → shared `ConfirmDelete` dialog (drawn on the Waitlist screen; same component).
- Loading / load-failed (migration 043) / empty / empty-filtered → unchanged states.

**Added:** the three progress bands (presentation only). **Dropped:** nothing.

## 4. Waitlist: `/admin/waitlist`

**Idea.** Two figures that are also the filters (All / Not forwarded), and a plain email list with an
explicit Email action.

**Checklist → design**
- Title, subtitle → header.
- All · {n} / Not forwarded · {n} chips → two stat tiles acting as the filter.
- Search by email → field in the list header.
- "{count} on the waitlist · {count} not forwarded to GoHighLevel" → list header.
- Columns Email (mailto), Lang, CRM, Joined; Delete → table; the email link is also offered as an
  **Email** button.
- Delete → `ConfirmDelete` ("Delete permanently", "This cannot be undone. You are about to delete …",
  Cancel / Delete, error line) drawn open over the page.
- Loading / load-failed (migration 031) / empty / empty-filtered → unchanged states.

**Added:** the Email button (same mailto as the link). **Dropped:** nothing.

## 5. Communications: `/admin/sequences`

**Idea.** A health line under the title (delivery on/paused, last background run), the two run
buttons top right, and the eight tabs as an underline bar. Each tab gets the layout its job needs:
a follow-up work queue, a measurement dashboard, journeys as step flows, a master/detail sequence
editor, a log table, a two-pane inbox, a WhatsApp console, and a settings form beside its checks.

**Page-level checklist**
- Title, help → header. **Preview due messages**, **Run due now** → header actions.
- Error banner, notice banner ("{checked} checked, {ready} ready. No email was sent." / "Sent …,
  failed …, queued … for follow-up") → green/red note under the health line (main view shows one).
- "Communication delivery is paused." + Settings link → amber pill in the health line.
- `CommunicationRunStatus` (last run time · status, "No background run recorded yet.", run failed,
  run stale) → health-line pill (failure/stale turn it red).
- Reminder preview `<details>` (recipient · step, subject, reason or "WhatsApp outreach paused") →
  collapsible card under the notice.
- Tabs: Needs attention · {n}, Tracking and recovery, Journeys, Sequences, Send log, Inbox, WhatsApp,
  Settings (+ `?tab=whatsapp`) → underline tabs.
- 30-second poll and refresh on focus → behaviour, not drawn.

**Needs attention (`communications-desktop.png`)**
- Human follow-up: filter All open / Assigned to me / Due now; order high priority then soonest due;
  card with name, email, phone, kind (Activation action / User reply / Delivery review), reason,
  project, attempts, next contact, note; Owner select + Save; note; When contact took place (hidden
  for Reschedule); Contacted / Awaiting reply / Reschedule; Next contact; **Record contact**, **Check
  and resolve**, **Contact history** (events list); error messages; "No open follow-up tasks…" →
  left column, first card expanded, the rest compact.
- Delivery problems · {n} (email — step failed {ago}: error; retried every hour) → red card.
- Emailed, waiting on them · {n}: Who (name, email, project), Journey, Waiting for, Last email
  (code · ago, n sent), Next ("next email in …", "no more emails"), empty "No one is mid-sequence." →
  right table; Journey folded under the name to fit.

**Tracking and recovery**: From/Through dates, Refresh conversations, "Results as of", seven ratio
cards (percent, completed / total, help) + median time to a connected project (+ coverage), coverage
line, Recovery after messages table, People table (search, journey, status filters; person/project,
current action + journey + state + entered/completed, last email + Open conversation, next email,
human follow-up + Contact history), pagination (Previous, "Page n · total", Next), Contact history
panel (refresh, status, help, when, note, kind, next contact, Record contact, events), Project tracking
list (origin, duplicate flag, connected/connecting); install/invalid-dates/load errors → all drawn;
the contact-history panel opens beside the table instead of below it.

**Journeys**: four journeys, each a horizontal flow of its stages; per stage Enabled/Paused, branch
text, step chips "code · On entry / Day n / n hours"; human-follow-up sentence; **Edit this journey**
(jumps to Sequences filtered); Message preview with language switch, example-only note, subject,
body, button + destination; empty journey text → all drawn. Branch stages are dashed.

**Sequences**: Journey filter, per sequence journey eyebrow, name, description, trigger and exit
events, in-progress count, On/Off, French missing, "Hand to a person after N days (blank = never)";
per step code · Step n, delay hours, after enrolling/previous step, channel select (legacy WhatsApp
disabled), Unsaved changes, remove, Subject EN/FR, Message EN/FR, Button label EN/FR, **Save step**
(disabled until edited), "Message changes saved." / newer-edits / save-failed notices; **Add step** →
master/detail: sequence list (with On/Off switches) on the left, selected sequence's steps as a
vertical timeline with EN and FR side by side; a missing FR body is highlighted.

**Send log**: When, Who, Email (code · subject or sequence key), Channel, Result (+ error, failed in
red), "Nothing sent yet." → table with status tags; the empty state is drawn below it for reference.

**Inbox**: Refresh conversations, error/notice, empty text, thread list (name, email, project, last
message time), thread email + project link, automation-paused box + Resume automatic reminders,
messages (Recipient / Groundwork team / Automated message · status, time, unverified warning, subject,
body, WhatsApp link to the WhatsApp tab, attachments), "Select a conversation.", "No messages…", Email
reply form (note, Your reply, help, Queue reply) → two-pane layout, bubbles left/right by direction.

**WhatsApp**: title/help; connection summary (enabled/off, test/live) and settings (phone-number ID,
account ID, display phone, messaging ID, audience, test phones, API version note, token / app secret /
verify token with Saved/Needed, Save connection); callback URL + help + challenge/signed-event state;
Generate verify token (token + help + Hide); Check connection and templates (notice); Pause/Enable
sending; templates section (timing, Export pack, catalog rows); Latest {n} outbound counts by status;
WhatsApp inbox (Refresh, contacts with Connected / Reminder consent needed / Needs attention /
Stopped, reply-window open/closed, stopped help, hold help + Review complete · resume reminders,
messages with sender kind · status · time, error, Review uncertain send form with finding, wamid,
note, confirm checkbox, Record delivery review; reply box with open/closed-window help, Send WhatsApp
reply; test-consent checkbox + Send Meta hello_world test) → config column left, console right.
The verify-token reveal box and the "No WhatsApp messages yet" empty state are not drawn.

**Settings**: sender name, welcome / follow-up / partner application sender, reply domain + help, test
recipients + help, default owner, default hours, Enable communication delivery, Save; last run
status; Email setup checks (help, Check email setup, checked time, six named checks with
Confirmed / Setup needed / Check incomplete and the reason line, failure message, acceptance note);
Incoming email needs attention (permission/failed + time) → form left, checks right. The enable
switch moves to the top of the form so the one setting that changes behaviour is first.

**Phone:** main view only: run buttons, paused pill, last run, scrolling tabs, follow-up queue,
delivery problems, waiting list.

**Added:** nothing new; layouts only. **Dropped:** nothing.

## 6. Quote Requests: `/admin/inquiries`

**Idea.** Matchmaking queue: requests on the left; on the right the introduction to be made, drawn
as Requester ⇄ Contractor asked for, with the pinned message, the status and the team notes.

**Checklist → design**
- Title, subtitle → header. Open · {n} / All · {n} (in the URL) → segmented control. Search (name,
  place, contractor, message) → field. Save error → banner position (not drawn).
- Row: contractor name (or "Contractor removed") · trade, requester · location · build · date,
  "account closed", status pill, message excerpt; select toggles `?inquiry=` → list rows.
- "Select a request to work on it." → right panel's empty state (not drawn).
- Detail: title + sub; Requester (link to homeowner / closed / not found; "Asked as …"); Contractor
  asked for (link or removed); Where; Build; Status buttons Open/Introduced/Declined/Closed with the
  meaning line (n other states / introduced means / settled means); Team notes + hint + Save /
  Saving…; Their conversations (channel · relative time, unavailable/empty, ownership note); Their
  projects (name · city, unavailable/empty); both hidden when the account is gone → all drawn.

**Added:** the pinned message repeated in the panel (so you can work without the list).
**Dropped:** nothing.

## 7. CRM: `/admin/crm`

**Idea.** Pipeline as a six-lane board (Waitlist, Signed up, Applied, Accepted, Not accepted,
Building, the order of `LANES`) under a sync-health strip; Setup & health becomes a checklist plus
the two queues and a "Checks and repairs" toolbox.

**Pipeline checklist → design**
- Tabs Pipeline / Setup & health → underline tabs.
- Unit note, unreadable-domain warning → under the health strip (warning labelled as conditional).
- Lane counts that filter on click → column headers with counts (click to filter).
- All stages + source chips Waitlist / Sign-up / Application, search → toolbar.
- Table columns Who (name or email or "No name given", email, country), Stage, Source, In stage ("{n}d"
  or "—" with the no-timestamp hint), CRM (In the CRM / Queued / Failed / Not sent / Unknown), Open
  (Project, Homeowner, Applications links, or "No account") → every card shows all of these; stage is
  the column. A **Board / List** switch keeps the original table as the List view.
- Loading / error / empty / empty-filtered → unchanged states.

**Setup & health checklist → design (`crm-setup-desktop.png`)**
- Configuration with mode badge (Using the API / webhooks / Not configured), nine rows with tick/cross,
  hint key, "from Supabase / from Vercel", stage map broken text, conversations token states,
  "Status unavailable." → left card.
- Token rejected banner (scopes / location / unreachable variants), off note → under the checklist.
- Syncs that need a human (email, defective record / never reached, reason, date; first 10) → red card.
- Backlog "Waiting to reach the CRM (n)" + **Send them now** + result notice + rows (event, date,
  email, last error · attempts; first 25), "Everything has reached the CRM." → card.
- Test a document upload + hint + result; Check custom fields → Create {n} missing → Remove {n}
  unusable (destructive) + hint + result; Test the email log + hint + ok/failed line; Audit the contact
  book → Repair phones / Delete duplicates (confirm) / Export {n} records first; Show pipeline & stage
  ids; audit hint + result → "Checks and repairs" card, two columns.

**Added:** the health strip on the Pipeline tab (connection mode, backlog count with Send them now,
failures count, record count), all read from data the page already loads, so problems show without
switching tabs. **Dropped:** nothing.

---

## Open questions / not placed
- The CRM pipeline cards only show the first few records per lane with "+ n more". The real board
  needs a scroll per column or a "show all" that switches to List; I have not decided which.
- Applications: the preview panel duplicates the detail page's decision buttons. If the owner would
  rather keep decisions on the detail page only, the panel can be read-only with just "Open application".
- Communications `Needs attention` shows priority "High" as a tag; the code only uses priority to sort.
  Showing it is a small addition.
- WhatsApp tab: the generated-verify-token reveal and the empty-inbox text are not drawn (they replace
  parts of the drawn state).
