import { ghlConfig, listContacts, listCustomFields, type GhlContactRow } from '../ghl/_client.js';
import { contractorFieldKeys } from '../ghl/_contractor-payload.js';

/**
 * What is actually in the CRM, and what is wrong with it.
 *
 * ── Read-only, on purpose ────────────────────────────────────────────────────────────
 * Nothing here deletes, merges or edits anything. Cleaning up someone's live CRM is a
 * destructive act against 600-odd records, and it should not be designed from a
 * screenshot of two pages. This counts the problems precisely first, so that whatever
 * gets deleted afterwards is a decision rather than a guess.
 *
 * ── The problem it was written for ───────────────────────────────────────────────────
 * GoHighLevel stamps a country code onto any phone number it is handed without one, and
 * this sub-account is registered in Maryland — so `654896710`, a Cameroonian mobile,
 * became `+1654896710`, a *valid US number belonging to a stranger*. Those contacts
 * carry no email, so GHL could not match them to the real person and created a second
 * record instead.
 *
 * That is worse than a formatting bug. Connect WhatsApp to this account as it stands and
 * an unknown number of messages go to Americans who have never heard of Groundwork.
 */

/** A Cameroonian mobile: nine digits beginning 6. Landlines begin 2. */
const CM_MOBILE = /^6\d{8}$/;

const digitsOf = (phone: string) => phone.replace(/\D/g, '');

/**
 * A number that is almost certainly Cameroonian wearing a US country code.
 *
 * Deliberately narrow. `+1` followed by exactly the shape of a CM mobile is the specific
 * corruption we know GHL produces; a genuine US number is `+1` plus ten digits and does
 * not match. Being narrow here means a real American contact is never counted as junk.
 */
export function isMisroutedCameroonian(phone: string): boolean {
  const d = digitsOf(phone);
  return d.startsWith('1') && CM_MOBILE.test(d.slice(1));
}

/** The last nine digits — what two records for the same person share. */
const localKey = (phone: string) => digitsOf(phone).slice(-9);

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

  const people = await listContacts(cfg);
  if (!people.ok || !people.data) {
    res.status(200).json({ ok: false, step: 'contacts', status: people.status, detail: people.error });
    return;
  }
  const contacts = people.data;

  // ── Misrouted numbers ──
  const misrouted = contacts.filter(c => c.phone && isMisroutedCameroonian(c.phone));

  // ── Duplicates: two records whose phones end in the same nine digits ──
  const byLocal = new Map<string, GhlContactRow[]>();
  for (const c of contacts) {
    const k = localKey(c.phone);
    if (k.length !== 9) continue;
    (byLocal.get(k) ?? byLocal.set(k, []).get(k)!).push(c);
  }
  const duplicateGroups = [...byLocal.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([local, rows]) => ({
      local,
      // The keeper is the one with an email — that is the record our upsert matches on
      // and the one carrying the tags and custom fields.
      keep: rows.find(r => r.email)?.id ?? rows[0].id,
      rows: rows.map(r => ({
        id: r.id, name: r.name, phone: r.phone,
        hasEmail: !!r.email, tags: r.tags.length, created: r.createdAt,
      })),
    }));

  // ── Records that are probably not ours ──
  const noEmail   = contacts.filter(c => !c.email);
  const untagged  = contacts.filter(c => !c.tags.some(t => t.startsWith('groundwork')));

  // ── Fields still in a bad state ──
  const wanted = contractorFieldKeys();
  const fields = await listCustomFields(cfg);
  const corrupted = fields.ok && fields.data
    ? fields.data.filter(f => f.key.startsWith('contact') && wanted.includes(f.key.slice('contact'.length)))
    : [];

  res.status(200).json({
    ok: true,
    contacts: contacts.length,
    // The headline. Every one of these is a real US number we could message by mistake.
    misroutedPhones: misrouted.length,
    misroutedSample: misrouted.slice(0, 10).map(c => ({
      id: c.id, name: c.name, phone: c.phone,
      shouldBe: `+237${digitsOf(c.phone).slice(1)}`,
      hasEmail: !!c.email, source: c.source,
    })),
    duplicateGroupCount: duplicateGroups.length,
    duplicateRecords: duplicateGroups.reduce((n, g) => n + g.rows.length - 1, 0),
    duplicateSample: duplicateGroups.slice(0, 10),
    withoutEmail: noEmail.length,
    withoutGroundworkTag: untagged.length,
    corruptedFieldCount: corrupted.length,
    corruptedFields: corrupted.map(f => f.key).slice(0, 20),
    // So the source of the junk records is visible rather than guessed at.
    sourceBreakdown: Object.entries(
      contacts.reduce<Record<string, number>>((acc, c) => {
        const s = c.source || '(none)';
        acc[s] = (acc[s] ?? 0) + 1;
        return acc;
      }, {}),
    ).sort((a, b) => b[1] - a[1]).slice(0, 15),
  });
}
