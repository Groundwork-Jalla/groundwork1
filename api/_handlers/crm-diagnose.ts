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
 * the fault in one round trip: a 404 is the path, a 401 or 403 is a missing scope, a 400
 * or 422 is the body shape.
 *
 * ── What the first run answered ──────────────────────────────────────────────────────
 *   400 "Unsupported content type: application/json"
 * The path and the token were both fine; `/medias/upload-file` does not take JSON at all.
 * It wants the request a browser's file input produces — multipart/form-data. What it is
 * not explicit about is *where* the location goes and whether it wants the bytes or a URL
 * it can fetch, so the variants below are tried in order and the first success wins. Note
 * that Content-Type is never set by hand for these: fetch must generate the multipart
 * boundary itself, and setting the header manually is what silently breaks that.
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

const UPLOAD_PATH = '/medias/upload-file';

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
  const idx = signed.findIndex(Boolean);
  const fileUrl = idx >= 0 ? signed[idx] : '';
  if (!fileUrl) {
    res.status(200).json({
      step: 'sign', ok: false,
      detail: 'Supabase would not sign the document. Check the contractor-docs bucket and the stored path.',
    });
    return;
  }

  // Fetch the bytes once, and confirm our own storage serves them before blaming GHL —
  // otherwise a storage problem reads as an API problem. The bytes are then reused by the
  // variants that send the file itself rather than a link to it.
  let reachable = 0;
  let bytes: ArrayBuffer | null = null;
  let contentType = 'application/octet-stream';
  try {
    const probe = await fetch(fileUrl, { method: 'GET' });
    reachable = probe.status;
    if (probe.ok) {
      bytes = await probe.arrayBuffer();
      contentType = probe.headers.get('content-type') || contentType;
    }
  } catch { reachable = 0; }

  const uploads = Array.isArray(withDocs.uploads) ? withDocs.uploads : [];
  const source  = (uploads[idx] ?? {}) as { label?: string; path?: string };
  const ext      = (source.path?.match(/\.[a-zA-Z0-9]+$/)?.[0]) ?? '';
  // Short, and clearly marked as a test upload so it is safe to delete from Media Storage.
  const name     = `diagnose-${withDocs.id.slice(0, 8)}`;
  const filename = `${name}${ext}`;

  const variants: Array<{ label: string; url: string; body: FormData }> = [];

  if (bytes) {
    // A — the bytes, with the location named in the form.
    const a = new FormData();
    a.append('file', new Blob([bytes], { type: contentType }), filename);
    a.append('name', name);
    a.append('locationId', cfg.locationId);
    variants.push({ label: 'multipart · file · locationId in form', url: API_BASE + UPLOAD_PATH, body: a });

    // B — the bytes, with the location as altId/altType, which is how v2 addresses a
    // location on several of its non-contact routes.
    const b = new FormData();
    b.append('file', new Blob([bytes], { type: contentType }), filename);
    b.append('name', name);
    variants.push({
      label: 'multipart · file · altId/altType query',
      url: `${API_BASE}${UPLOAD_PATH}?altId=${encodeURIComponent(cfg.locationId)}&altType=location`,
      body: b,
    });
  }

  // C — hand GHL the link and let it fetch. Works only while the signed URL is alive,
  // which is minutes, but costs us no egress if it is supported.
  const c = new FormData();
  c.append('hosted', 'true');
  c.append('fileUrl', fileUrl);
  c.append('name', name);
  c.append('locationId', cfg.locationId);
  variants.push({ label: 'multipart · hosted fileUrl', url: API_BASE + UPLOAD_PATH, body: c });

  const attempts: Array<Record<string, unknown>> = [];

  for (const v of variants) {
    try {
      const r = await fetch(v.url, {
        method: 'POST',
        // No Content-Type: fetch must set it, boundary and all.
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Version: API_VERSION,
          Accept: 'application/json',
        },
        body: v.body,
      });
      const body = await r.text();
      attempts.push({ variant: v.label, status: r.status, body: body.slice(0, 600) });
      if (r.ok) break;
    } catch (err) {
      attempts.push({ variant: v.label, status: 0, body: String(err).slice(0, 300) });
    }
  }

  res.status(200).json({
    step: 'upload',
    applicationId: withDocs.id,
    documentCount: uploads.length,
    signedLinkStatus: reachable,   // 200 = our storage is serving it correctly
    fileBytes: bytes ? bytes.byteLength : 0,
    contentType,
    winner: attempts.find(a => typeof a.status === 'number' && (a.status as number) >= 200 && (a.status as number) < 300)?.variant ?? null,
    attempts,
  });
}
