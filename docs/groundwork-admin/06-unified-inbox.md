# 06 — Unified Inbox: design and scope note

*Phase 6, step 0. Read-only. Written 18 Sep 2026 against `ac4c505` (Phase 5 closed). No code, migration, RPC, UI or production change accompanies this document.*

## 0. What this note is

The Inbox is the fourth and last of the product's surfaces (IA 01 §1): **Overview** — what is happening · **Action Center** — what do I do · **Project Workspace** — this project · **Unified Inbox** — *what are people saying*. The 14 Sep meeting fixed the division of labour it lives inside: **GoHighLevel handles the communication channels** (WhatsApp, internal messages, email, calls); **Groundwork is the operational/project system**; and the lifecycle the Inbox exists to serve is *external contact → identified person → matched project → operational action or decision*.

This note establishes what the Inbox is, what it is built on, what is genuinely missing, and the order of work — so that every later step has a gate to be measured against. The rules that governed Phase 5 govern Phase 6 unchanged: real data only; unavailable ≠ error ≠ empty ≠ zero; every write ends at an existing (or reviewed) SECURITY DEFINER boundary and is followed by a re-read; one conversation store (IA 01 rule 4); the audit log is the single traceable record; nothing is decided in the UI that the database decides.

## 1. What exists today

**The conversation model is already there (091, live since 13 Sep).** `conversations` (`person_id?`, `project_id?`, `channel ∈ jalla|whatsapp|email|call`, `subject`, `status ∈ open|waiting_on_us|waiting_on_them|resolved`, `assigned_to`, `ghl_conversation_id` UNIQUE, `ghl_contact_id`, `last_message_at`); `project_messages` with `conversation_id`, `direction ∈ inbound|outbound|internal`, `channel`, `status`, `attachments`, `ghl_message_id` UNIQUE (085 — R1, inbound idempotency, is done); `decisions`; `support_tickets.conversation_id`. RPCs: `ensure_project_conversation`, `ensure_inbound_conversation` (service role), `send_message`, `assign_conversation`, `link_conversation`, `resolve_conversation`, `record_decision`, `confirm_decision`, `link_ticket`, `unanswered_conversations()` reading `app_config.unanswered_conversation_hours = 4` and the age bands. RLS: admin reads all; a person reads their own threads; project members read their project's; `internal` rows are staff-only.

**The GoHighLevel layer, as it actually behaves** (`api/ghl/*`, `api/_handlers/*`, 11 of 12 Vercel functions used):

| Direction | Path | What it does today |
|---|---|---|
| Groundwork → GHL | `crm-chat-mirror` (`project-message.ts`) | Every platform message on a project is mirrored onto the **owner's** GHL thread; the GHL conversation id is stamped on our `conversations` row. Internal notes are never mirrored. |
| GHL → Groundwork (staff reply) | `crm-delivery` (`conversation-delivery.ts`) | GHL is the conversation provider; **Groundwork is its email delivery provider.** A reply typed by staff in GHL is POSTed to us; we resolve the thread via `ensure_inbound_conversation`, file it as **`outbound`, channel `email`**, and send the email through Resend. Payload shape is from documentation — *unverified against a live account*. |
| GHL → Groundwork (anything else) | `crm-inbound` (`inbound.ts`) | **Records only.** Every webhook is written to `ghl_inbound_events` and nothing acts on it — by design, because the endpoint's authentication (shared header, no signature) is weaker than our other writes. |

**What that means in plain terms:** a message a *client or contractor* sends — on WhatsApp, by SMS, by email reply — reaches GoHighLevel and **never reaches Groundwork**. Only the platform chat (`jalla`) and staff's own GHL email replies exist as rows. There is no inbound path, and there is no call record anywhere.

**Production, read on 18 Sep 2026:** `conversations` 0 · `project_messages` 0 · `decisions` 0 · `support_tickets` 0 · `ghl_inbound_events` **0** (the webhook has never been called) · `ghl_outbox` 0 · `notifications` 34 · profiles with a GHL contact id **15** · contractor applications with one **31**. The communication layer is wired but has carried nothing yet.

**Already built on top of it (Phase 5):** the Workspace's project-scoped Conversations tab — thread list from `ws.conversations`, thread view via `listConversationMessages`, Send / Internal note, Assign / Resolve, Record Decision, realtime re-read. Its `Thread` component is the natural thing for the Inbox to reuse (§9, step 6.4).

**Sidebar entries waiting on this phase:** `/admin/inbox`, `/admin/whatsapp`, `/admin/email`, `/admin/calls`, `/admin/messages` (Jalla Messages), `/admin/notifications` — all honest placeholders today. IA 01 rule 4 already decided their fate: **WhatsApp, Email, Calls and Jalla Messages are channel filters on the one Inbox, not pages.**

## 2. What the Inbox is — and is not

**Is:** the list of every `conversations` row an admin may see, across projects and before projects, with the thread beside it and the operational context (person, project, GHL sync state) beside that; the place a communication becomes an action — a reply, an internal note, an assignment, a link to a project, a decision, a support ticket, an Action Center item.

**Is not:**
- **Support.** A ticket is a case with a lifecycle and an owner (memory: *support-ticket-meaning*). The Inbox can *create* one from a message and *link* one to a thread (`link_ticket`, exists); it does not replace `/admin/support`. Support's reply moves *into* the Inbox (IA 01 §3), the ticket does not.
- **Notifications.** The bell is Groundwork telling staff something; the Inbox is people telling Groundwork something. Separate stores, separate semantics; unchanged.
- **The GHL inbox.** GHL keeps every channel's native tooling (templates, calling, unmatched contacts, marketing). Groundwork shows the subset that has an identified person — and says so.
- **A second store.** No new message table. Calls, if represented, are `project_messages` rows with `channel = 'call'` (§3).

## 3. The channel reality

The IA names four channels. What each one *is* today, and what it would take:

| Channel | GHL provides | Reaches Groundwork today | Needed for the Inbox to show it | Confidence |
|---|---|---|---|---|
| **jalla** (platform chat) | mirror of our messages onto the owner's thread | ✅ both directions, end to end | nothing | proven |
| **email** | GHL conversations + our delivery provider | staff reply typed in GHL → `outbound` row ✅ · client email reply → **nothing** | act on inbound email events (§4 step 1) | delivery payload documented, never seen live |
| **whatsapp** | native WhatsApp conversations on the GHL number | **nothing** | same inbound path; outbound = GHL Conversations API message of type WhatsApp | payload shape unknown until a webhook arrives |
| **sms** | native SMS on the GHL number | **nothing**; and `sms` is **not in the 091 enum** | decision D1 | — |
| **call** | call events / voicemail / (paid) call summaries | **nothing** | a call is a message row (`channel = 'call'`, content = summary or "missed/answered · duration", `attachments` = recording link if any) | GHL event shape unknown |

The honest consequence: **the first Inbox will be populated by `jalla` threads and GHL email replies only**, because those are the two paths that exist. WhatsApp and calls appear the day their inbound events are acted on — and the first real webhook payload is what tells us the contract, exactly as `conversation-delivery.ts` already says about itself.

## 4. The communication lifecycle, mapped to what exists

The 14 Sep lifecycle, step by step, with each step's existing piece and its gap:

| Step | Exists | Gap |
|---|---|---|
| **1. A message arrives** (webhook) | `crm-inbound` records it; `ghl_inbound_events` holds it with `email` and `ghl_contact_id` | it is never acted on. The act: for an inbound-message event, resolve the person and call `ensure_inbound_conversation` + upsert the message (`direction = 'inbound'`, real channel, `ghl_message_id`). Lives inside the existing `crm-inbound` action — **no new Vercel function (11/12)**. Marks the thread `waiting_on_us` (091 trigger does this on an inbound insert — verify in 6.2). |
| **2. Identify the contact → person** | `profiles.ghl_contact_id` (15), `contractor_applications.ghl_contact_id` (31), email match (`ilike`), phone (E.164 helpers in `api/ghl/_phone.ts`) | an applicant is a *contact*, not an account; `ensure_inbound_conversation` refuses `no_person` for an unknown person. **Decision D2**: where does an unmatched or applicant-only thread live? |
| **3. Match to a project** | `link_conversation` (staff, audited); a person's threads show their projects | never silent. Rule: when the person owns exactly one non-archived project, the Inbox *offers* the link with one click; it does not auto-link. A thread with `project_id` set is the Workspace's; the Inbox shows the same row. |
| **4. Reply / note** | `send_message` (`outbound` / `internal`) | outbound must reach the person's channel: `jalla` needs nothing; **email/WhatsApp need the mirror to send the message on the conversation's channel** through the GHL Conversations API. Today the mirror only adds to the owner's thread as a "message we sent". Step 6.6, unverified. |
| **5. Assign · resolve** | `assign_conversation`, `resolve_conversation` | none. Staff list = admin role (as the Workspace does). |
| **6. Turn it into work** | `record_decision` (with source message) · `link_ticket` · Action Center `unanswered_conversation` rule (03 §5) | creating a **support ticket from a message** — the ticket create path exists in `lib/supabase/support.ts`; the Inbox composes it with `link_ticket`. No new RPC. |
| **7. Know it was seen** | nothing | **Decision D3** — an unread/seen state has no representation; without one the Inbox cannot say "3 new" honestly, only "waiting on us". |

## 5. Information architecture

One route, state in search params — the pattern the Workspace proved:

```
/admin/inbox?channel=<jalla|whatsapp|email|call>&status=<open|waiting_on_us|waiting_on_them|resolved>
            &assigned=<me|unassigned|userId>&project=<projectId>&conversation=<id>

┌ Filters ─────────────────────────────────────────────────────────────────────────────┐
│ All · Waiting on us · Mine · Unassigned      Channel: All · Groundwork · WhatsApp ·   │
│                                              Email · Calls                            │
├ List ────────────────────┬ Thread ─────────────────────────┬ Context ─────────────────┤
│ person · project · chan  │ messages, direction as stored   │ Person (name, email,     │
│ · status · last message  │ Send · Internal note            │  phone via GHL, account? )│
│ · assignee · waiting Nh  │ (the Workspace's Thread)        │ Project: linked → open   │
│                          │                                 │  workspace; else "Link…" │
│                          │                                 │ GHL sync: ids present /  │
│                          │                                 │  never mirrored          │
│                          │                                 │ Acts: Assign · Resolve · │
│                          │                                 │  Record decision ·        │
│                          │                                 │  Create support ticket    │
└──────────────────────────┴─────────────────────────────────┴──────────────────────────┘
```

- `/admin/whatsapp`, `/admin/email`, `/admin/calls`, `/admin/messages` **redirect** to `/admin/inbox?channel=…` — the sidebar keeps its items (IA §2), the placeholders go. `/admin/notifications` is not an Inbox concern and stays a placeholder until its own step.
- The Overview KPI "Active conversations" (`/admin/inbox?status=active`) resolves its one deferred exemption: `active` = `status <> 'resolved'`; the test that pins the exemption starts requiring the real page.
- Action Center's `unanswered_conversation` items deep-link to `?conversation=`.
- The Workspace's Conversations tab and the Inbox show **the same rows**; a project thread opened in either is one record. "Open in workspace" ↔ "Open in inbox" are the two ends of one link.
- Preview rule from the Overview applies to nothing here — the Inbox *is* the module; it paginates.

## 6. Data model: what may need a migration (093), and what must not

Additive only, each gated by a decision in §11; nothing here is assumed built:

- **D1 · `sms`** — if SMS is a channel Jalla uses, the `channel` CHECK gains `'sms'` on both tables (additive, reversible). If not, SMS events are filed under `whatsapp`? No — that would be a fabricated channel. Either add it or leave SMS in GHL.
- **D2 · person-less threads** — `conversations.person_id` is already nullable, but `ensure_inbound_conversation` refuses to *create* without a person. To hold an applicant's or a stranger's thread, the RPC would allow creation keyed on `ghl_contact_id` alone, with an admin-only SELECT (already the case: `admin_read_conversations`), and a `match_person` act later. Alternative: unmatched stays in GHL and the Inbox shows a count of "in GHL, not matched" from `ghl_inbound_events` — honest, and no schema change.
- **D3 · seen state** — smallest honest representation: `conversation_reads(conversation_id, user_id, last_read_at)` PK(conversation_id, user_id), admin-scoped, written by one RPC `mark_conversation_read`. Per staff member, because "unread" is a fact about a person, not a thread. Alternative for a first cut: no unread count at all; "waiting on us" (already derived) is the queue. **This note recommends the alternative for 6.x and the table only if the team asks for it in use.**
- **Calls** — no table: `project_messages` with `channel = 'call'`; `attachments` carries `{ duration_s, direction, recording_url?, summary? }` as the event supplied it. Nothing computed.
- **Not needed:** a second message store; a `read` flag on messages; a GHL mirror table; any provider state beyond what a webhook literally said.

## 7. Access and safety

- **RLS:** admin already reads everything in 091; nothing to add for the Inbox's reads. A person-less thread (D2) is admin-only by the existing policy shape.
- **Inbound acting** is the one place authority rises: today `crm-inbound` deliberately only records because its authentication is a shared header. Acting on a *message* event is lower-stakes than acting on an *application* event — it creates a thread row and a message row, nothing a person relies on — but it is still a write from a weakly authenticated source. Mitigations that stay inside the existing design: idempotency on `ghl_message_id` (done), `ghl_contact_id` must already be known to us (D2 decides how strictly), body size cap (exists), and the event row kept as the audit trail (`handled_at` stamped). This is the review point of step 6.2.
- **Outbound to a channel** (6.6) sends a real message to a real person: `send_message` records first, the mirror sends after, failure leaves `status = 'failed'` on the row and is shown as such — never silently "sent".
- **Vercel cap:** 11/12 functions. Every server-side piece of Phase 6 is an action inside `api/events.ts` or a database function. No new function.

## 8. The honesty rules, restated for communication

- A thread with no `ghl_conversation_id` says "never mirrored to GoHighLevel", not "synced".
- A message whose channel delivery is unknown shows no delivery state. `sent → delivered | failed` is written by something that knows, or not at all.
- Calls is an empty filter with an honest sentence until a call event has ever been recorded — IA 01 §8 decision 4 stands.
- "Waiting on us for 6 h" is derived by `unanswered_conversations()` from `app_config`; the Inbox never carries a threshold.
- No sample threads, no seeded conversations, no "example@…" contacts. Production has zero rows and the first screenshot will show zero rows.

## 9. Order of work — one gate each

| Step | Deliverable | Gate |
|---|---|---|
| **6.0** | this note | decisions D1–D5 answered |
| **6.1** | data decisions applied: 093 only if D1/D2/D3 require it; otherwise no migration | local PG16 proof · review · pre-flight · apply · verify |
| **6.2** | **inbound acting**: `crm-inbound` turns an inbound-message event into `ensure_inbound_conversation` + an `inbound` message row, idempotently; `handled_at` stamped; unmatched handled per D2. Includes a **payload capture** mode so the first real GHL event is recorded verbatim before anything is parsed from it. | local proof with synthetic events · review · deploy · one real event observed |
| **6.3** | `lib/supabase/inbox.ts` — `loadInbox(filters)` + pure `assembleInbox()`: rows, person/project context, waiting age from the RPC, GHL sync facts; fail-soft | fixture tests + production read (expect 0) |
| **6.4** | route `/admin/inbox` + list + thread + context panel; `Thread` extracted from the Workspace tab into `components/admin/conversations/` and used by both (the one Phase 5 file touched, as an extraction) | browser: empty state, deep links, filters, both themes, 4 widths |
| **6.5** | channel filters; sidebar redirects; Overview `active` exemption retired; Action Center deep links; Support "reply in Inbox"; create-ticket-from-message | browser + tests |
| **6.6** | outbound to a channel through GHL (email, WhatsApp) — the mirror sends on the conversation's channel; failure → `status = 'failed'` | **only after a live GHL payload has been seen**; one real send, observed |
| **6.7** | Phase 6 final audit, same ten checks as Phase 5 plus: no second store, no threshold in UI, inbound idempotency under replay | close |

Steps 6.3–6.5 can proceed on `jalla` threads and email replies while 6.2's first real event is awaited; nothing in them depends on WhatsApp existing.

## 10. Boundaries — what Phase 6 does not build

GHL inbox replacement · templates, campaigns, marketing automation · call audio playback or a dialer · SMS unless D1 says yes · translation of messages · AI drafting · read receipts to the client · any change to the client's project chat · Team tab (deferred from Phase 5, its own step) · Tasks, Issues, Inspections.

## 11. Decisions requested

1. **D1 — SMS.** Is SMS a channel Jalla staff use in GHL? If yes, 093 adds `'sms'` to both `channel` CHECKs. If no, SMS is out of scope and left in GHL.
2. **D2 — Unmatched and applicant-only contacts.** (a) Allow person-less threads keyed on `ghl_contact_id` (RPC change, admin-only) so applicants' WhatsApp/email arrives in Groundwork; or (b) Groundwork's Inbox shows identified people only, with an honest "N unmatched in GoHighLevel" count. *Recommendation: (b) first; (a) when the team has used the Inbox for a week.*
3. **D3 — Unread state.** Derived "waiting on us" only, or a per-staff `conversation_reads` table. *Recommendation: derived only for 6.x.*
4. **D4 — Calls.** Represent call events as `channel = 'call'` message rows as described, or keep Calls as an empty filter until the meeting's call-summary tooling is chosen. *Recommendation: represent them the moment GHL sends one; nothing before.*
5. **D5 — Support reply.** Move "reply to a ticket" into the Inbox now (6.5), or leave `mailto:` until the ticket has a person with a thread. *Recommendation: 6.5, because a ticket reply is a conversation and today it is untracked email.*

## 12. Files this phase would touch (for the record, none yet)

**New:** `docs/groundwork-admin/06-unified-inbox.md` (this) · `src/lib/supabase/inbox.ts` · `src/lib/admin/inbox.ts` (pure assembly + filter parsing) · `src/app/routes/admin/inbox.tsx` · `src/components/admin/conversations/{Thread,ConversationList,ContextPanel}.tsx` · `supabase/migrations/093_*.sql` only if D1–D3 require it · tests beside each.
**Modified:** `api/_handlers/inbound.ts` (act on message events) · `api/_handlers/project-message.ts` (send on the thread's channel, 6.6) · `src/components/admin/workspace/ConversationsTab.tsx` (use the extracted `Thread`) · `src/components/shell/nav-config.ts` (placeholders → redirects) · `src/app/routes.ts` · `src/lib/admin/overview-links.ts` + its test (the deferral retires) · `src/lib/i18n/{en,fr}.ts`.
**Untouched:** everything under `components/project/*`, the client chat, 084–092, `LedgerModal`, the Workspace's data model.

---

## 13. 6.1 — data foundation: outcome (18 Sep 2026)

**Decisions as settled (Favour, 18 Sep):** D1 SMS stays GHL-owned — *out of the first implementation, not ruled out forever*; no enum change. D2 identified people only; person-less threads not modelled. D3 derived "waiting on us" only; no `conversation_reads`. D4 calls are represented the moment a real inbound call event arrives, and not before. D5 support-ticket replies come into the Inbox at 6.5.

**Result: no migration 093.** Every decision is satisfied by 091 as it stands. 6.1 therefore re-inspected the model instead of changing it, and pinned the contract 6.2 will be written against (`conversations.test.ts`, "Phase 6.1"):

| 6.2 relies on | Where it lives | Verified |
|---|---|---|
| A thread for an identified person, keyed by GHL's ids, idempotent under concurrent delivery | `ensure_inbound_conversation` (advisory lock; conv id → contact id → person's newest open thread; refuses `no_person`) | ✅ |
| An inbound row is filed once, however many times the webhook is replayed | `project_messages_ghl_message_id_key` (085) + upsert on `ghl_message_id` | ✅ |
| Filing an inbound message moves the thread to `waiting_on_us`, stamps `last_message_at`, reopens a resolved thread | `messages_advance_conversation` (AFTER INSERT) | ✅ |
| The Action Center notices it after 4 h | `unanswered_conversations()` over `app_config` | ✅ (091) |
| Channel per message | `project_messages.channel ∈ jalla·whatsapp·email·call` | ✅ |

**One pitfall, now pinned:** `messages_default_conversation` (BEFORE INSERT) derives `direction` only when the writer left it NULL, and with no session and `origin = 'ghl'` the default is **`outbound`** — the correct answer for a staff reply typed in GHL, which is the only GHL-originated row that exists today. A client's message filed by 6.2 must therefore arrive with **`direction = 'inbound'` set explicitly**, or it will be recorded as something staff said. This is the single most important line in the 6.2 handler.

**What 6.2 will write, exactly** (no schema change): `ensure_inbound_conversation(person, ghl_conversation_id, ghl_contact_id, channel)` → upsert `project_messages { conversation_id, sender_id: null, sender_name, content, origin: 'ghl', direction: 'inbound', channel, ghl_message_id, ghl_synced_at }` on conflict `ghl_message_id` do nothing → stamp `ghl_inbound_events.handled_at`. Person resolution: `profiles.ghl_contact_id`, then `profiles.email` (`ilike`), in that order; an event with neither match is recorded, left unhandled, and counted — that count is D2(b)'s honest "N unmatched in GoHighLevel".

**Still unknown, deliberately:** the shape of a GHL inbound-message webhook. `ghl_inbound_events` has never received one (0 rows). 6.2 opens with a capture mode that stores the first real payload verbatim before a single field is parsed from it — the same stance `conversation-delivery.ts` takes about its own contract.

**Files touched in 6.1:** this section; `src/lib/supabase/conversations.test.ts` (+6 pins). Nothing else.

---

## 14. 6.2 — inbound acting: handler design for the authority gate (18 Sep 2026)

*Design only. Nothing below is implemented. This is the review that precedes wiring, because it is the one step in Phase 6 where a weakly-authenticated source gains the power to write a row a person will read.*

### 14.1 Exact handler design

One file changes: `api/_handlers/inbound.ts` (the existing `crm-inbound` action in `api/events.ts` — **no new Vercel function**, 11/12 stands). One pure module is added: `api/ghl/_inbound-message.ts` (a `_`-prefixed helper, not a function), unit-tested from `src/`.

```
crm-inbound (unchanged first half)
  ├─ method / secret / size checks             ← as today
  ├─ INSERT ghl_inbound_events { event_type, email, ghl_contact_id, payload }   ← as today, always, first
  └─ NEW second half, runs only if the insert succeeded:
       mode = ghlSettings().GHL_INBOUND_ACT            (app setting, default OFF = capture mode)
       if mode is off → respond 200 { received, acted: false, reason: 'capture' }   (today's behaviour)
       parsed = parseInboundMessage(payload)           (pure; null unless the shape is one we declared)
       if parsed is null → 200 { acted: false, reason: 'not_a_message' | 'malformed' }
       if parsed.channel not in ENABLED_CHANNELS → 200 { acted: false, reason: 'channel_disabled' }
       person = resolvePerson(db, parsed)              (§14.3)
       if person is null → 200 { acted: false, reason: 'unmatched' }
       conversationId = rpc ensure_inbound_conversation(person, parsed.conversationId, parsed.contactId, parsed.channel)
       upsert project_messages { …, direction: 'inbound' } ON CONFLICT (ghl_message_id) DO NOTHING
       UPDATE ghl_inbound_events SET handled_at = now() WHERE id = <the row inserted above>
       respond 200 { acted: true, filed: inserted | duplicate }
```

The response body is for logs only; GHL ignores it. **Every non-2xx keeps today's meaning** — "we could not even record it, send it again" — so acting never turns a stored event into a retry storm.

### 14.2 Payload capture strategy

`ghl_inbound_events` has received **zero** events. The contract is therefore established in this order, and the code enforces the order:

1. **Capture.** `GHL_INBOUND_ACT` is off. The webhook is configured in GoHighLevel; every event is stored verbatim in `payload` (as today). No parsing, no writes beyond the event row.
2. **Inspect.** The first real events are read from `ghl_inbound_events` in the SQL editor (or `crm-diagnose`). What GHL actually sends — `type`, `messageType`, `direction`, `contactId`, `conversationId`, `messageId`, `body`, `attachments`, `dateAdded` — is written down in §14.2a below **from the captured rows, not from documentation.**
3. **Declare.** `parseInboundMessage()`'s field map is finalised against those rows and pinned by a fixture test whose fixture **is the captured payload** (ids redacted).
4. **Act.** `GHL_INBOUND_ACT` is turned on. The first acted event is observed end to end (event row → `handled_at`, thread row, message row).

*Captured payloads are personal data* (authority gate, 18 Sep): they stay in `ghl_inbound_events` and are inspected only to define the parser; they are **not** copied into source-controlled fixtures. The parser's fixture is a *sanitised* payload — same keys, redacted values — and the note keeps the distinction between real captured evidence and that fixture explicit. No fixture is ever presented as a production event.

*§14.2a — captured contract:* **empty until step 2.** The parser ships in capture mode with a *provisional* map from GHL's public webhook documentation (`type = 'InboundMessage'`, `messageType ∈ SMS|Email|WhatsApp|…`, `direction`, `contactId`, `conversationId`, `messageId`, `body`, `attachments[]`, `dateAdded`) — tolerant, and marked provisional in code — but **nothing is filed until the captured payload confirms it.** No synthetic event is ever sent to production to "test the path".

### 14.3 Person resolution — exactly the approved sequence

```
1. profiles WHERE ghl_contact_id = parsed.contactId          (index 050)
2. else, if the payload carries an email: profiles WHERE email ILIKE <email>
3. else → null
```

`contractor_applications.ghl_contact_id` is **not** consulted (D2: identified *people* only — an applicant is a contact, not an account; their thread stays in GHL). A null result files nothing.

### 14.4 Exact database writes

| # | Write | Actor | Idempotent by |
|---|---|---|---|
| 1 | `INSERT ghl_inbound_events` | service role (as today) | not idempotent — one row per delivery, on purpose: the event log is the audit of what GHL sent, replays included |
| 2 | `SELECT ensure_inbound_conversation(person, ghl_conversation_id, ghl_contact_id, channel)` | service role (the only role granted) | advisory lock + `ON CONFLICT DO NOTHING` on `ghl_conversation_id` (091) |
| 3 | `INSERT project_messages { conversation_id, sender_id: NULL, sender_name, content, origin: 'ghl', direction: 'inbound', channel, status: 'sent'?, attachments, ghl_message_id, ghl_synced_at, created_at: dateAdded }` … `ON CONFLICT (ghl_message_id) DO NOTHING` | service role | 085 unique index |
| 4 | `UPDATE ghl_inbound_events SET handled_at = now() WHERE id = <row from 1>` | service role | naturally |

**Hard invariant (authority gate, 18 Sep):** `handled_at` is never written until write 3 has *returned successfully* — inserted or duplicate. If filing fails the event stays NULL, GHL retries, the retry files it, and only then is it stamped. An 085 conflict is a success: the message exists, the event is handled.

Nothing else is written. **No** `conversations.status` update, **no** `last_message_at`, **no** notification insert — the 091 AFTER trigger moves the thread (inbound → `waiting_on_us`, stamps `last_message_at`, reopens), and the Action Center's `unanswered_conversation` rule notices it after 4 h. Duplicating any of that in TypeScript is forbidden.

`status`: left NULL so the BEFORE trigger sets `'sent'`; for an inbound message "sent" is the honest word (it was sent to us). `created_at`: GHL's `dateAdded` when present, so the thread reads in the order things happened; else default `now()`.

### 14.5 Idempotency

- **Same event delivered twice by GHL** → two `ghl_inbound_events` rows (the log), one conversation (091 lock), **one** message (085), `handled_at` stamped on both event rows. Write 3 reports `duplicate` and the handler treats it as filed.
- **Same message arriving via two paths** — not possible today: `crm-delivery` files staff replies (`outbound`), `crm-inbound` will file client messages (`inbound`); an `OutboundMessage` webhook, if GHL sends one, is `not_a_message` for this handler (§14.8) precisely so the delivery path stays the only writer of outbound rows.
- **Handler re-run against a stored event** (a future replay tool) → identical outcome; the thread does not move twice because the trigger fires only on a real insert.

### 14.6 Transaction and error behaviour

Writes 2–4 are three statements, not one transaction (PostgREST). The failure modes, in order:

| Fails | State left | Consequence |
|---|---|---|
| 1 (event insert) | nothing | 500 → GHL retries (today's behaviour) |
| 2 (resolver) | event row, unhandled | 200 `acted:false, reason:'no_conversation'`; the event is visible as unhandled and can be re-run |
| 3 (message upsert) | event row + thread, no message | same; a thread with no message is harmless and the re-run finds it |
| 4 (`handled_at`) | everything filed, event looks unhandled | re-run → `duplicate` → stamps it. Never double-files. |

Errors are logged with the event row id, never with the body (it is already in the row). No error path fabricates a row; no error path swallows a 500 that GHL should retry.

### 14.7 Unmatched people

Event recorded (write 1), **no thread, no message, `handled_at` stays NULL**, response `reason: 'unmatched'`. The honest count for D2(b) is derivable without a schema change: *message-type events with `handled_at IS NULL` whose `ghl_contact_id`/`email` match no profile* — computed at read time by the 6.3 loader from `ghl_inbound_events` + `profiles`, shown as "N in GoHighLevel, not matched to a Groundwork account". No unmatched-person entity, no anonymous thread.

### 14.8 Malformed and non-message payloads

`parseInboundMessage()` returns `null` — and the handler files nothing — when: `type` is not the declared inbound-message type; `direction` is not inbound; `messageId`, `contactId` or `body` is missing or not a string; `body` is empty after trim; `messageType` maps to no 091 channel. All such events are still recorded (write 1) with `handled_at` NULL and a logged reason. **SMS** maps to `channel_disabled` under D1 — recorded, counted, not filed; the enum is untouched. The parser is pure and fully unit-tested against: the provisional documented shape, each missing field, an outbound event, an unknown type, an SMS event, a WhatsApp event, an email event, a body of whitespace, an attachments array.

### 14.9 Replay of the same event

Covered by §14.5: a second `ghl_inbound_events` row, no new thread, no new message, no thread state change, both event rows stamped. Proven locally (§14.13) by posting the same payload twice and asserting row counts.

### 14.10 How `handled_at` is set

Only by write 4, only after write 3 returned (inserted or duplicate). **`handled_at` means "filed into Groundwork" and nothing else.** Unmatched, malformed, disabled-channel and non-message events keep NULL, and the loader tells them apart by `event_type`/payload at read time. *Optional, not recommended now:* a 093 adding `ghl_inbound_events.outcome text` + `conversation_id uuid` would make those reasons queryable without re-parsing; deferred until the loader shows the derivation is too slow or too opaque.

### 14.11 Security and the service-role boundary

- Authentication stays the shared `X-Groundwork-Secret` in constant time, body cap 64 KB. A `locationId` check is added **only once the captured payload shows GHL supplies one** — its absence is not guessed into a security contract before then.
- The handler holds the service role exactly as today, for the existing 091 service-role function and for the inbound message insert. **The service role bypasses RLS, so RLS protects none of these writes.** Authorisation is enforced by the webhook secret, payload validation, the location check (once the captured payload shows GHL supplies one), identified-person resolution, idempotency, and the narrow set of permitted writes — that list, not a policy, is the boundary. *(Amended at the authority gate, 18 Sep.)*
- What acting can cause, at worst, from a forged request with a leaked secret: a message row on an *existing, identified* person's thread, marked `origin = 'ghl'`, idempotent, and visible in the event log with the raw payload. It cannot create a person, accept an application, move money, or touch a stage. That bound is what makes the authority rise acceptable — and `GHL_INBOUND_ACT` off is the kill switch.

### 14.12 Existing functions that must change

| File | Change |
|---|---|
| `api/_handlers/inbound.ts` | the second half (§14.1); the first half untouched |
| `api/ghl/_config.ts` | one new setting `GHL_INBOUND_ACT` (default off), read like the others |
| `api/_handlers/crm-status.ts` | report the setting so the Overview's GHL card can say "inbound: capture" / "inbound: acting" honestly |
| *new* `api/ghl/_inbound-message.ts` | the pure parser |
| *new* `src/lib/email/…` or `src/lib/ghl/inbound-message.test.ts` | parser unit tests + a static test that the handler sets `direction: 'inbound'`, stamps `handled_at` only after the upsert, and never touches `conversations` directly |

No migration. No RPC change. No change to `conversation-delivery.ts`, `project-message.ts`, the client chat, or any Phase 5 file.

### 14.13 Production-readiness risks

1. **The payload is unknown** — mitigated by capture mode as the default; nothing acts until a real event has been read and pinned as the fixture.
2. **Direction default** — a filed message without explicit `direction: 'inbound'` becomes `outbound`. Pinned in 6.1; the static test in 6.2 fails if the literal is absent.
3. **Contact ≠ person** — 31 applications and 15 profiles carry contact ids; a message from an applicant is unmatched by design (D2). The unmatched count will not be zero and must not be read as a bug.
4. **GHL retries and ordering** — events may arrive twice or out of order; idempotency covers twice, `created_at = dateAdded` covers order.
5. **`crm-delivery` overlap** — an outbound event reaching this handler is ignored (§14.8); the delivery path remains the sole writer of outbound rows.
6. **Local proof before deploy** — the handler is exercised on the local PG16 stack with a synthetic *local* payload (never sent to production): match by contact id, match by email, unmatched, malformed, SMS, WhatsApp, email, replay ×2 — asserting event/thread/message row counts and thread status after each.
7. **Rollout** — deploy with `GHL_INBOUND_ACT` off (no behaviour change), configure the GHL webhook, capture, inspect, pin, then turn on. Rollback is the setting.

**Gate to pass before implementation:** the thirteen points above accepted, or amended.

## 15. 6.2 — inbound acting: implementation outcome (18 Sep 2026)

Built exactly as §14 with the three gate amendments. **Held at the implementation gate; not committed; production unchanged and capture-only.**

### 15.1 What changed

| File | Change |
|---|---|
| `api/ghl/_config.ts` | `GHL_INBOUND_ACT` added to `GHL_KEYS`. Read like every other key: `app_config` first, environment second. Anything but `'on'` is capture. |
| `api/ghl/_inbound-message.ts` | *new, pure, no I/O.* `parseInboundMessage` (provisional documented map, read tolerantly; refuses `not_a_message` / `not_inbound` / `malformed` / `channel_disabled`), `resolvePerson` (contact id, then email ILIKE, nothing else), `inboundMessageRow` (the one row written — `direction: 'inbound'` literal, `origin: 'ghl'`, `sender_id: null`, `created_at = dateAdded` when parseable). |
| `api/_handlers/inbound.ts` | Event insert now returns its id (500 if it cannot). Then, only when acting: parse → person → `ensure_inbound_conversation` → one `project_messages` upsert on `ghl_message_id` (`ignoreDuplicates`) → `handled_at`. Every acting branch answers 200 with a `reason`; only "could not record" (and an unexpected throw) is 500, which is GHL's retry and is idempotent. |
| `api/_handlers/crm-status.ts` | Reports `inboundMode: 'capture' | 'acting'` — a word, not a tick. No UI reads it yet (6.5). |
| `src/lib/ghl/inbound-message.test.ts` | *new.* 19 tests: parser cases, resolver order, the row, and static pins on the handler (statement order; `handled_at` after the upsert with the failure branch returning between; no `conversations`/`notifications` writes; no 5xx inside the acting section; no `locationId` check yet; still the `crm-inbound` action, no new function). The fixture is the documented shape with placeholder values — **not a captured payload**. |
| `src/lib/supabase/conversations.test.ts` | The 6.1 "records only" pin is now "records first, acting is behind the setting" — the detailed pins moved to the file above. |

No migration. No RPC change. `conversation-delivery.ts`, `project-message.ts`, the client chat and every Phase 5 file untouched. `api/events.ts` untouched (function count unchanged: 11 of 12).

### 15.2 Local proof (PG16 harness `gw62`, 001–092 applied, run as `service_role`)

The handler's exact statement sequence was replayed with the real bundled parser against the local cluster — 15 scenarios, all passing:

| # | Scenario | Result | events / handled / threads / messages |
|---|---|---|---|
| 1 | capture mode (production today) | `reason: capture` | 1 / 0 / 0 / 0 |
| 2 | WhatsApp, matched by `ghl_contact_id` | `filed: inserted` | 2 / 1 / 1 / 1 |
| 3–4 | same `messageId` replayed twice | `filed: duplicate` ×2 | 4 / 3 / 1 / 1 |
| 5 | second message, same contact | `inserted`, same thread | 5 / 4 / 1 / 2 |
| 6 | email, matched by email fallback (mixed case, ILIKE) | `inserted`, new thread | 6 / 5 / 2 / 3 |
| 7–8 | unknown contact, no / unknown email | `unmatched`, `handled_at` NULL | 8 / 5 / 2 / 3 |
| 9 | SMS | `channel_disabled` | 9 / 5 / 2 / 3 |
| 10 | empty body | `malformed` | 10 / 5 / 2 / 3 |
| 11 | `AppointmentCreate` | `not_a_message` | 11 / 5 / 2 / 3 |
| 12 | `OutboundMessage` (staff reply echo) | `not_inbound` | 12 / 5 / 2 / 3 |
| 13 | **message insert fails** | `insert_failed`, **`handled_at` NULL**, no thread change | 13 / 5 / 2 / 3 |
| 14 | GHL retries #13 | `inserted`, handled | 14 / 6 / 2 / 4 |
| 15 | inbound onto a thread staff had resolved | `inserted`; 091 reopened it to `waiting_on_us` | 15 / 7 / 2 / 5 |

After the run: both threads `waiting_on_us` with `last_message_at` set by 091's AFTER trigger (the handler issued no statement against `conversations`); every filed row `direction = inbound`, `origin = ghl`, `sender_id NULL`, `created_at` = GHL's `dateAdded`; `authenticated` cannot call `ensure_inbound_conversation` (permission denied), `service_role` can.

**Counter-proof of the hard invariant** (rolled back): the same row inserted *without* `direction` — 091's BEFORE trigger derived **`outbound`**. That is why the literal is pinned.

### 15.3 Gate

`vitest`: 67 files, 1105 tests, all passing. `tsc --noEmit`: clean. `git diff --check`: clean.

### 15.4 Production state

`GHL_INBOUND_ACT` is set nowhere — not in `app_config` (no application path writes that table; the key did not exist before today), not in any environment. `ghl_inbound_events` still has 0 rows; no event was fabricated or injected. The webhook, once deployed, behaves exactly as before: record and answer `{received: true, acted: false, reason: 'capture'}`.

Next after this gate (§14.2 step 2, not started): configure the GHL webhook → capture → read the first payload in the table → correct the parser and replace the fixture with a redacted copy → then, and only then, consider `GHL_INBOUND_ACT = 'on'`.

### 15.5 Gate verdict (18 Sep 2026): code PASS — production acting HOLD

**Implementation approved. Enabling `GHL_INBOUND_ACT` is not approved**, and is conditional on one amendment:

*No acting until the location/account check is resolved from a real payload.* The handler deliberately validates no `locationId` today because no inbound payload has ever been observed; that is acceptable for capture-only. Before the setting is ever turned on, a real captured event is inspected to establish whether GHL supplies a trustworthy location/account identifier. If it does, the acting sequence becomes *authenticate → validate location → parse → resolve person → file*. If it does not, the threat model is reassessed at a fresh authority gate before acting is considered. No field name, id or validation mechanism is invented ahead of the payload.

The documented-shape fixture remains a parser-development aid, not evidence of the production shape.

**Rollout, unchanged and binding:** capture-only production → a real inbound event arrives → inspect the actual payload → sanitised fixture → confirm field map and location/account semantics → update parser and tests → authority review → only then consider `GHL_INBOUND_ACT = 'on'`.

**Next gate is production capture and payload inspection, not 6.3.** It brings back: the sanitised payload shape; the actual type/direction/channel fields; the actual contact and conversation identifiers; the actual location/account identifier if supplied; the parser mapping; the security validation decision; the updated tests.

## 16. First real inbound event (18 Sep 2026) — findings, and the identity gap

### 16.1 What was captured (as reported from the Supabase SQL editor; the row itself is personal data and stays in the table)

The GHL workflow *Customer Replied → Webhook* fired and `crm-inbound` recorded one row, `handled_at = NULL`. The payload is the **workflow Webhook action's contact-centric shape**, not the Marketplace `InboundMessage` event the provisional parser was written against:

| Present | Absent |
|---|---|
| `location.id`, `location.name` (`Groundwork by Jalla`) | any `messageId` / `message.id` |
| `contact_id` | any `conversationId` |
| `message.body`, `message.type` (`19`) | `type` / `event` / `direction` / `dateAdded` |
| contact fields (email, phone, first/last name) | any field named `*event*`, `*webhook*` |
| custom fields `Project Id`, `User Id`, `Application Id` | |

`message.type` is numeric here; GHL's public enum lists `19` as `TYPE_WHATSAPP` — to be confirmed against the channel the test was sent from, not assumed. **The provisional parser would refuse this payload as `malformed: no type`** — which is exactly what capture-first was for; it is corrected at the next step, not before.

### 16.2 What the capture path keeps and drops

[`api/_handlers/inbound.ts`](../../api/_handlers/inbound.ts) stores `payload: req.body` and nothing else. Request headers are read only for `x-groundwork-secret` and are **not stored**; `req.query` (only `action`) and the method are not stored. So there is **no evidence either way** about whether GHL puts an identifier in the request headers — the code never looked. Storing headers would have to exclude `x-groundwork-secret`, `authorization` and `cookie`.

### 16.3 The gap, stated plainly

Location and contact identity are established; **message identity and conversation identity are not**. The 085 idempotency key (`ghl_message_id`) and the 091 thread key (`ghl_conversation_id`) have nothing to bind to in this payload. A key manufactured from contact + body + time is not idempotency (identical legitimate messages; retries with different timestamps) and is rejected.

### 16.4 Legitimate sources of an identifier — for the authority gate, none implemented

1. **GHL workflow custom data.** The Webhook action accepts custom key/value fields populated from the trigger's merge fields. Whether *Customer Replied* exposes a message id or conversation id merge field is a fact to be read from the GHL merge-field picker, not assumed. If it does, the identifier arrives in the payload and the design holds unchanged.
2. **Capture the request headers once** (sanitised) to answer the header question with evidence. Needs either a `headers` column (a migration — 093 is currently taken by unrelated in-progress work) or a reserved key inside `payload`.
3. **Look the ids up at act time.** `ensureConversation(cfg, contactId)` in [`api/ghl/_client.ts`](../../api/ghl/_client.ts) already resolves a contact's GHL conversation id via `/conversations/search`; a subsequent `/conversations/{id}/messages` read would expose message ids. This makes the act path depend on the GHL API being reachable and on matching the webhook to a listed message, which is a threat-model and reliability change, not a parser fix.

**Position:** `GHL_INBOUND_ACT` stays off; no 6.3; the parser is not rewritten until the identity source is decided. Decision requested: which of 1–3 (or an explicit "GHL provides no stable id; redesign the idempotency boundary") the acting path is built on.

### 16.5 Decision (18 Sep 2026): 1 → 2 → 3, in that order

Option 1 first — read the *Customer Replied → Webhook* action's merge-field picker in GHL for a message/conversation identifier; nothing assumed from documentation. If found: pin the real workflow payload shape, update the parser to it, map the identifier onto 085 (`ghl_message_id`) and 091 (`ghl_conversation_id`) unchanged, tests from a sanitised copy of the real payload, local harness re-run, security boundary re-inspected, then and only then consider acting. If not found: Option 2 — capture a sanitised header subset once (never `x-groundwork-secret`, `authorization`, `cookie`), with a migration numbered from the repository's actual state at that time (093 is occupied; not reused). Option 3 last, and only as an explicit redesign of the identity/idempotency boundary. `GHL_INBOUND_ACT` stays off; 6.3 does not start.

### 16.6 Option 1 result (18 Sep 2026): no identifier exists in the workflow webhook

Read from the GHL *Customer Replied → Webhook* action's Custom Data merge-field picker (screenshots, 18 Sep): the **Message** group offers exactly *Message Body*, *Message Subject*, *Message Attachments*. There is no **Conversation** group. The remaining groups — Contact, Company, User, Appointment, Calendar, Account, Right now, Phone Call, Client Portal Contact, Attribution, Voice AI, Conversation AI, Custom Values — carry no message or conversation identifier. **The workflow webhook cannot be configured to send a stable message id or conversation id.** Option 1 is closed.

Operational note: the header value was visible in a screenshot shared during this check; the inbound secret is to be rotated (app_config + GHL header) before anything else.

### 16.7 Option 2 — design for the gate (nothing implemented)

**Question it answers, once:** does the HTTP request GHL sends carry an identifier outside the JSON body?

**Change:** `ghl_inbound_events` gains one nullable column `request jsonb` holding `{ method, query, headers }` where `headers` is the request's headers **minus** `x-groundwork-secret`, `authorization`, `cookie`, and any header whose name contains `secret`, `token` or `key`; values truncated to 512 chars; whole object capped at 8 KB. Written in the same insert as `payload` — still record-only, before the acting gate, no behaviour change. Migration numbered from the repository's actual state at implementation time (today the tree holds an untracked, unapplied `093_application_edit_audit.sql` belonging to other work; this would be **094**, and must not depend on 093).

**Reading the answer:** Vercel adds its own headers (`x-vercel-id`, `x-forwarded-for`, `x-real-ip`, …) — those identify *our* edge request, not GHL's message, and must not be mistaken for an id. Only a header GHL itself sets (a request id, event id, or signature) counts. `user-agent` and `content-type` are expected and tell us nothing about identity.

**Tests:** static pin that the secret header can never reach the insert (the filter is applied before the row is built); unit test of the filter on a fixture header set. Local harness: insert with the new column.

**Alternative rejected:** a temporary `console.log` of headers into Vercel runtime logs — ephemeral, and still a deploy. The column is durable evidence and stays useful as the request audit for every future event.

**If Option 2 also yields nothing,** GHL provides no stable identifier for this trigger, and the acting path is a redesign of the identity/idempotency boundary (Option 3 territory — act-time lookup through the Conversations API, or a different trigger source such as the Marketplace `InboundMessage` webhook, which the earlier design note was written against and which does carry `messageId`/`conversationId`). That is an authority decision, not a parser fix.

### 16.8 Option 2 — implemented, held at the gate (18 Sep 2026)

Approved with the amendment: headers are identity-focused — client-IP headers (`x-forwarded-for`, `x-real-ip`, `forwarded`, `cf-connecting-ip`, `true-client-ip`), `user-agent` and `content-type` are dropped alongside the secret, `authorization`, `cookie` and any `*secret*`/`*token*`/`*key*` name. Values cut at 512 chars, object at 8 KB.

| File | Change |
|---|---|
| `supabase/migrations/094_inbound_event_request.sql` | `ALTER TABLE ghl_inbound_events ADD COLUMN IF NOT EXISTS request JSONB` + column comment. Additive, nullable, no default, re-runnable, independent of 093. |
| `api/ghl/_inbound-request.ts` | *new, pure.* `requestMeta(req)` → `{ method, query, headers }` sanitised as above; the same names are dropped from the query string; odd input never throws. |
| `api/_handlers/inbound.ts` | The event insert now carries `request: requestMeta(req)` beside the unchanged `payload: body`, still before the `GHL_INBOUND_ACT` gate. If PostgREST reports the column unknown (`PGRST204` — 094 not yet applied) the insert is retried without it: capture never fails on evidence-gathering. `req.headers` is read in exactly one other place — the secret check. |
| `src/lib/ghl/inbound-request.test.ts` | 13 tests covering the eleven gate points: payload unchanged; column nullable; secret / authorization / cookie / `*secret*|*token*|*key*` / client-IP / user-agent / content-type never stored; 512-char and 8 KB caps; write before the gate; capture-only (no new conversation/message write, the one 6.2 upsert unchanged); migration is 094, additive, no 093 dependency. |

**Local proof** (harness rebuilt from scratch — 001–092 in production order, then 094): 17/17 — the real workflow-webhook shape is recorded with its request in capture mode and, were acting on, is refused by the provisional parser as `malformed: no type` with nothing filed; the nine 6.2 scenarios (documented shape) behave exactly as before; the stored request for a Vercel-shaped request keeps `host`, `accept`, `x-vercel-id`, `x-forwarded-proto` and a hypothetical vendor header, and contains no secret, no IP, no user-agent, no content-type; `payload` is byte-identical. On a copy of the database **without** the column, all nine scenarios still record (fallback taken).

Gate: 68 files / 1118 tests, `tsc` clean, `git diff --check` clean. Uncommitted. `GHL_INBOUND_ACT` off; 6.3 blocked.

**Deploy order when approved:** rotate the secret (both places) → apply 094 in Supabase → deploy → send one real message → read `request` from the newest row (Supabase SQL editor; service role only) → identity decision (§16.7 last paragraph). Don't count `x-vercel-*`, `x-forwarded-*`, `host`, `accept` as GHL identity.

### 16.9 Option 2 result (18 Sep 2026): no GHL-issued identifier in the request either

Production sequence completed: secret rotated, 094 applied, capture-only handler deployed, one real message sent. The newest event (08:55:50 UTC) carries `request`. Its 25 headers, in full: `accept`, `accept-encoding`, `connection`, `content-length`, `host`, `x-forwarded-host`, `x-forwarded-proto`, `x-invocation-id`, and seventeen `x-vercel-*` (`deployment-url`, `enable-rewrite-caching`, `forwarded-for`, `id`, `ip-as-number`, `ip-city`, `ip-continent`, `ip-country`, `ip-country-region`, `ip-latitude`, `ip-longitude`, `ip-postal-code`, `ip-timezone`, `ja4-digest`, `proxied-for`, `proxy-signature`, `proxy-signature-ts`). Every one is a standard client header or added by Vercel's edge (`x-vercel-proxy-signature` is Vercel's, not GHL's). **GoHighLevel's workflow webhook sets no header of its own** — no request id, event id or signature. Query string: `action=crm-inbound` only.

**Options 1 and 2 are closed.** The workflow webhook — body, configurable fields, and request — carries no stable message, conversation or event identity. 094 stays as the request audit; it is not asked to do more, and no idempotency key is manufactured.

**Sanitiser gap found by the evidence, and fixed.** The amendment excluded client-IP headers by the five conventional names; Vercel spells them `x-vercel-forwarded-for` / `x-vercel-proxied-for` and adds geo (`x-vercel-ip-*`), a TLS fingerprint (`x-vercel-ja4-digest`) and its proxy signature. Those reached the stored row (the IP is GHL's Google Cloud egress, `104.198.20.240`, not a person's — still the excluded class). `_inbound-request.ts` now drops every `x-vercel-*`, `x-invocation-id`, and any name containing `forwarded`/`proxied`/`real-ip`/`client-ip`; the tests carry the real header names with placeholder values; of a real Vercel request only `accept`, `content-length`, `host` survive. Local proof 19/19; 1119 tests; `tsc` and `diff --check` clean. **Not yet deployed** (uncommitted). Recommended production tidy-up, Favour's call, one statement:

```sql
update ghl_inbound_events
   set request = jsonb_set(request, '{headers}',
         (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
            from jsonb_each(request->'headers') as h(k, v)
           where k not like 'x-vercel-%' and k not like 'x-forwarded-%' and k <> 'x-invocation-id'))
 where request is not null;
```

### 16.10 The identity decision — authority gate

The trigger source in use cannot carry identity. The choice is now explicit:

| | **A. Marketplace `InboundMessage` webhook** | **B. Act-time lookup via the Conversations API** |
|---|---|---|
| Identity | GHL-issued `messageId`, `conversationId`, `contactId`, `locationId`, `direction`, `messageType`, `dateAdded` in the event itself (the shape the provisional parser was written against — still to be confirmed from a real capture, never assumed) | None in the webhook; Groundwork calls `/conversations/search?contactId` (existing `ensureConversation`) then `/conversations/{id}/messages` and picks the message it believes the webhook meant |
| Idempotency | 085 as designed: `ghl_message_id` | Must be redesigned: matching on body + time window, ambiguous for identical texts and bursts; retries and out-of-order arrivals need their own rules |
| Reliability | One HTTP call in; no dependency on GHL's API at file time | Two API calls per event; GHL API down = nothing filed; rate limits |
| Security | Marketplace webhooks are signed (public-key signature) — stronger than the shared header secret | Unchanged shared-secret boundary, plus a token with conversation read scope in the act path |
| Prerequisites | The Marketplace app's Conversations token is expired (CRM card: "reinstall from the app's install link"); the app must subscribe to `InboundMessage`; the webhook URL and signature verification are new work; the `crm-inbound` action stays (or a sibling action, still under the function cap) | The private integration token needs conversation read scopes (unverified); no new subscription |
| Fit with 091 | Direct: `ensure_inbound_conversation(person, ghl_conversation_id, ghl_contact_id, channel)` and `direction = 'inbound'` explicit, as built | Indirect: the conversation id is looked up, the message id is inferred |

Recommendation: **A**, on the condition that it is done capture-first exactly as 6.2 was — subscribe, capture one real `InboundMessage`, read it, then correct the parser against the real shape. B is a fallback if A's token cannot be restored. The workflow webhook stays in place meanwhile: it is a working, recorded signal that a client replied, even without identity.

### 16.11 A.0 — the Marketplace door: implemented, held at the gate (18 Sep 2026)

Built to the approved spec. Uncommitted; nothing deployed; no portal configuration yet.

| File | Change |
|---|---|
| `api/ghl/_config.ts` | `GHL_WEBHOOK_PUBLIC_KEY` in `GHL_KEYS` — the PEM GHL publishes, to be pasted by a person into `app_config`. Not in the repo; no PEM anywhere under `api/`, `src/`, `supabase/`, `docs/` (pinned). |
| `api/_lib/body.ts` | *new.* `readRawBody`, `parseBody` (JSON / form / text / bytes; empty → undefined; bad JSON → 400 — Vercel's rules), `attachBody(req, res)` sets `req.rawBody` (Buffer) and `req.body` once. |
| `api/events.ts` | `export const config = { api: { bodyParser: false } }`; `attachBody` runs before routing. Every action receives the same `req.body` as before; only `crm-inbound` reads `req.rawBody` (pinned). Still one function. |
| `api/ghl/_inbound-auth.ts` | *new.* `secretMatches` (`timingSafeEqual`), `signatureMatches` (RSA-SHA256 / `createVerify('SHA256')`, base64, over the raw bytes; malformed key or signature → false, never throws), `authenticateInbound` → `'secret' \| 'signature' \| null` — secret first, then signature. |
| `api/_handlers/inbound.ts` | Two doors, one endpoint. 503 only when *neither* credential is configured; 401 when neither presented credential verifies, with a log naming the step (never the content). `request.auth` records the door. Everything after authentication is unchanged: same insert, same 094 fallback, same `GHL_INBOUND_ACT` gate, same parser, same 085/091 path. |
| `api/ghl/_inbound-request.ts` | `x-wh-signature` and any `*signature*` name dropped from stored headers (a signature is a credential); `auth` field added. The tightened Vercel-header filter from §16.9 ships with this. |
| `src/lib/ghl/inbound-auth.test.ts` | 14 tests, per-run generated RSA pair: byte-exactness (re-serialised JSON and a one-byte change both fail), body parsing rules, valid signature, wrong key / tampered / garbage / empty / unparseable key / door closed when unconfigured, secret path unchanged and first, neither → null, refusal precedes the insert, 503 only when both unset, `request.auth` method-only, no credential in logs or rows, no PEM in the tree, one insert + one gate (the door never changes what happens next), parser/085/091 untouched, acting documented off. |

**End-to-end proof through the real code** — `api/events.ts` → `attachBody` → `inbound.ts` → `authenticateInbound` → insert, bundled with `@supabase/supabase-js` swapped for a psql bridge to the local PG16 harness, requests given as byte streams as Vercel gives them: **16/16**. Secret door 200/`auth=secret`; signed Marketplace bytes 200/`auth=signature`/`event_type=InboundMessage`/`handled_at NULL`/no thread, no message; wrong key 401; neither 401; one byte changed 401; rotated-away secret 401; both presented with a bad secret and a good signature → signature door; form body parses; bad JSON 400 before any write; unknown action 400; public key removed → signature door 401 while the secret door stays 200; **local-only** acting on → the signature door runs the unchanged 6.2 path (files once, replay is a duplicate) and the real workflow shape is still refused as `malformed`; no secret, signature, IP, `x-vercel-*` or proxy signature in any stored row. The 6.2 SQL replay proof still passes 19/19.

Gate: 69 files / **1134 tests**, `tsc` clean, `diff --check` clean. `GHL_INBOUND_ACT` off; 085, 091, parser untouched; old 094 row not cleaned; 6.3 blocked.

**Assumption to be confirmed by the first real delivery, not before:** GHL's signature is RSA-SHA256 (PKCS#1 v1.5) over the raw body, base64 in `x-wh-signature`, per their documentation. If the real scheme differs, the first delivery answers 401 and the Vercel log reads `signed request refused: signature did not verify rawBody bytes: N` — that line is the evidence to correct against; nothing is recorded on a refusal by design.

~~Next: paste a single public key…~~ **Superseded by §16.12 before deployment** — GHL's documentation, read the same day, shows two signature schemes; A.0.1 below replaces the single-key design.

### 16.12 A.0.1 — two signature schemes, GHL's order (18 Sep 2026)

Before A.0 was deployed, GHL's [Webhook Integration Guide](https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/) was read: Marketplace webhooks are signed with **`X-GHL-Signature` (Ed25519, current)** and, during a transition, the **legacy `X-WH-Signature` (RSA-SHA256, deprecated 1 Sep 2026)**. Their flow: verify the GHL header with the Ed25519 key when present; only when absent, the legacy header with the RSA key. A.0 verified only the legacy scheme and would have refused the first real delivery. Amended, approved, built:

| File | Change |
|---|---|
| `api/ghl/_config.ts` | `GHL_WEBHOOK_PUBLIC_KEY` replaced by `GHL_WEBHOOK_PUBLIC_KEY_ED25519` and `GHL_WEBHOOK_PUBLIC_KEY_RSA` — both PEMs pasted by a person from the guide; neither in the repo (pinned). |
| `api/ghl/_inbound-auth.ts` | `ed25519Matches` (`crypto.verify(null, raw, key, sig)`), `rsaMatches`; each refuses a key of the wrong type in its slot. `authenticateInbound`: **secret → `X-GHL-Signature` decisive (Ed25519; invalid → null, never falls through) → only if no GHL header, `X-WH-Signature` (RSA) → null.** `InboundAuth = 'secret' \| 'ed25519' \| 'rsa'`. |
| `api/_handlers/inbound.ts` | Reads both headers; 503 only when secret and both keys are unset; refusal log names which header and whether a key was configured, plus the byte count — never content. |
| `api/ghl/_inbound-request.ts` | `x-ghl-signature` dropped by name as well (and by the `*signature*` fragment); `auth` widened. |
| `src/lib/ghl/inbound-auth.test.ts` | 16 tests with per-run Ed25519 **and** RSA pairs — the thirteen gate points, including the no-fall-through rule pinned both behaviourally and in the source order. |

**Documented envelope, recorded but not relied on:** the guide describes platform webhooks as `{ webhookId, type, timestamp, data }` with `webhookId` "for deduplication". That is documentation evidence; the parser and 085 are not wired to it until the first real `InboundMessage` shows it.

**End-to-end proof** (real `events.ts` → `inbound.ts`, psql bridge, byte streams): **24/24** — Ed25519 valid → `auth=ed25519`; the documented envelope bytes captured whole; wrong Ed25519 key → 401; **invalid Ed25519 + valid RSA → 401**; both valid → `ed25519`; RSA alone → `rsa`; wrong RSA → 401; neither → 401; one byte changed → 401; bad secret + valid Ed25519 → `ed25519`; removing the Ed25519 key closes that door without falling through to RSA; removing the RSA key closes that one; all three unset → 503; local-only acting on runs the unchanged 6.2 path through either door; no secret, signature, key, IP or `x-vercel-*` in any stored row. 6.2 SQL replay still 19/19.

Gate: 69 files / **1136 tests**, `tsc` clean, `diff --check` clean. Uncommitted, undeployed. `GHL_INBOUND_ACT` off; 085/091/parser untouched; no portal configuration.

**Next (yours):** two `app_config` rows — `ghl_webhook_public_key_ed25519` and `ghl_webhook_public_key_rsa` — each the whole PEM block from the guide → deploy → developer portal: reinstall via the install link, Webhook URL `https://www.tryjalla.com/api/events?action=crm-inbound`, subscribe `InboundMessage` → one real message → newest row with `event_type = InboundMessage`, `request.auth = ed25519` (or `rsa` during the transition), `handled_at NULL` → stop; inspect the real envelope.

### 16.13 First real `InboundMessage` captured (21 Sep 2026) — the identity gap closes on evidence

Sequence completed: both PEMs in `app_config`; A.0.1 deployed; Marketplace app cloned to a draft, `conversations/message.readonly` (plus the scope set Groundwork uses) added, `InboundMessage` the only event enabled, published as **2.0.0**, uninstalled/reinstalled on the sub-account (fresh OAuth token — the expired Conversations token is fixed as a side effect). One WhatsApp message produced two rows one second apart: the workflow webhook (`request.auth = secret`) and the Marketplace delivery — **`event_type = InboundMessage`, `request.auth = ed25519`, `handled_at = NULL`**. The Ed25519 assumption held on the first real delivery.

**Real shape — flat, 20 top-level keys** (no `{webhookId,type,timestamp,data}` envelope as the guide describes; `webhookId` and `timestamp` sit beside the message fields):

`type` "InboundMessage" · `direction` "inbound" · `messageType` "WhatsApp" · `messageTypeId` number · `messageTypeString` (TYPE_… spelling) · **`messageId`** · **`conversationId`** · `contactId` · `locationId` (= the sub-account) · `webhookId` (per-delivery id) · `dateAdded` (message time) · `timestamp` (delivery time, +1 s) · `body` · `contentType` "text/plain" · `status` "delivered" · `from` / `to` (phone numbers — personal data) · `appId` · `versionId` · `userId` "". No `attachments` key on a text message; no contact name or email.

**Consequences.** `messageId` → `ghl_message_id` (085 as built); `conversationId` + `contactId` → `ensure_inbound_conversation` (091 as built) — no idempotency redesign. `locationId` is supplied → the 6.2-gate location check can be decided from evidence. The provisional parser would accept this payload as-is, but the fixture and tests are still the documented guess and are replaced next. `from`/`to` must never feed `sender_name`.

**Proposed next step (awaiting GO):** sanitised real fixture + parser pinned to it (`messageTypeId`/`messageTypeString` fallbacks; phone numbers never used); acting refuses `locationId` ≠ `GHL_LOCATION_ID` or absent (`wrong_location`, recorded, unhandled); `webhookId` kept in `payload` only (no column); harness re-run; then the acting decision. `GHL_INBOUND_ACT` off throughout. Person resolution note: Marketplace events carry no email, so the contact-id lookup is the only path for them — the email fallback remains for the workflow shape.

### 16.14 Parser pinned to the captured contract + location authority (21 Sep 2026) — held at the gate

Built to the five-point GO. A.0.1 was committed and deployed by Favour meanwhile (`3bd9dd2`); this step's diff is four files plus this note, uncommitted.

| File | Change |
|---|---|
| `api/ghl/_inbound-message.ts` | Header rewritten: the map is *the captured contract*, not documentation; the twenty keys listed; `from`/`to` named as transport addresses never read. Channel resolution: `messageType` word → `messageTypeString` (`TYPE_…`) → `messageTypeId`, the number **only** via `CHANNEL_OF_ID = { 19: 'whatsapp' }` — the one value established by evidence (the 18 Sep workflow capture carried `message.type: 19` on a WhatsApp message); any other number is `malformed: unknown messageType: id N`, a string `"19"` is not the number. Validation of type / direction / id / contact / body unchanged. `senderName` sources unchanged (never `from`/`to`; falls back to the channel word). |
| `api/_handlers/inbound.ts` | +12 lines between parse and person lookup: `GHL_LOCATION_ID` unset → `wrong_location / unconfigured`; payload `locationId` absent → `wrong_location / absent`; different → `wrong_location / mismatch`. All three: 200, recorded, `handled_at` NULL, no conversation, no message. Equal → continue. |
| `src/lib/ghl/inbound-message.test.ts` | Fixture is now `real()` — the twenty captured keys with their types and fabricated values (`REAL_KEYS` pinned; no 20-char id and no real-looking phone number may appear in the file). New pins: exact 085/091 mapping from the real shape; `dateAdded` not `timestamp`; `from`/`to` never in `sender_name` or the row, and never read in the parser source; the three-step channel fallback with the single established number; the documented shape still read as "another spelling"; the location check's position, three details, and that it files nothing. |
| `src/lib/ghl/inbound-auth.test.ts` | `RAW` bytes are the real flat shape. |

**`webhookId`** stays in `payload` only — no column, no migration, no second idempotency path. 085's `ghl_message_id` is the message-level key; the event table keeps every delivery and retry, as intended.

**End-to-end proof** (real `events.ts` → `inbound.ts`, psql bridge, byte streams; harness rebuilt into a durable location after the scratchpad was wiped a second time): **33/33**. Beyond the A.0.1 set: real-shape WhatsApp with the correct location → filed once as `inbound / ghl / whatsapp`, `sender_id` NULL, `created_at = dateAdded` (10:30:40.477Z, not the delivery `timestamp`); same `messageId` with a **new `webhookId`** → duplicate, one message; **wrong location → zero operational writes (`mismatch`)**; **missing location → zero (`absent`)**; `GHL_LOCATION_ID` unset → zero (`unconfigured`); `messageTypeString` fallback files as whatsapp; `messageTypeId: 19` files; `messageTypeId: 3` → malformed, nothing filed; `from`/`to` never in `sender_name`, no phone number in any message row; the workflow shape still refused by the parser under acting; the one thread is `waiting_on_us` with the GHL ids learnt — moved by 091, not the handler; capture mode is record-only even for a perfect real-shape event; no secret, signature, IP, `x-vercel-*` or key in any stored row.

Gate: 69 files / **1140 tests**, `tsc` clean, `diff --check` clean. **`GHL_INBOUND_ACT` off. 6.3 blocked.** Awaiting the authority review before acting is enabled.

**What enabling would mean, for that review:** `insert into app_config (key, value) values ('ghl_inbound_act', 'on')` — one row, no deploy; the kill switch is deleting it (60 s settings cache). Marketplace events from the sub-account, from a contact whose `profiles.ghl_contact_id` matches, would be filed onto their thread; everything else stays recorded and unhandled with a `reason`. Applicants (contact ids on `contractor_applications` only) are unmatched by design (D2). The unmatched count will not be zero.

### 16.15 Pre-activation finding (21 Sep 2026): most homeowner profiles carry no `ghl_contact_id`

Checked while preparing the activation runbook: the test contact (`favour@tryjalla.com`, source `groundwork_project_created`) maps to profile `c75b7bd7-…` whose `ghl_contact_id` is NULL. Cause, from the code: `crm-user` stores the id only when it creates the contact through the API (`api/_handlers/user.ts:91`); `crm-project` — the path that created this contact — never writes it back; `crm-backfill` does not either. So homeowner profiles synced through project creation or the webhook mode are unlinked.

Consequence: Marketplace `InboundMessage` events carry no email, so for an unlinked profile the only resolution path fails and the message is a correct `unmatched`. The unmatched rate after activation will be high and means *unlinked profiles*, not a pipeline fault.

**Activation runbook, one deliberate write (Favour, at the gate):** `update profiles set ghl_contact_id = '<id from the GHL contact URL>' where id = 'c75b7bd7-4d63-4b98-b5d3-a31a98389ab1' and ghl_contact_id is null;`

**To close the gap for everyone — a decision for the review, none built:** (1) `crm-project` stores the id it gets back, as `crm-user` does; (2) a one-time backfill filling `profiles.ghl_contact_id` by email lookup in GHL (`contacts.readonly`, granted in 2.0.0); (3) the inbound handler, on no contact-id match, fetches the GHL contact and matches by its email — an act-time lookup on *contacts*, not messages, so it does not reopen the identity question, but it is a design change with its own gate.

### 16.16 Decision (21 Sep 2026): the sequence to "Unified Inbox complete"

§16.15 is **not** a blocker to the controlled activation test (the deterministic mapping above makes it meaningful) and **is** a blocker to calling the Inbox production-ready for the wider user base. Option 3 of §16.15 (inbound-time contact lookup) is not built; it stays a fallback design to be judged against what remains unmatched after the linkage fix.

**Definition of complete:** a real customer reply resolves to the correct Groundwork person and conversation without manual intervention — not merely "the webhook works".

**Dependency chain:**
1. **Controlled activation** — link the test profile (one write, `… and ghl_contact_id is null returning id, email, ghl_contact_id`), pre-activation counts, enable the one row, one WhatsApp reply, prove event → message → thread → audit log, one replay → duplicate, sweep for unexpected writes/errors, then leave on or kill.
2. **Fix GHL contact ↔ Groundwork profile linkage** (separate September task; acceptance criteria below).
3. **Validate the Inbox in production** — real replies against the right person/project, `waiting_on_us` transitions, assignment/state behaviour, and the workflow + Marketplace double signal never producing two messages.
4. **6.3 Inbox data/read model**, then the Inbox UI.

**Task: Fix GHL Contact ↔ Groundwork Profile Linkage — acceptance criteria**
- `crm-project` persists the returned `contactId` into `profiles.ghl_contact_id` (as `crm-user` does in API mode).
- Existing homeowner profiles audited for missing `ghl_contact_id`.
- One-time backfill matches existing profiles to GHL contacts by email; matching is case-insensitive; **ambiguous matches are not written**; existing non-null ids are never overwritten; idempotent and re-runnable.
- Remaining unmatched profiles reported for manual review.
- A newly created homeowner/project automatically receives a persisted `ghl_contact_id`.
- A real `InboundMessage` for that homeowner resolves with no manual database intervention.
- Tests and production proof recorded before the task closes.

## 17. Linkage task — GHL contact ↔ Groundwork profile (22 Sep 2026)

### 17.1 Step 1 — `crm-project` persists the returned contact id (PASS)
[`api/_handlers/project.ts`](../../api/_handlers/project.ts): the owner's profile select includes `ghl_contact_id`; the known id is passed to `forwardToGhl` as `contactId`; after a successful forward that returned an id, and only when the owner has none, `UPDATE profiles SET ghl_contact_id … WHERE id = project.user_id AND ghl_contact_id IS NULL` — owner not caller, null guard in the database, stamp failure logged never fatal, response gains `linked`. Also fixed while here: the outbox/custom-field `user_id` is now `project.user_id`, not the caller's id (admin-created projects used to stamp the admin). Forwarding mode checked: `deliver()` uses the API whenever token+location are configured (they are — the CRM card says "Using the API"), so `project_created` returns a contact id; `GHL_CONTRACTOR_WEBHOOK_MODE` affects contractor applications only.

### 17.2 Step 2 — the backfill (built, held at the production gate)

**Source 1 — Groundwork's own evidence.** [`supabase/maintenance/link-ghl-contacts-source1.sql`](../../supabase/maintenance/link-ghl-contacts-source1.sql), *not* a migration. Identity is event-aware: `user_signup` → `payload.user_id → profiles.id`; `project_created` → `payload.project_id → projects.user_id → profiles.id` (never `payload.user_id`, which was the caller's); both require `lower(outbox.email) = lower(profile.email)`; only `status = 'sent'` rows with a `contact_id`; every other event type ignored. Per profile: one distinct consistent id → `eligible`; several → `conflict`; evidence with the wrong email → `mismatch`; unresolvable → `orphan` (counted). Part A reports; **part B is the identical CTE** feeding `UPDATE … WHERE ghl_contact_id IS NULL … RETURNING profile_id, email, ghl_contact_id` — nothing is copied from a report into a separate statement. Harness (gw62, seeded with every case): report = `already_linked 1, conflict 1, eligible 2, mismatch 1, orphan_rows 1`; apply wrote exactly the two eligible rows — including the **admin-created project linked to its owner while the admin (the payload's `user_id`) stayed NULL**; the already-linked profile kept `ct_already`, not the newer evidence; failed / pending / null-contact / other-event rows were not evidence; **second run: `UPDATE 0`**.

**Source 2 — the GHL book.** [`api/ghl/_contact-links.ts`](../../api/ghl/_contact-links.ts) (pure `planLinks`: `eligible | no_email | not_found | ambiguous | taken | already_linked`, case-insensitive, one contact per email, a contact owned by another profile is `taken`) and [`api/_handlers/crm-link-contacts.ts`](../../api/_handlers/crm-link-contacts.ts), an `events.ts` action (function count still 11): admin-only via `is_admin` on the caller's token; one `listContacts` fetch (cap 2000); **dry-run by default, `apply: true` to write; refuses to apply when the book is partial (a page failed) or hit the cap**; writes only `eligible` pairs, each behind `.is('ghl_contact_id', null)`, and returns every changed row (`written`) — the rollback list. No UI: called from the browser console on `/admin/crm`. End-to-end through the real dispatcher with only the book stubbed: no token 401; homeowner 403; dry run reports without writing; partial book refused; capped book refused; apply writes exactly the eligible pairs (`RETURNING` shown); `taken` / `ambiguous` / `no_email` untouched and already-linked ids never replaced; **re-run applies 0**. 8/8.

**Tests:** [`src/lib/ghl/contact-linkage.test.ts`](../../src/lib/ghl/contact-linkage.test.ts), 21 — step-1 pins (owner not caller, both guards, id only from the forward's result, payload `user_id` = owner), Source 1 script pins (event-aware identity, the two halves' rule CTEs textually identical, double null guard, RETURNING, not a migration), `planLinks` decisions incl. idempotence, action pins (admin gate before any fetch, single capped fetch, `apply` required, refusal on incomplete, `.is(null)` on the write, reads `profiles` only, touches nothing in GHL).

**Gate:** 70 files / 1161 tests, `tsc` clean, `diff --check` clean. **No production writes. Backfill not run. `GHL_INBOUND_ACT` off.**

**Production sequence (unchanged from the design):** before-counts → Source 1 part A (review) → part B (keep the RETURNING output) → part A again (zero eligible) → `crm-link-contacts` dry run → review → `apply: true` (keep `written`) → after-counts → step 3 (a new homeowner project links by itself) → step 4 (controlled `InboundMessage`).

Console invocation on `/admin/crm`, signed in as an admin:
```js
const { data: { session } } = await window.supabase.auth.getSession();   // or however the page exposes the client
await fetch('/api/events?action=crm-link-contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({}) }).then(r => r.json());              // dry run
// review, then:
// … body: JSON.stringify({ apply: true }) …
```
