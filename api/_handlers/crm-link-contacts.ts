import { ghlConfig, listContacts } from '../ghl/_client.js';
import { planLinks, summarise } from '../ghl/_contact-links.js';

/**
 * Link existing profiles to their GoHighLevel contact — Source 2 (06 §17).
 *
 * A bounded, admin-only maintenance action with no UI: called from the browser console
 * on /admin/crm with the session token. Dry-run by default; `apply: true` writes.
 *
 * ── What it does ─────────────────────────────────────────────────────────────────────
 * Fetches the contact book once, decides every unlinked profile with `planLinks`, and
 * reports. With `apply: true` it writes the `eligible` pairs — each behind
 * `ghl_contact_id IS NULL` in the database, so a profile linked meanwhile (by Source 1,
 * by crm-user/crm-project, by a previous run) is never overwritten — and returns every
 * row it changed. That list is the rollback list.
 *
 * ── What it refuses ──────────────────────────────────────────────────────────────────
 * To apply on an incomplete book. `listContacts` returns partial results rather than
 * nothing when a page fails, and stops at its cap; either would make `not_found` and
 * `ambiguous` unreliable, so an incomplete fetch reports and will not write.
 *
 * Re-running after success is a no-op: the population is recomputed from IS NULL.
 */

const BOOK_MAX = 2000;

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

  const cfg = await ghlConfig();
  if (!cfg) {
    res.status(200).json({ ok: false, detail: 'The GHL API is not configured' });
    return;
  }

  const apply = req.body?.apply === true;
  const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // The population: every profile, so `taken` can see who already owns a contact. Only
  // the unlinked ones are ever decided upon; the linked ones are reported as such.
  const { data: profiles, error: profErr } = await svc.from('profiles').select('id, email, ghl_contact_id');
  if (profErr || !profiles) {
    res.status(500).json({ error: 'Could not read profiles', detail: profErr?.message });
    return;
  }

  const book = await listContacts(cfg, { max: BOOK_MAX });
  const complete = book.ok && book.status === 200 && (book.data?.length ?? 0) < BOOK_MAX;
  if (!book.ok || !book.data) {
    res.status(200).json({ ok: false, detail: 'Could not read the contact book', status: book.status });
    return;
  }

  const plan = planLinks(profiles, book.data.map(c => ({ id: c.id, email: c.email })));
  const counts = summarise(plan);
  const eligible = plan.filter(p => p.decision === 'eligible');
  const report = plan.filter(p => p.decision !== 'already_linked');

  if (!apply || !complete) {
    res.status(200).json({
      ok: true, dryRun: true, applied: 0, complete,
      contacts: book.data.length, profiles: profiles.length, counts, report,
      ...(apply && !complete ? { refused: 'contact book incomplete — nothing written' } : {}),
    });
    return;
  }

  // Write the eligible pairs, one guarded UPDATE each, and return exactly what changed.
  const written: Array<{ profile_id: string; email: string | null; contact_id: string }> = [];
  const failed: Array<{ profile_id: string; error: string }> = [];
  for (const p of eligible) {
    const { data, error } = await svc
      .from('profiles')
      .update({ ghl_contact_id: p.contact_id })
      .eq('id', p.profile_id)
      .is('ghl_contact_id', null)
      .select('id, email, ghl_contact_id');
    if (error) { failed.push({ profile_id: p.profile_id, error: error.message }); continue; }
    for (const row of data ?? []) written.push({ profile_id: row.id, email: row.email, contact_id: row.ghl_contact_id });
  }

  res.status(200).json({
    ok: failed.length === 0, dryRun: false, applied: written.length, complete,
    contacts: book.data.length, profiles: profiles.length, counts, written, failed, report,
  });
}
