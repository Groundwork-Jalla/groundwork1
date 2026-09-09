import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';

/**
 * Take the PDFs of revoked certificates out of the public bucket.
 *
 * ── Why this is not SQL ──────────────────────────────────────────────────────────────
 * Migration 079 tried to `DELETE FROM storage.objects` and was refused:
 *
 *   ERROR 42501: Direct deletion from storage tables is not allowed.
 *                Use the Storage API instead.
 *
 * Supabase is right to guard it — deleting the row unlinks the record while leaving the
 * object itself orphaned in the bucket, so the statement that looks like it deletes a
 * file does not. The Storage API removes both.
 *
 * ── Why it has to exist at all ───────────────────────────────────────────────────────
 * The certificates bucket is public-read and `pdf_url` is a public URL. Marking a row
 * `revoked_at` stops `/verify/:id` vouching for it, but anyone still holding the link
 * downloads a document headed "Verified Completion". Revocation is not finished until
 * the file is gone.
 *
 * ── Safe to run repeatedly ───────────────────────────────────────────────────────────
 * It only ever looks at rows that are revoked and not yet purged, and it marks each one
 * as it goes. Running it twice does nothing the second time; running it after a new
 * revocation picks up exactly that one.
 */
export async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await requireUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    console.error('[cert-purge] SUPABASE_SERVICE_ROLE_KEY is not set');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  // The service role bypasses RLS, so the admin check is ours to make and cannot be
  // skipped by calling this directly.
  const { data: isAdmin } = await admin.rpc('is_admin');
  const { data: role } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'admin')
    .maybeSingle();

  if (!role && isAdmin !== true) {
    // Same answer as a wrong path: this endpoint's existence is not worth confirming.
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const { data: rows, error } = await admin
    .from('certificates')
    .select('id, storage_path')
    .not('revoked_at', 'is', null)
    .is('pdf_purged_at', null)
    .not('storage_path', 'is', null);

  if (error) {
    console.error('[cert-purge] could not list revoked certificates:', error.message);
    res.status(500).json({ error: 'Could not read certificates' });
    return;
  }

  const targets = (rows ?? []) as { id: string; storage_path: string }[];
  if (targets.length === 0) {
    res.status(200).json({ ok: true, purged: 0, message: 'Nothing revoked is still published.' });
    return;
  }

  const paths = targets.map(r => r.storage_path);
  const { error: removeError } = await admin.storage.from('certificates').remove(paths);

  if (removeError) {
    console.error('[cert-purge] storage removal failed:', removeError.message);
    res.status(500).json({ error: 'Could not remove the files', detail: removeError.message });
    return;
  }

  // Marked only after the files are actually gone. Marking first would leave a revoked
  // certificate that looks purged and is still downloadable — the one state this whole
  // handler exists to prevent.
  const { error: markError } = await admin
    .from('certificates')
    .update({ pdf_purged_at: new Date().toISOString(), pdf_url: null })
    .in('id', targets.map(r => r.id));

  if (markError) {
    // The files are gone, which is the part that mattered. The marking can be retried by
    // running this again — it is idempotent, and `remove` on an absent path is not an error.
    console.error('[cert-purge] files removed but rows not marked:', markError.message);
    res.status(200).json({ ok: true, purged: paths.length, marked: false });
    return;
  }

  res.status(200).json({ ok: true, purged: paths.length, marked: true });
}
