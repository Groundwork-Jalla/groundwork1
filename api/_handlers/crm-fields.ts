import { ghlConfig, listCustomFields, createCustomField } from '../ghl/_client.js';
import { contractorFieldKeys } from '../ghl/_contractor-payload.js';

/**
 * Create the custom fields GoHighLevel needs, so it stops throwing our data away.
 *
 * ── The problem this exists for ──────────────────────────────────────────────────────
 * GHL discards any custom field the location has not already got, silently, with a 200.
 * On the contact the result is a blank — indistinguishable from a question the applicant
 * left empty. Project references 1, 2 and 3 were being dropped this way for weeks.
 *
 * A contractor application carries over a hundred fields. Creating those by hand is not a
 * reasonable ask, and hand-typing a hundred keys is also how two end up misspelled — at
 * which point they are silently dropped forever and look, again, like blanks.
 *
 * ── Dry run by default ───────────────────────────────────────────────────────────────
 * Creating a hundred fields in someone's live CRM is not something that should happen
 * because a button was near the mouse. Without `create: true` this only reports what is
 * missing. Nothing here ever deletes or edits an existing field: it compares by key and
 * creates only what is absent, so it is safe to run repeatedly and safe to run against a
 * location where someone has already made some by hand.
 */

/** Fields sent by the non-contractor events — signup, project, subscription, decision. */
const EVENT_FIELDS = [
  'user_id', 'application_id', 'application_url', 'decision',
  'subscription_status', 'subscription_tier', 'period_end',
  'project_id', 'project_name', 'project_tier',
  'build_country', 'build_city', 'lang',
];

/** `project_1_ref_email` → `Project 1 Ref Email`, so the GHL console stays readable. */
function humanise(key: string): string {
  return key.split('_').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const token = String(req.headers?.authorization ?? '').replace(/^Bearer /i, '');
  if (!token) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? key;
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || isAdmin !== true) {
    res.status(403).json({ error: 'Admins only' });
    return;
  }

  const cfg = ghlConfig();
  if (!cfg) {
    res.status(200).json({ ok: false, detail: 'GHL_API_TOKEN / GHL_LOCATION_ID not set' });
    return;
  }

  const wanted = [...new Set([...contractorFieldKeys(), ...EVENT_FIELDS])].sort();

  const existing = await listCustomFields(cfg);
  if (!existing.ok || !existing.data) {
    // The upstream body is returned here for the same reason as in crm-diagnose: the
    // caller is an admin, and the alternative is reading deploy logs.
    res.status(200).json({ ok: false, step: 'list', status: existing.status, detail: existing.error });
    return;
  }

  const have = new Set(existing.data.map(f => f.key));
  const missing = wanted.filter(k => !have.has(k));

  if (req.body?.create !== true) {
    res.status(200).json({
      ok: true, dryRun: true,
      total: wanted.length, present: wanted.length - missing.length,
      missingCount: missing.length, missing,
    });
    return;
  }

  const created: string[] = [];
  const failed: Array<{ key: string; error?: string }> = [];

  for (const k of missing) {
    const r = await createCustomField(cfg, k, humanise(k));
    if (r.ok) created.push(k);
    // One rejected field must not cost the other hundred — a partial run is still an
    // improvement, and re-running picks up whatever failed.
    else failed.push({ key: k, error: r.error?.slice(0, 120) });
  }

  res.status(200).json({
    ok: failed.length === 0,
    total: wanted.length,
    createdCount: created.length,
    failedCount: failed.length,
    created,
    failed: failed.slice(0, 20),
  });
}
