# Go High Level — setup, step by step

The code is finished. Nothing here is engineering: every step is either a value pasted
into Supabase or a thing built inside the GHL console.

**Settings live in the `app_config` table, not in Vercel** (migration 064). Two reasons:
the free plan has run out of environment variables, and a value in Vercel needs a
redeploy before it does anything — which is the single most common reason a tick stays a
cross after someone has "already added it". A row in `app_config` takes effect within a
minute. Values still in Vercel keep working; a row in the table overrides one.

**Check your work as you go at `/admin/crm`.** That page reads the live configuration and
shows a tick per item, plus which route events are currently taking. Every value below
fails *silently* if it is wrong — the app logs a warning nobody reads and carries on,
because a CRM outage must never break a signup — so that page is the only way to tell
"working" from "quietly doing nothing".

Work top to bottom. You can stop after Step 2 and have something useful.

---

## Step 0 — run two migrations (5 min)

Supabase → **SQL Editor** → paste each file and run, in order:

1. `supabase/migrations/049_profiles_ghl_sync.sql`
2. `supabase/migrations/050_ghl_contact_and_outbox.sql`

Without these, nothing can be recorded and every event is lost the moment it fails.

**Check:** `/admin/crm` loads without an error banner.

---

## Step 1 — one webhook for lifecycle events (10 min)

This is the fastest thing that produces value. It carries signups, application decisions,
subscription changes and new projects.

1. GHL → **Automation → Workflows → Create Workflow → Start from scratch**
2. Add trigger → **Inbound Webhook**
3. Copy the webhook URL it gives you
4. Supabase → **SQL Editor**:

   ```sql
   INSERT INTO public.app_config (key, value)
   VALUES ('ghl_event_webhook_url', '<the URL you copied>')
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
   ```

5. Wait a minute. No redeploy.

**Check:** `/admin/crm` shows a tick on *Lifecycle events webhook*, and the badge reads
**Using webhooks**.

### Branching inside the workflow

Every payload carries an `event` field. Add an **If/Else** on it:

| `event` | Means | Also carries |
|---|---|---|
| `user_signup` | a homeowner created an account | — |
| `application_decision` | a contractor was accepted or rejected | `decision` |
| `subscription_changed` | someone paid, upgraded or cancelled | `subscription_status`, `subscription_tier` |
| `project_created` | a signup actually started a build | `project_name`, `project_tier`, `build_country` |

Everything also carries `email`, `full_name`, `first_name`, `last_name`, `phone`,
`country`, `lang` and `source`.

> **Until the workflow does something with these, the data arrives and sits there.**
> Creating the contact is the minimum useful action.

---

## Step 2 — check it actually works (5 min)

1. Sign up on the site with an address you control
2. GHL → **Contacts** — the contact should appear within seconds
3. If it does not: `/admin/crm` → **Waiting to reach the CRM**. Anything listed there
   shows its error and can be resent with one button

Nothing is ever lost. Every event is written down *before* it is attempted, so a failure
leaves a row to retry rather than nothing at all.

**You can stop here.** Steps 3–6 are worth doing, but this alone closes the gap that
started all of it: homeowners were invisible to whoever picks up the phone.

---

## Step 3 — the API token (15 min)

Webhooks are one-way: GHL cannot tell us the id of the contact it just made, so nothing
can ever be *updated* afterwards — no tags, no pipeline moves, no second event attaching
to the same person. The API fixes that.

1. GHL → **Settings → Private Integrations → Create new integration**
2. Scopes — **all six**. A missing scope does not degrade gracefully: GHL answers `401`,
   which looks exactly like a bad token.

   ```
   contacts.readonly              contacts.write
   opportunities.readonly         opportunities.write
   locations/customFields.readonly    locations/customFields.write
   medias.readonly                medias.write
   ```

   The custom-field scopes are the ones people miss, because nothing needs them until you
   press **Check custom fields** — and then the whole integration looks broken.
3. Copy the token (shown once)
4. Location id: GHL → **Settings → Business Profile**, or take it from your sub-account URL
5. Supabase → **SQL Editor**:

   ```sql
   INSERT INTO public.app_config (key, value) VALUES
     ('ghl_api_token',   'pit-...'),
     ('ghl_location_id', 'your-location-id')
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
   ```

   No redeploy. Takes effect within a minute.

**Check:** `/admin/crm` badge flips to **Using the API** — and no red banner. A tick on
*API token* only means a value is present; the page separately asks GHL whether it
*accepts* it, and says so if not.

A Private Integration Token rather than an OAuth app, deliberately: no refresh tokens to
store or renew. The cost is rotating it by hand if it leaks — create a new one, replace
the variable, redeploy. No code changes.

---

## Step 4 — custom fields (2 min, one button)

**This step used to be 20 minutes of typing. It is now a button** — read on only if you
want to know what it does.

GHL **discards any custom field the location does not already have, silently, with a
200**. On the contact, a field that was never created looks exactly like a question the
applicant left blank. Project references 1, 2 and 3 went missing that way for weeks
before anyone noticed. A contractor application carries 104 fields, and hand-typing 104
keys is also how two end up misspelled — after which they are dropped forever and look,
again, like blanks.

So the app creates them:

1. `/admin/crm` → **Check custom fields**. Nothing is created; it reports what is missing.
2. If anything is missing, a second button appears: **Create the N missing fields**.

It compares by key and creates only what is absent, so it is safe to run repeatedly and
safe against a location where someone already made some by hand. It never edits or
deletes an existing field.

Both buttons need Step 3 done — they use the API, not the webhook.

**Check:** run **Check custom fields** again; it should report nothing missing. Then accept
a test application and look at that contact in GHL — `decision` and `application_url`
should be filled in. For a contractor, `/admin/applications/<id>` → **Send to CRM again**,
then confirm `documents_summary` is populated.

The full field list, with which ones carry the most value, is in
**[GHL-CUSTOM-FIELDS.md](./GHL-CUSTOM-FIELDS.md)**. You no longer need it to set this up —
it is there for deciding what GHL should filter or automate on.

---

## Step 5 — pipeline stages (15 min)

Optional, and safe to leave until you want it.

1. GHL → **Opportunities → Pipelines**. Note the pipeline id and the id of each stage
   (both are in the URL when you open them)
2. Supabase → **SQL Editor**:

   ```sql
   INSERT INTO public.app_config (key, value) VALUES
     ('ghl_pipeline_id', '<pipeline id>'),
     ('ghl_stage_map',   '{"user_signup":"<stage id>","application_decision:accepted":"<stage id>"}')
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
   ```

3. No redeploy.

Keys you can use — start with two or three, add more later:

```
contractor_application            ← a contractor applies. Start here.
user_signup                       project_created
application_decision:accepted     application_decision:rejected
subscription_changed:active       subscription_changed:canceled
subscription_changed:past_due
```

### Two funnels, two pipelines

A contractor moves *Applied → Interviewed → Accepted*. A homeowner moves *Signed up →
Building → Subscribed*. Those are not the same board, and a stage cannot belong to two
pipelines in GoHighLevel — so a stage value may name its own pipeline:

```
"<stageId>"                 uses ghl_pipeline_id, the default
"<pipelineId>/<stageId>"    uses that pipeline instead
```

Real stage ids contain hyphens but never a slash, so everything already in the map keeps
working untouched.

A homeowner board worth building — *Signed up → Estimated → Building → Subscribed*:

```sql
INSERT INTO public.app_config (key, value) VALUES
  ('ghl_stage_map', '{
     "contractor_application":"APPLIED_ID",
     "application_decision:accepted":"ACCEPTED_ID",
     "application_decision:rejected":"REJECTED_ID",
     "user_signup":"HOMEOWNER_PIPELINE_ID/SIGNED_UP_ID",
     "project_created":"HOMEOWNER_PIPELINE_ID/BUILDING_ID",
     "subscription_changed:active":"HOMEOWNER_PIPELINE_ID/SUBSCRIBED_ID"
   }')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
```

Get the ids the same way as the contractor ones: `/admin/crm` → **Show pipeline & stage
ids**, which lists every pipeline in the location.

`contractor_application` is the one to map first. It puts a card on the board the moment
somebody applies, which is what makes the acknowledgement email something you can act on
— schedule an interview, move the card — rather than something you only read. Without it
a contractor reaches GHL as a contact and never appears on any board, and the earliest
stage that fires is the *decision*, which comes after the interview it was meant to help
you arrange.

**Anything not in the map moves nobody.** That is deliberate: a half-configured pipeline
should leave your board alone rather than pile every contact into whichever stage
happened to be listed first.

**Check:** `/admin/crm` shows *Pipeline stages mapped (2)* and lists your keys. If the
JSON has a typo it says so — a broken map disables every move and otherwise looks exactly
like "not set up yet".

Tags are chosen by us, not configured here: `groundwork:signup`, `groundwork:contractor`,
`groundwork:subscriber`, `groundwork:building`, plus `groundwork:accepted` /
`groundwork:rejected` on a decision.

---

## Step 6 — letting GHL talk back (10 min)

Optional. Lets a booked appointment or a reply reach the app instead of living only in GHL.

1. Invent a long random string
2. Supabase → **SQL Editor**:

   ```sql
   INSERT INTO public.app_config (key, value)
   VALUES ('ghl_inbound_secret', '<that string>')
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
   ```
3. In any GHL workflow, add a **Webhook** action:

   - URL: `https://www.tryjalla.com/api/events?action=crm-inbound`
   - Method: POST
   - Custom header: `X-Groundwork-Secret: <the same string>`

**Check:** `/admin/crm` shows a tick on *Inbound webhook secret*.

> **These events are recorded and nothing else.** GHL does not sign its outbound webhooks
> the way Stripe does, so a shared header is the strongest check available — and
> something authenticated that weakly must never be able to accept a contractor. Events
> land in `ghl_inbound_events` inert. Acting on one is a separate, deliberate decision.

---

## Step 7 — WhatsApp for talking to contractors (30 min, mostly waiting on Meta)

**Do Step 3 first.** WhatsApp messages attach to a contact, and without the API there are
no contact ids to attach them to.

### The part only you can do

WhatsApp Business is not something an app can switch on — Meta has to approve the
business, and that approval is tied to your company, not to this codebase.

1. GHL → **Settings → Conversation Providers → WhatsApp** (some accounts show it under
   **Settings → Integrations**)
2. Connect a number. Two routes, and the choice matters:
   - **GHL's own WhatsApp** — they handle the Meta approval. Fastest, and billed per
     conversation.
   - **Your own Meta WhatsApp Business account** — more setup, cheaper at volume, and the
     number stays yours if you ever leave GHL.
3. The number **cannot already be on the WhatsApp app**. A number in use on a personal or
   Business-app WhatsApp has to be deleted from it first, and that is irreversible for
   that number's chat history. Use a fresh SIM rather than the one on someone's phone.
4. Meta review is typically 1–3 days.

### Before the first message: templates

Outside a 24-hour window from the contact's last message, WhatsApp only permits
**pre-approved template messages**. A free-text first contact will simply not deliver.
Submit templates in GHL → **Marketing → Templates**, and expect a day for approval.

Worth having, in English and French, given who they go to:

- application received
- application accepted / declined
- documents missing, please send X
- you have been invited to a project

### What the code already does for this

**Phone numbers are now normalised to E.164** (`api/ghl/_phone.ts`). This is not
cosmetic. WhatsApp addresses a person by `+237670000000`; the form takes free text and
Cameroonians write `670 00 00 00`, which is what was being sent. **Every contact already
in GHL has a phone field that looks filled in and cannot be messaged.**

New and re-synced contacts are fixed automatically. To fix the ones already there:

- Contractors: `/admin/applications/<id>` → **Send to CRM again**
- Everyone else: they are corrected on their next lifecycle event, or via
  `/admin/crm` → **Send them now**

Numbers the normaliser cannot confidently place are passed through unchanged rather than
guessed at — a wrong number in a CRM reaches a stranger, which is worse than one that
visibly fails.

---

## Step 8 — seeing our emails on the contact (nothing to configure)

Already on, provided Step 3 is done.

Every email the product sends a client or contractor is written onto that person's GHL
contact as a **note**: what it was, when it went, the subject, and a readable excerpt of
the body.

| On the timeline | Sent by |
| --- | --- |
| Application acknowledgement — automatic, and the manual re-send | `contractor-application-notify`, `send-application-acknowledgement` |
| Application decision — accepted or rejected | `send-application-decision` |
| Project invitation | `send-invite` |
| Stage approved, rework requested | `send-email`, labelled `stage_update` |

So the question that follow-up actually turns on — *what have we already said to this
person?* — is answerable in GHL, by whoever is holding the phone, without asking a
developer.

### What is deliberately *not* there

Worth knowing, because an empty stretch of timeline otherwise reads as "we never
contacted them".

- **Account emails — password resets, sign-up confirmations, magic links.** Supabase
  sends these itself, from its own service; our code never sees them, so nothing can log
  them. A contact with no notes may still have had three password resets.
- **The team alert** when an application arrives. It goes to our own inbox, and the
  logger creates a contact for any address it does not recognise — logging it would file
  our ops inbox in the contact book as a lead.

### Checking it actually works

`/admin/crm` → **Test the email log**. It runs the real code path — the same lookup,
upsert and notes call the acknowledgement emails use — and writes one note to *your own*
contact, never a contractor's. Nothing is emailed.

Worth pressing after any change to the token, because every failure in this path is
silent by design: a note that cannot be written must never break a password reset, so a
CRM that has been recording nothing for a month looks exactly like one that is working.

### Getting them into **Conversations**, not just notes

By default these land as **notes**, which are searchable and on the right contact — but
on the wrong tab. You cannot reply to a note, so following up still means leaving GHL.

To have them appear in the **Conversations** pane instead, like any other email thread,
with the reply box underneath, GHL needs one more value: a **conversation provider id**.

Why it is a setup step and not just code: GoHighLevel will not accept a message onto a
thread without knowing which provider it came through, and provider ids come from a
Marketplace app. They cannot be created from sub-account settings, and they cannot be
derived from the location id.

1. Go to <https://marketplace.gohighlevel.com> and sign in with the agency account.
2. Create an app (or open the existing one). Under **Conversation Providers**, add a
   provider of type **Email**. Name it something recognisable — "Groundwork (Resend)" —
   because that name is what appears on the thread.
3. Copy the provider's **ID**.
4. Put it in `app_config`, the same way as every other setting:

   ```sql
   INSERT INTO app_config (key, value)
   VALUES ('ghl_conversation_provider_id', 'PASTE_THE_ID_HERE')
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
   ```

5. **Re-run the install link afterwards.** The token exchange happens in the redirect, so
   an app installed before the client id and secret were set has no token stored, and
   emails keep landing as notes. `/admin/crm` shows a **Conversations token** row —
   *valid*, *expired* or *missing* — so this is visible rather than mysterious.

### What this cost, so nobody pays it twice

Three things about this endpoint are not in GoHighLevel's documentation and each looked
like a different problem:

- **It will not accept a Private Integration Token.** The message is posted *as the
  conversation provider*, and a provider belongs to a Marketplace app, so GHL wants the
  app's own OAuth access token. A PIT is scoped to the location and is not the app —
  which is why granting it `conversations/message.write`, and then reissuing it entirely,
  both changed nothing and it kept answering `401`.
- **It wants a `conversationId`, not a `contactId`.** A contact who has never had a
  conversation has no thread, so the id has to be looked up and created if absent.
- **`type` is `"Custom"`, not `"Email"`.** The type describes how the message *reaches*
  GHL rather than what kind of message it is, so anything arriving through a custom
  provider is `Custom` whatever channel it represents. `"Email"` returns
  `CONVERSATIONS_MSG_CONVERSATION_PROVIDER_MISMATCH`, which reads like a wrong provider
  id and is not.

All three were found by printing GoHighLevel's own error text instead of a bare status.
That is why the conversation call sets `verboseErrors` and `/admin/crm` prints what GHL
said verbatim.

6. Check the Private Integration Token carries the **`conversations/message.write`**
   scope. Without it every message is refused and the record silently falls back to a
   note. Rotating scopes means reissuing the token.

Takes effect within a minute — no redeploy. `/admin/crm` shows the row **Conversation
provider**, and **Test the email log** turns green only once it is actually writing to
the thread; a note-only result reads as a warning, on purpose.

**We are still sending through Resend, not GHL.** The email is delivered by Resend and
then *recorded* on the thread — GHL's `/conversations/messages/inbound` endpoint exists
for exactly this, messages that happened elsewhere. Moving transactional mail onto GHL's
sending domain would mean re-verifying deliverability for password resets and
invitations, which is real risk for no gain. Replies from the thread do go through GHL,
which is the point.

If neither is possible — no API token at all — nothing is written and nothing breaks:
the email still sends. Notes never block or fail a send — but they *are* awaited before the endpoint
answers, because Vercel freezes the function the moment it responds and an unawaited note
never gets written. `src/lib/email/crm-email-log.test.ts` enforces both halves of that.

---

## When something does not arrive

`/admin/crm` → **Waiting to reach the CRM** lists every event that has not landed, with
its error and how many attempts it has had. **Send them now** replays up to 25 at a time,
and stops early if the CRM is still down rather than burning the batch.

Individual contractor applications also have **Send to CRM now** on their own admin page.

By hand, if you prefer:

```sql
SELECT event, email, attempts, last_error, created_at
  FROM ghl_outbox WHERE status <> 'sent' ORDER BY created_at;
```

---

## Two things worth knowing

**Settings are cached for a minute.** A row written in Supabase takes effect on the next
minute, with no redeploy. Anything still living in Vercel's environment *does* need one —
which is the reason to move it.

**A tick is not a working credential.** The rows say whether a value is *set*. The token
is separately tested against GHL, and a refused one gets a red banner. If you see that
banner, the token has expired, been revoked, or is missing a scope — Step 3 lists all six.
Events fall back to the webhook while it is broken, so nothing is lost.

**The v2 API details are unverified.** The base URL, version header and paths in
`api/ghl/_client.ts` were written from GoHighLevel's published documentation without a
token to test against — our transcription of someone else's contract. They are all in one
block at the top of that file, so if the first real call returns a 404 or 422, that is a
five-line correction rather than an investigation.
