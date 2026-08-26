# Go High Level — setup, step by step

The code is finished. Nothing here is engineering: every step is either a value pasted
into Vercel or a thing built inside the GHL console.

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
4. Vercel → project → **Settings → Environment Variables** → add:

   ```
   GHL_EVENT_WEBHOOK_URL = <the URL you copied>
   ```

5. **Redeploy** — Vercel does not apply new variables to the running deployment

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
2. Scopes: `contacts.write`, `contacts.readonly`, `opportunities.write`,
   `opportunities.readonly`
3. Copy the token (shown once)
4. Location id: GHL → **Settings → Business Profile**, or take it from your sub-account URL
5. Vercel → Environment Variables:

   ```
   GHL_API_TOKEN   = pit-...
   GHL_LOCATION_ID = ...
   ```

6. Redeploy

**Check:** `/admin/crm` badge flips to **Using the API**.

A Private Integration Token rather than an OAuth app, deliberately: no refresh tokens to
store or renew. The cost is rotating it by hand if it leaks — create a new one, replace
the variable, redeploy. No code changes.

---

## Step 4 — custom fields (20 min)

The API sends these alongside each contact. **Fields you have not created are silently
dropped** — no error, and on the contact a missing field looks exactly like a question the
applicant left blank. Create them once: GHL → **Settings → Custom Fields**, object
*Contact*, type *Text* for all.

### 4a — account, project and billing events

```
user_id              application_id        application_url
decision             subscription_status   subscription_tier
period_end           project_id            project_name
project_tier         build_country         build_city
lang
```

### 4b — contractor applications

A contractor application carries **104 fields**, far too many to list here and more than
you want to create by hand. They are enumerated and *prioritised* in
**[GHL-CUSTOM-FIELDS.md](./GHL-CUSTOM-FIELDS.md)** — the first 24 carry nearly all the
value, including `projects_summary` and `documents_summary`, which hold the applicant's
whole project history and every uploaded document in two fields.

Start with Tier 1 there and stop. Add more only when you want GHL to filter or automate on
a specific value.

**Check:** accept a test application, then look at that contact in GHL — `decision` and
`application_url` should be filled in. For a contractor, `/admin/applications/<id>` →
**Send to CRM again**, then confirm `documents_summary` is populated on the contact.

---

## Step 5 — pipeline stages (15 min)

Optional, and safe to leave until you want it.

1. GHL → **Opportunities → Pipelines**. Note the pipeline id and the id of each stage
   (both are in the URL when you open them)
2. Vercel:

   ```
   GHL_PIPELINE_ID = <pipeline id>
   GHL_STAGE_MAP   = {"user_signup":"<stage id>","application_decision:accepted":"<stage id>"}
   ```

3. Redeploy

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
2. Vercel: `GHL_INBOUND_SECRET = <that string>` → redeploy
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

**Every environment variable needs a redeploy.** Vercel does not apply new values to a
running deployment. If `/admin/crm` still shows a cross after you have added something,
this is almost always why.

**The v2 API details are unverified.** The base URL, version header and paths in
`api/ghl/_client.ts` were written from GoHighLevel's published documentation without a
token to test against — our transcription of someone else's contract. They are all in one
block at the top of that file, so if the first real call returns a 404 or 422, that is a
five-line correction rather than an investigation.
