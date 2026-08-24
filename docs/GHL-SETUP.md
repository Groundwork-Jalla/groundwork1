# Go High Level — what has to exist on the GHL side

The code is built. None of it does anything visible until the account is configured, and
every step below is in the GHL console, not the codebase.

Nothing here is required all at once. **Phase 1 works with just the two webhooks**;
everything under Phase 2 upgrades the same code path without a redeploy.

---

## Phase 1 — webhooks (already partly done)

| Env var | Where it comes from |
|---|---|
| `GHL_CONTRACTOR_WEBHOOK_URL` | Already set. The existing contractor-application workflow. Leave it alone. |
| `GHL_EVENT_WEBHOOK_URL` | **New.** Automation → Workflows → new workflow → trigger **Inbound Webhook** → copy the URL. |

One webhook carries every new event — signups, application decisions, subscription
changes, projects created. Each payload has an `event` field, so branch on it inside the
workflow rather than building four webhooks.

Values of `event`:

- `user_signup` — a homeowner or client created an account
- `application_decision` — plus `decision: accepted | rejected`
- `subscription_changed` — plus `subscription_status` and `subscription_tier`
- `project_created` — plus `project_name`, `project_tier`, `build_country`

Every payload also carries `email`, `full_name`, `first_name`, `last_name`, `phone`,
`country`, `lang` and `source`.

**Until a workflow acts on them, the data arrives and sits there.** That is the half of
Phase 1 that is not engineering.

---

## Phase 2 — the API

Setting these switches the same events from webhooks to the v2 API. The difference is
that the API answers: it returns a contact id, which is what makes tags, pipeline moves
and one-record-per-person possible. Unset, the webhooks keep working exactly as before.

### 1. A Private Integration Token

Settings → **Private Integrations** → create one, scoped to this location only.

Scopes needed: `contacts.write`, `contacts.readonly`, `opportunities.write`,
`opportunities.readonly`.

```
GHL_API_TOKEN=pit-...
GHL_LOCATION_ID=...        # Settings → Business Profile, or the URL of your sub-account
```

A PIT was chosen over an OAuth app deliberately: no refresh tokens to store or renew, at
the cost of rotating it by hand if it ever leaks. Rotating means creating a new one and
replacing the env var — nothing in the code changes.

### 2. Custom fields

The upsert sends these as custom fields. Create them once in Settings → Custom Fields, or
they are silently dropped:

`user_id`, `application_id`, `application_url`, `decision`, `subscription_status`,
`subscription_tier`, `period_end`, `project_id`, `project_name`, `project_tier`,
`build_country`, `build_city`, `lang`

### 3. Pipeline and stages

```
GHL_PIPELINE_ID=...
GHL_STAGE_MAP={"user_signup":"stg_a","application_decision:accepted":"stg_b"}
```

`GHL_STAGE_MAP` is one JSON object so adding a stage is an env change rather than a
deploy. Keys are the event name, optionally suffixed `:variant`:

- `user_signup`
- `application_decision:accepted` / `application_decision:rejected`
- `subscription_changed:active` / `:canceled` / `:past_due`
- `project_created`

**Anything not in the map moves nobody.** That is the safe default — a half-configured
pipeline should leave the board alone rather than pile every contact into whichever stage
happened to be listed first. Start with two or three keys.

Tags are chosen by us, not configured here: `groundwork:signup`,
`groundwork:contractor`, `groundwork:subscriber`, `groundwork:building`, plus
`groundwork:accepted` / `groundwork:rejected` on a decision.

### 4. Letting GHL talk back

```
GHL_INBOUND_SECRET=<a long random string>
```

In any workflow, add a **Webhook** action pointing at
`https://www.tryjalla.com/api/events?action=crm-inbound`, with a custom header:

```
X-Groundwork-Secret: <the same string>
```

GHL does not sign its outbound webhooks the way Stripe does, so a shared header is the
strongest check available. That is why **this endpoint only records** — events land in
`ghl_inbound_events` and change nothing. Acting on one is a separate, deliberate piece of
work; weaker authentication must not be able to accept a contractor.

---

## When something does not arrive

Nothing is lost. Every event is written to `ghl_outbox` *before* it is attempted, so a
failure leaves a row rather than nothing:

```sql
SELECT event, email, attempts, last_error, created_at
  FROM ghl_outbox WHERE status <> 'sent' ORDER BY created_at;
```

Admins can replay the backlog by POSTing to `/api/events?action=crm-retry` (25 at a time, and it stops
early if the CRM is still down rather than burning the batch). Individual contractor
applications also have a **Send to CRM now** button on their admin page.

---

## A caveat worth reading before the first live run

The v2 API details in `api/ghl/_client.ts` — the base URL, the `Version` header and every
path — were written from GoHighLevel's published documentation, without a token to test
against. They are our transcription of someone else's contract, and any of it can be
wrong or can change.

They are deliberately all in one block at the top of that file. If the first real call
returns a 404 or a 422, check there first: it is a five-line correction, not a search
through the codebase.
