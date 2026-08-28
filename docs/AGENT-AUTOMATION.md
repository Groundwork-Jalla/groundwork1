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

## Notifications — the part worth setting up first

Every filed request emails the team inbox with the whole brief and the exact command to
produce it. This is independent of automatic production, and it is the half that matters
most: with production off, an email is the only thing between a brief and silence.

**To get notifications you need three things, and none of them is an API key:**

1. Migrations **054** (the table) and **056** (the trigger) applied.
2. `AGENT_DISPATCH_SECRET` set on Vercel — any long random string.
3. The two database settings under *§3*, using that same secret.

`RESEND_API_KEY` is already configured. `GH_DISPATCH_TOKEN` and `ANTHROPIC_API_KEY` are
**not** needed — without them the GitHub half simply reports "not configured" and the
email still sends, because the two run under `Promise.allSettled`.

Mail goes to `AGENT_REQUEST_INBOX`, falling back to `TEAM_INBOX`, falling back to
`contact@tryjalla.com`. Set the first if requests should reach a different address from
contractor applications.

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
| `AGENT_DISPATCH_SECRET` | any long random string — **needed for notifications too** |
| `AGENT_REQUEST_INBOX` | optional; where request emails go (defaults to `TEAM_INBOX`) |
| `GH_AGENT_REPO` | optional; defaults to `Groundwork-Jalla/groundwork1` |

## 3. Database settings

Run once, then reconnect — database settings only apply to new sessions:

```sql
ALTER DATABASE postgres SET app.agent_dispatch_url    = 'https://tryjalla.com/api/agent-dispatch';
ALTER DATABASE postgres SET app.agent_dispatch_secret = '<the same AGENT_DISPATCH_SECRET>';
```

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
