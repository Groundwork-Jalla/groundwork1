import {
  ghlConfig, listContacts, listCustomFields, listPipelines,
  updateContactPhone, deleteContact, type GhlContactRow,
} from '../ghl/_client.js';
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
 * Contacts the Groundwork API never touched.
 *
 * ── NECESSARY BUT NOT SUFFICIENT ─────────────────────────────────────────────────────
 * This is an ABSENCE test, and on its own it is the same class of mistake as selecting
 * on phone shape. It selects everything the API never wrote to — which includes the
 * entire pre-Groundwork Jalla base: contacts added by hand, and ones the phone system
 * created from an inbound call it could not name.
 *
 * The tag list is dated March–May 2026 (`jalla-travel-lead`, `cost-guide-by-country`,
 * `founding_member_exit_popup`, the Skool imports). Those records are safe because they
 * carry tags. Their untagged contemporaries are not.
 *
 * So this narrows the field, and `deletable` below adds the positive test that actually
 * decides. Nothing is ever deleted on this predicate alone.
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

  // ── Pipeline ids, for ghl_stage_map ──
  // Folded into the audit rather than given its own route: it needs the same admin check
  // and the same config, and it is answering the same question — what is actually set up
  // in there. `{ "pipelines": true }` skips the contact walk entirely, so it is instant.
  if (req.body?.pipelines === true) {
    const pipes = await listPipelines(cfg);
    if (!pipes.ok || !pipes.data) {
      res.status(200).json({ ok: false, step: 'pipelines', status: pipes.status, detail: pipes.error });
      return;
    }
    res.status(200).json({
      ok: true,
      pipelines: pipes.data,
      // Paste-ready, PER PIPELINE. This used to fill in only when there was exactly one
      // pipeline, which is the case that never happens: this account has two contractor
      // pipelines, one from June and one made yesterday, and picking the wrong one
      // splits contractors across two boards where neither shows the whole picture.
      // Naming each suggestion means the choice is visible instead of assumed.
      suggestions: pipes.data.map(pipe => ({
        pipelineName: pipe.name,
        pipelineId: pipe.id,
        stageCount: pipe.stages.length,
        stageMap: pipe.stages.reduce<Record<string, string>>((map, st) => {
          const n = st.name.toLowerCase();
          const key = n.includes('applied')  ? 'contractor_application'
                    : n.includes('accepted') ? 'application_decision:accepted'
                    : n.includes('rejected') || n.includes('declined')
                                             ? 'application_decision:rejected'
                    : null;
          if (key) map[key] = st.id;
          return map;
        }, {}),
        // Named so an unmatched stage is visible rather than silently dropped — a
        // pipeline whose stages are called something else produces an empty map, and
        // that should look different from "no pipelines found".
        unmappedStages: pipe.stages
          .filter(st => !/applied|accepted|rejected|declined/i.test(st.name))
          .map(st => st.name),
      })),
    });
    return;
  }

  const people = await listContacts(cfg);
  if (!people.ok || !people.data) {
    res.status(200).json({ ok: false, step: 'contacts', status: people.status, detail: people.error });
    return;
  }
  const contacts = people.data;

  // ── Repair: rewrite a mangled +1 back to +237 ───────────────────────────────────────
  // Non-destructive, and deliberately separate from the delete. These are real people
  // whose only defect is a country code GoHighLevel guessed from the sub-account's
  // Maryland address; the record is worth keeping, the number is not.
  //
  // Matched live rather than from ids the caller supplies, so it cannot act on a stale
  // audit — and only where the phone shape *proves* the mangling, never on the compound
  // orphan rule alone, which also selects the phone system's own records.
  if (req.body?.fixPhones === true) {
    const targets = contacts.filter(c =>
      isOrphanRecord(c) && c.phone && isMisroutedCameroonian(c.phone));

    const fixed: Array<{ id: string; name: string; from: string; to: string }> = [];
    const failed: Array<{ id: string; error?: string }> = [];

    for (const c of targets) {
      const corrected = `+237${digitsOf(c.phone).slice(1)}`;
      const r = await updateContactPhone(cfg, c.id, corrected);
      if (r.ok) fixed.push({ id: c.id, name: c.name, from: c.phone, to: corrected });
      else failed.push({ id: c.id, error: r.error?.slice(0, 200) });
    }

    res.status(200).json({ ok: failed.length === 0, fixedCount: fixed.length, fixed, failed });
    return;
  }

  // ── Delete: only a record whose person survives it ──────────────────────────────────
  // An orphan goes *only* when a twin exists sharing its last nine digits and carrying
  // both an email and tags — the API-created record. Anything without such a twin is
  // repaired above and never deleted: one of the three mangled records has no twin, and
  // removing it would lose that contractor entirely.
  if (req.body?.deleteDuplicates === true) {
    const byLocalAll = new Map<string, GhlContactRow[]>();
    for (const c of contacts) {
      const k = localKey(c.phone);
      if (k.length === 9) (byLocalAll.get(k) ?? byLocalAll.set(k, []).get(k)!).push(c);
    }
    const survivor = (c: GhlContactRow) =>
      (byLocalAll.get(localKey(c.phone)) ?? [])
        .find(t => t.id !== c.id && t.email && t.tags.length > 0);

    const removable = contacts.filter(c => isOrphanRecord(c) && !!survivor(c));

    const removed: Array<{ id: string; name: string; phone: string; keptInstead: string }> = [];
    const failed: Array<{ id: string; error?: string }> = [];

    for (const c of removable) {
      const keeper = survivor(c)!;
      const r = await deleteContact(cfg, c.id);
      if (r.ok) removed.push({ id: c.id, name: c.name, phone: c.phone, keptInstead: keeper.id });
      else failed.push({ id: c.id, error: r.error?.slice(0, 200) });
    }

    res.status(200).json({ ok: failed.length === 0, removedCount: removed.length, removed, failed });
    return;
  }

  // ── Narrow the field (absence), then prove membership (presence) ──
  const orphans = contacts.filter(isOrphanRecord);

  // Every record the legacy webhook made has a contractor application behind it. Match
  // on the last nine digits, which survives both the `+1`/`+237` mangling and the
  // Nigerian case — it is the part of the number GHL never rewrites.
  //
  // This is the difference between "lacks our markers" and "provably came from the
  // duplicate path". A hand-added Jalla contact from March cannot match it.
  const svc = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: apps } = await svc
    .from('contractor_applications')
    .select('phone, business_name')
    .limit(5000);

  const applicationPhones = new Set(
    (apps ?? [])
      .map(a => digitsOf(String((a as { phone: unknown }).phone ?? '')).slice(-9))
      .filter(d => d.length === 9),
  );

  const deletable = orphans.filter(c => applicationPhones.has(localKey(c.phone)));
  // Orphans we could NOT tie to an application. These are the pre-Groundwork records
  // the absence test would have swept up. They are reported, never selected.
  const unprovable = orphans.filter(c => !applicationPhones.has(localKey(c.phone)));

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
    /**
     * THE DELETABLE SET. Lacks every Groundwork marker AND has a contractor application
     * behind it, matched on the last nine digits of the phone. Both conditions.
     */
    deletableRecords: deletable.length,

    /**
     * Orphans with no application behind them — almost certainly the pre-Groundwork
     * Jalla base (manual adds, phone-system contacts). REPORTED, NEVER SELECTED. If this
     * is large, the absence test alone would have deleted real contacts.
     */
    unprovableRecords: unprovable.length,
    unprovableSample: unprovable.slice(0, 10).map(c => ({
      id: c.id, name: c.name, phone: c.phone, created: c.createdAt,
    })),

    /**
     * The cheap check: deletable rows carrying no business name. A contractor
     * application without one is unusual, so an empty subset means the filter is clean.
     */
    deletableWithoutBusinessName: deletable.filter(c => !c.name).length,

    orphanRecords: orphans.length,
    /**
     * Capped at 15 for reading on screen. `{ "export": true }` returns the whole set
     * instead — deletion is irreversible and a sample is not something you can check
     * afterwards against what actually went.
     */
    orphanSample: (req.body?.export === true ? deletable : deletable.slice(0, 15)).map(c => ({
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
