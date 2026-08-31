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
user_signup
application_decision:accepted     application_decision:rejected
subscription_changed:active       subscription_changed:canceled
subscription_changed:past_due     project_created
```

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
