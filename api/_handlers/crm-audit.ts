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
 * A number that is *provably* Cameroonian wearing a US country code.
 *
 * ── This is a confirmation signal, NOT the selection rule ────────────────────────────
 * `+1` followed by exactly nine digits starting with 6 cannot be a North American
 * number — those are `+1` plus ten — so there are no false positives here. But it does
 * not generalise, and selecting on it would be wrong in two directions:
 *
 *   · Groundwork is diaspora-facing. Legitimate homeowners in the US and Canada are
 *     `+1` contacts, and they are the actual customer base. Deleting on a `+1` rule is
 *     deleting customers.
 *   · A Nigerian mobile is ten digits. Mangled the same way it becomes `+1` + ten,
 *     which is indistinguishable by shape from a real US number. Nigeria is next after
 *     Cameroon across thirteen countries, so those are coming.
 *
 * So the junk is selected by the compound state below, and this only corroborates it.
 */
export function isMisroutedCameroonian(phone: string): boolean {
  const d = digitsOf(phone);
  return d.startsWith('1') && CM_MOBILE.test(d.slice(1));
}

/**
 * The records the legacy webhook left behind.
 *
 * Identity comes from what the contact *lacks*, which is country-independent: the
 * workflow does not map the email, applies no tags, and sets no contact source. The API
 * path sets all three on every contact it touches. So a contact missing all three was
 * not created by us through the API, whatever its phone looks like.
 *
 * Country-agnostic on purpose — see the note above.
 */
export function isOrphanRecord(c: { email: string; tags: string[]; source: string }): boolean {
  return !c.email
    && !c.tags.some(t => t.startsWith('groundwork'))
    && !c.source;
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

  // ── The selection rule: what the record lacks, not what its phone looks like ──
  const orphans = contacts.filter(isOrphanRecord);

  // ── Corroboration only ──
  const misrouted = contacts.filter(c => c.phone && isMisroutedCameroonian(c.phone));
  const orphansWithMangledPhone = orphans.filter(c => c.phone && isMisroutedCameroonian(c.phone));

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
    /**
     * THE DELETABLE SET: no email, no groundwork tag, no contact source. Country-
     * independent, so it catches a mangled Nigerian number too — which the phone-shape
     * rule cannot, because `+1` plus ten digits is a valid US number.
     */
    orphanRecords: orphans.length,
    /**
     * Capped at 15 for reading on screen. `{ "export": true }` returns the whole set
     * instead — deletion is irreversible and a sample is not something you can check
     * afterwards against what actually went.
     */
    orphanSample: (req.body?.export === true ? orphans : orphans.slice(0, 15)).map(c => ({
      id: c.id, name: c.name, phone: c.phone, email: c.email,
      tags: c.tags.join(' '), source: c.source, created: c.createdAt,
      // Present only when the shape proves it. Absent is not evidence of innocence —
      // a mangled Nigerian number looks exactly like a real US one.
      mangledFrom: isMisroutedCameroonian(c.phone) ? `+237${digitsOf(c.phone).slice(1)}` : null,
    })),
    exported: req.body?.export === true,

    /**
     * Corroboration, not selection. How much of the orphan set the Cameroon phone-shape
     * rule independently confirms — a high overlap means the theory holds; the shortfall
     * is the non-Cameroonian numbers the shape rule structurally cannot see.
     */
    misroutedCameroonianPhones: misrouted.length,
    orphansConfirmedByPhoneShape: orphansWithMangledPhone.length,

    /**
     * Contacts with a mangled-looking phone that are NOT orphans. Should be zero. Any
     * number here is a contact we would have deleted on a phone-shape rule and should
     * not have — review before touching anything.
     */
    misroutedButNotOrphaned: misrouted.filter(c => !isOrphanRecord(c)).length,
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
