# Automatic agent requests — what to configure

A request filed at `/admin/requests` now produces itself:

```
/admin/requests  →  agent_requests INSERT
                 →  trigger (056)  →  /api/agent-dispatch
                 →  GitHub repository_dispatch
                 →  .github/workflows/agent-request.yml
                 →  plan (Claude) → record (Chrome) → check (qc.py) → upload → status
```

Two things make this safe to leave alone.

**The model plans; it does not drive.** Claude returns a shot list drawn from a fixed
vocabulary, and `docs/recording/play_plan.py` executes it. An off-site path is refused
and an unknown action is skipped. A bad plan makes a dull video — it cannot make an
unattended browser do something nobody sanctioned on a production account.

**Nothing ships unchecked.** `docs/recording/qc.py` replaces the person who used to look
at the frames: blank frames, a stalled driver, a run that is too short. Those are not
hypothetical — all three happened while making the first two videos by hand, and the
stall check caught a 24-second frozen ending in a video that had already been delivered.
A video that fails is still uploaded and the request is marked `declined` with the
reason, because whoever asked needs to see what went wrong more than they need a tidy
queue.

The workflow also runs **every 15 minutes**, so if the webhook is never configured, or a
call is lost, nothing is stranded.

---

## Notifications — working, and independent of everything else

Every filed request emails whoever is set as `notify_email` with the whole brief and the
command to produce it. **The database sends this itself**, calling Resend directly from
the `agent_requests` insert trigger. It does not touch Vercel, GitHub or Anthropic.

That was not the original design. It routed through `/api/agent-dispatch` on Vercel with
a shared secret, which failed for two reasons worth recording:

- **Vercel would not take more environment variables** on the free plan, so the shared
  secret had nowhere to live.
- The apex domain **308-redirects to `www`**, and `pg_net` does not follow redirects —
  so the original URL would have swallowed every notification silently.

Cutting the hop removed both problems and a redeploy step. Settings live in `app_config`
(058), which has RLS on and no policies, so only `SECURITY DEFINER` functions can read
it. To change the recipient:

```sql
UPDATE public.app_config SET value = 'someone@example.com', updated_at = now()
 WHERE key = 'notify_email';
```

If mail stops, this is the log of every outbound call Postgres made:

```sql
SELECT id, status_code, left(content, 250) AS response, created
FROM net._http_response ORDER BY created DESC LIMIT 5;
```

Rows with `200` mean Resend accepted it and the problem is delivery. No rows at all means
the trigger is not firing — check it exists with `SELECT tgname FROM pg_trigger WHERE
tgrelid = 'public.agent_requests'::regclass AND NOT tgisinternal;`

## Captions, not narration

There is no voice track. Every scene carries a short `caption` written in the brief's
language, burnt into the picture for that scene's duration.

Burnt in rather than attached as a subtitle track, because these are watched on WhatsApp
and LinkedIn — muted, in feeds that strip subtitle tracks — so a soft track would be
silently dropped exactly where it is needed. Burnt-in text also survives whatever
re-encoding a recipient forwards it through.

The style draws an opaque box: `BorderStyle=3` with a **non-zero** `Outline`, which is
what libass sizes the box from. Without the box, white text reads fine over the dark
project screens and is **completely invisible** over the white landing page — a defect
that does not show up in review, only in whatever you sent. `PlayResY` is pinned so the
font size means the same thing regardless of output resolution.

Audio is still possible: set `audio` on the plan to a file path and the player muxes it
with `-shortest`. Nothing generates one — there is no TTS on the runner, and Anthropic
does not provide it. A music bed or a recorded voiceover would have to be supplied.

---

## 1. GitHub secrets

`Settings → Secrets and variables → Actions`

| Secret | What |
|---|---|
| `VITE_SUPABASE_URL` | same as `.env` |
| `VITE_SUPABASE_ANON_KEY` | same as `.env` |
| `GW_ADMIN_EMAIL` / `GW_ADMIN_PASSWORD` | an **admin** account — reads the queue, uploads, sets status |
| `GW_REC_EMAIL` / `GW_REC_PASSWORD` | the **recording** account (see the warning below) |
| `ANTHROPIC_API_KEY` | for the planner |

## 2. Vercel environment

| Variable | What |
|---|---|
| `GH_DISPATCH_TOKEN` | GitHub fine-grained PAT on this repo, **Contents: read and write** — that is the permission `repository_dispatch` requires |
| `AGENT_DISPATCH_SECRET` | any long random string. **Not needed for notifications** — those go straight from the database |
| `AGENT_REQUEST_INBOX` | unused now; the recipient is `notify_email` in `app_config` |
| `GH_AGENT_REPO` | optional; defaults to `Groundwork-Jalla/groundwork1` |

## 3. Database settings

In `app_config`, not as database parameters — Supabase refuses `ALTER DATABASE ... SET`
for custom parameters (`42501: permission denied to set parameter`), because the
dashboard role is not superuser.

Already set for notifications: `resend_api_key`, `notify_email`.

Only needed when turning the GitHub half on:

```sql
INSERT INTO public.app_config (key, value) VALUES
  ('agent_dispatch_url',    'https://www.tryjalla.com/api/agent-dispatch'),
  ('agent_dispatch_secret', '<the same AGENT_DISPATCH_SECRET as Vercel>')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
```

**`www`, not the apex** — `tryjalla.com` 308s to `www.tryjalla.com` and `pg_net` does not
follow redirects.

## 4. The recording account — do this, or the automation dies

`GW_REC_EMAIL` **must not be on the free plan.** Any run that films project creation
consumes a project slot permanently: archived projects count toward the cap and owner
deletion was removed in migration 053. A free account is finished after three runs.

```sql
UPDATE public.projects SET tier = 'jalla_management' WHERE user_id = '<recording-uid>';
```

The planner is told to prefer `wizard_preview`, which creates nothing, unless the brief
genuinely needs project creation on screen. That is a preference, not a guarantee.

---

## Running it by hand

```bash
node scripts/agent-produce.mjs              # everything pending
node scripts/agent-produce.mjs <request-id> # one request
```

Or **Actions → Agent requests → Run workflow**, optionally with a request id.

Every run keeps `out/` and the Vite log as an artifact for 7 days, so a failed video can
be inspected without re-running anything.

## What it costs

One Claude call per request (a page of JSON), plus GitHub Actions minutes — roughly
8–12 minutes per video. The 15-minute poll is nearly free; it exits immediately when the
queue is empty.

## Currently dormant

`ANTHROPIC_API_KEY` is not configured, so **automatic production is off**. That is a
supported state, not a half-finished one:

- The runner exits 0 with a one-line explanation, so the 15-minute schedule does not
  turn the Actions tab red.
- Requests are left untouched at `new`. Nothing is consumed, nothing is declined.
- `npm run agent:queue` still works exactly as before — file, brief, record, deliver.

Add the key as a GitHub secret and it switches on with no other change.

## What is not yet proven

The planner call and a real GitHub Actions run have **not** been executed — there is no
`ANTHROPIC_API_KEY` in the development environment and the workflow has never fired.
Everything downstream of the plan has been run end to end against the live app: the
player, the safety guards, the encoder, the checks and the upload.

The first run to watch is a `workflow_dispatch` with a known request id, with the
artifact downloaded afterwards.
