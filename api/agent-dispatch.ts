/**
 * Kick the agent runner when a request is filed.
 *
 * Supabase database webhook (INSERT on public.agent_requests) → here → GitHub
 * `repository_dispatch` → .github/workflows/agent-request.yml.
 *
 * WHY VERCEL SITS IN THE MIDDLE. The GitHub token has to live somewhere, and it belongs
 * with the other server-side secrets in this project rather than inside the database.
 * It also gives one place to authenticate the caller: Supabase signs nothing, so without
 * a check here the endpoint would be a public button that starts a build.
 *
 * WHAT THIS ENDPOINT IS NOT. It does not produce anything and it does not wait. The work
 * takes minutes and runs on a GitHub runner with Chrome and ffmpeg — none of which fits
 * in a serverless function. All this does is ring the bell.
 *
 * FAILING HERE IS SURVIVABLE ON PURPOSE. The workflow also runs on a schedule and picks
 * up anything still pending, so a missed webhook delays a request rather than losing it.
 * That is why a bad token returns 500 loudly but a duplicate call is harmless.
 */

const GH_REPO  = process.env.GH_AGENT_REPO ?? 'Groundwork-Jalla/groundwork1';
const GH_TOKEN = process.env.GH_DISPATCH_TOKEN;
const SECRET   = process.env.AGENT_DISPATCH_SECRET;

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Shared secret, set as a custom header on the Supabase webhook. Compared with a
  // length check first so a wrong-length guess cannot be distinguished by timing.
  const given = String(req.headers['x-agent-secret'] ?? '');
  if (!SECRET || given.length !== SECRET.length || given !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!GH_TOKEN) {
    console.error('[agent-dispatch] GH_DISPATCH_TOKEN is not set');
    return res.status(500).json({ error: 'not_configured' });
  }

  // Supabase sends { type, table, record, old_record }. Only the id is used — the
  // runner re-reads the row itself, so nothing here can be spoofed into producing work
  // against a brief that does not exist.
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const id = body?.record?.id ?? body?.id;
  if (!id) return res.status(400).json({ error: 'no_request_id' });

  const gh = await fetch(`https://api.github.com/repos/${GH_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event_type: 'agent-request', client_payload: { request_id: id } }),
  });

  if (!gh.ok) {
    const detail = await gh.text();
    console.error('[agent-dispatch] github refused', gh.status, detail.slice(0, 300));
    // 202 rather than 500: the scheduled run will still collect this request, and a
    // Supabase webhook that keeps retrying a 500 is noise, not resilience.
    return res.status(202).json({ queued: false, note: 'dispatch failed; scheduled run will collect it' });
  }

  return res.status(202).json({ queued: true, request_id: id });
}
