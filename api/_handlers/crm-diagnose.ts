import { ghlConfig } from '../ghl/_client.js';
import { signDocuments } from '../ghl/_documents.js';

/**
 * Why didn't the documents upload?
 *
 * The media endpoint in `_client.ts` was written from GoHighLevel's documentation with no
 * token to test against, and it is not working. Guessing at the path or the body shape
 * from here means a deploy per guess and a person clicking through GHL each time to check.
 *
 * This asks GHL directly and returns **the actual status and response body**, which names
 * the fault in one round trip: a 404 is the path, a 401 or 403 is a missing scope, a 422
 * is the body shape.
 *
 * ── Why this one returns the upstream body when nothing else does ────────────────────
 * Everywhere else we deliberately withhold it, because upstream errors can name account
 * internals and the browser has no use for them. Here the upstream error *is* the answer,
 * the caller is an authenticated admin, and the alternative is reading Vercel logs. The
 * body is truncated and the token never appears in it.
 *
 * Safe to run repeatedly: it uploads one real document, which is also the only honest way
 * to test an upload.
 */

const API_BASE = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';

/** Tried in order, first success wins. GHL has moved this endpoint between versions. */
const CANDIDATE_PATHS = ['/medias/upload-file'];

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
    res.status(200).json({ step: 'config', ok: false, detail: 'GHL_API_TOKEN / GHL_LOCATION_ID not set' });
    return;
  }

  const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Any application that actually has a document. Testing with a fabricated URL would
  // prove nothing about whether GHL can reach our storage.
  const { data: rows } = await svc
    .from('contractor_applications')
    .select('id, uploads')
    .not('uploads', 'eq', '[]')
    .order('created_at', { ascending: false })
    .limit(5);

  const withDocs = (rows ?? []).find(r => Array.isArray(r.uploads) && r.uploads.length > 0);
  if (!withDocs) {
    res.status(200).json({ step: 'documents', ok: false, detail: 'No application has an uploaded document' });
    return;
  }

  const signed = await signDocuments(svc, withDocs.uploads);
  const fileUrl = signed.find(Boolean);
  if (!fileUrl) {
    res.status(200).json({
      step: 'sign', ok: false,
      detail: 'Supabase would not sign the document. Check the contractor-docs bucket and the stored path.',
    });
    return;
  }

  // Confirm the signed link actually serves the file before blaming GHL for not
  // fetching it — otherwise a storage problem reads as an API problem.
  let reachable = 0;
  try {
    const probe = await fetch(fileUrl, { method: 'GET' });
    reachable = probe.status;
  } catch { reachable = 0; }

  const attempts: Array<Record<string, unknown>> = [];

  for (const path of CANDIDATE_PATHS) {
    try {
      const r = await fetch(API_BASE + path, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Version: API_VERSION,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          hosted: true,
          fileUrl,
          name: `diagnose-${withDocs.id}`,
          locationId: cfg.locationId,
        }),
      });
      const body = await r.text();
      attempts.push({ path, status: r.status, body: body.slice(0, 600) });
      if (r.ok) break;
    } catch (err) {
      attempts.push({ path, status: 0, body: String(err).slice(0, 300) });
    }
  }

  res.status(200).json({
    step: 'upload',
    applicationId: withDocs.id,
    documentCount: Array.isArray(withDocs.uploads) ? withDocs.uploads.length : 0,
    signedLinkStatus: reachable,   // 200 = our storage is serving it correctly
    attempts,
  });
}
