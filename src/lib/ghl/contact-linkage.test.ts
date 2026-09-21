import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planLinks, summarise } from '../../../api/ghl/_contact-links';

/**
 * GHL contact ↔ Groundwork profile linkage (06 §16.15–16.16), step 1: `crm-project`
 * persists the contact id the CRM hands back, exactly as `crm-user` does — onto the
 * OWNER's profile, never over an id it already has.
 *
 * Static pins: the forward is an external call, so the handler is proven by shape here
 * and by the production check in step 3 (a new homeowner project leaves
 * `profiles.ghl_contact_id` non-null with no manual intervention).
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const PROJECT = 'api/_handlers/project.ts';
const USER = 'api/_handlers/user.ts';

describe('crm-project persists the returned contact id', () => {
  const h = code(PROJECT);
  const at = (s: string) => { const i = h.indexOf(s); expect(i, `missing: ${s}`).toBeGreaterThan(-1); return i; };

  it('reads the OWNER\'s existing id and passes it to the forward, so a linked owner is addressed directly', () => {
    expect(h).toMatch(/select\('full_name, email, country, preferred_lang, ghl_contact_id'\)\s*\.eq\('id', project\.user_id\)/);
    expect(h).toContain('contactId: ownerContactId,');
    expect(h).toContain("const ownerContactId = (profile?.ghl_contact_id as string | null) ?? null;");
  });

  it('stamps the OWNER (project.user_id), never the caller (user.id)', () => {
    const stamp = h.slice(at("update({ ghl_contact_id: result.contactId })"), at('.select(\'id\');'));
    expect(stamp).toContain(".eq('id', project.user_id)");
    expect(stamp).not.toContain('user.id)');
  });

  it('only on a successful forward that returned an id, and only when the owner has none — with the null check ALSO in the database', () => {
    expect(h).toContain('if (result.ok && result.contactId && !ownerContactId) {');
    const stamp = h.slice(at("update({ ghl_contact_id: result.contactId })"), at('.select(\'id\');'));
    expect(stamp).toContain(".is('ghl_contact_id', null)");
  });

  it('a bookkeeping failure is logged, never a failed response; the response reports whether it linked', () => {
    expect(h).toContain("console.warn('[ghl] project forwarded but owner contact id not stored:', linkErr);");
    expect(h).toContain('res.status(200).json({ ok: result.ok, reason: result.reason, linked });');
    expect(h).toContain('linked = !linkErr && (stamped?.length ?? 0) > 0;');
    // The forward's own outcome is untouched: the link happens after it and does not gate it.
    expect(at("const result = await forwardToGhl('project_created'")).toBeLessThan(at('if (result.ok && result.contactId && !ownerContactId) {'));
  });

  it('matches the crm-user pattern: the id is only ever set from forwardToGhl\'s result, never from the request', () => {
    for (const f of [PROJECT, USER]) {
      const c = code(f);
      expect(c, f).not.toMatch(/ghl_contact_id:\s*(req\.body|body\.)/);
      expect(c, f).toMatch(/ghl_contact_id: result\.contactId/);
    }
  });

  it('the owner check and 404 shape are unchanged — this adds a write after the forward, nothing before it', () => {
    expect(h).toContain("res.status(404).json({ error: 'Project not found' });");
    expect(at("res.status(404).json({ error: 'Project not found' });")).toBeLessThan(at("select('full_name, email, country, preferred_lang, ghl_contact_id')"));
  });

  it('the outbox/custom-field user_id is the OWNER, not the caller (admin-created projects used to stamp the admin)', () => {
    expect(h).toContain('user_id:      project.user_id as string,');
    expect(h).not.toMatch(/user_id:\s+user\.id/);
  });
});

describe('Source 1 script — the same CTE drives report and apply', () => {
  const sql = src('supabase/maintenance/link-ghl-contacts-source1.sql');
  const report = sql.slice(sql.indexOf('-- ─── A. REPORT'), sql.indexOf('-- ─── B. APPLY'));
  const apply = sql.slice(sql.indexOf('-- ─── B. APPLY'));
  const strip = (t: string) => t.replace(/^\s*--.*$/gm, '').replace(/\s+/g, ' ').trim();

  it('identity is event-aware: user_signup by payload.user_id, project_created by project_id → projects.user_id; nothing else', () => {
    for (const part of [report, apply]) {
      const signup = strip(part).match(/SELECT o\.id AS outbox_id[\s\S]*?UNION ALL/)?.[0] ?? '';
      const project = strip(part).match(/UNION ALL[\s\S]*?\), judged AS/)?.[0] ?? '';
      expect(signup).toContain("p.id::text = o.payload->>'user_id'");
      expect(signup).toContain("o.event = 'user_signup'");
      expect(project).toContain("pr.id::text = o.payload->>'project_id'");
      expect(project).toContain('p.id = pr.user_id');
      expect(project).toContain("o.event = 'project_created'");
      expect(project).not.toContain("payload->>'user_id'");                              // never the caller's id for projects
      expect((part.match(/o\.event = '/g) ?? []).length).toBe(2);                       // exactly two event types
      expect(part).toMatch(/o\.status = 'sent' AND o\.contact_id IS NOT NULL/);
    }
  });

  it('email consistency, conflict, mismatch and orphan rules are identical in both halves', () => {
    const rules = (t: string) => strip(t).match(/WITH evidence AS[\s\S]*?per_profile AS \([\s\S]*?GROUP BY j\.profile_id/)?.[0]
      .replace(/,\s*count\(\*\)\s*FILTER \(WHERE j\.evidence_state = 'mismatch'\) AS mismatched_rows|,\s*array_agg\(DISTINCT j\.contact_id\) AS all_contact_ids/g, '');
    expect(rules(report)).toBeTruthy();
    expect(rules(report)).toBe(rules(apply));
    expect(report).toContain("e.outbox_email IS DISTINCT FROM e.profile_email THEN 'mismatch'");
    expect(report).toContain("e.profile_id IS NULL THEN 'orphan'");
    expect(report).toContain("count(DISTINCT j.contact_id) FILTER (WHERE j.evidence_state = 'consistent')");
  });

  it('the write is guarded twice by IS NULL, takes only consistent_ids = 1, and RETURNS every changed row', () => {
    expect(apply).toMatch(/WHERE p\.ghl_contact_id IS NULL AND pp\.consistent_ids = 1/);
    expect(apply).toMatch(/AND p\.ghl_contact_id IS NULL\s+-- the guard, again, at write time/);
    expect(apply).toMatch(/RETURNING p\.id AS profile_id, p\.email, p\.ghl_contact_id;\s*$/);
    expect(apply).not.toMatch(/INSERT|DELETE|DROP|ALTER/);
  });

  it('is maintenance, not a migration', () => {
    const { execSync } = require('node:child_process');
    expect(execSync('ls supabase/migrations', { cwd: ROOT, encoding: 'utf8' })).not.toContain('link-ghl-contacts');
  });
});

describe('Source 2 — planLinks decides, nothing else', () => {
  const P = (id: string, email: string | null, linked: string | null = null) => ({ id, email, ghl_contact_id: linked });
  const C = (id: string, email: string) => ({ id, email });

  it('exactly one contact with the email, unowned → eligible; case and whitespace do not matter', () => {
    const plan = planLinks([P('p1', '  Alice@Example.COM ')], [C('c1', 'alice@example.com')]);
    expect(plan[0]).toMatchObject({ decision: 'eligible', contact_id: 'c1', contact_ids: ['c1'] });
  });
  it('no email → no_email; no contact → not_found; two contacts → ambiguous with both ids listed', () => {
    expect(planLinks([P('p1', null)], [C('c1', 'a@x.y')])[0].decision).toBe('no_email');
    expect(planLinks([P('p1', '')], [C('c1', 'a@x.y')])[0].decision).toBe('no_email');
    expect(planLinks([P('p1', 'b@x.y')], [C('c1', 'a@x.y')])[0].decision).toBe('not_found');
    const amb = planLinks([P('p1', 'a@x.y')], [C('c1', 'a@x.y'), C('c2', 'A@X.Y')])[0];
    expect(amb).toMatchObject({ decision: 'ambiguous', contact_id: null, contact_ids: ['c1', 'c2'] });
  });
  it('a contact already owned by another profile → taken; by the same profile → already_linked', () => {
    const plan = planLinks([P('p1', 'a@x.y'), P('p2', 'a@x.y', 'c1')], [C('c1', 'a@x.y')]);
    expect(plan[0]).toMatchObject({ decision: 'taken', contact_id: null });
    expect(plan[1]).toMatchObject({ decision: 'already_linked', contact_ids: ['c1'] });
  });
  it('already-linked profiles are outside the population whatever the book says', () => {
    const plan = planLinks([P('p1', 'a@x.y', 'c_old')], [C('c_new', 'a@x.y')]);
    expect(plan[0]).toMatchObject({ decision: 'already_linked', contact_id: null, contact_ids: ['c_old'] });
  });
  it('contacts without an email, or duplicated rows of the same contact, are not evidence', () => {
    expect(planLinks([P('p1', 'a@x.y')], [C('c1', ''), C('c2', 'a@x.y'), C('c2', 'a@x.y')])[0]).toMatchObject({ decision: 'eligible', contact_id: 'c2' });
  });
  it('is idempotent: applying the plan and planning again yields no eligible rows', () => {
    const profiles = [P('p1', 'a@x.y'), P('p2', 'b@x.y'), P('p3', 'c@x.y')];
    const book = [C('c1', 'a@x.y'), C('c2', 'b@x.y'), C('c3', 'b@x.y')];
    const first = planLinks(profiles, book);
    expect(summarise(first)).toEqual({ eligible: 1, no_email: 0, not_found: 1, ambiguous: 1, taken: 0, already_linked: 0 });
    const after = profiles.map(p => { const d = first.find(x => x.profile_id === p.id)!; return d.decision === 'eligible' ? { ...p, ghl_contact_id: d.contact_id } : p; });
    expect(summarise(planLinks(after, book))).toEqual({ eligible: 0, no_email: 0, not_found: 1, ambiguous: 1, taken: 0, already_linked: 1 });
  });
});

describe('crm-link-contacts — bounded, admin-only, dry-run by default', () => {
  const h = code('api/_handlers/crm-link-contacts.ts');
  const at = (s: string) => { const i = h.indexOf(s); expect(i, `missing: ${s}`).toBeGreaterThan(-1); return i; };

  it('is an events.ts action (no new function), gated on is_admin via the caller\'s own token before anything else', () => {
    expect(src('api/events.ts')).toContain("'crm-link-contacts': crmLinkContacts,");
    expect(at("asCaller.rpc('is_admin')")).toBeLessThan(at('listContacts(cfg'));
    expect(h).toContain("res.status(403).json({ error: 'Admins only' });");
    expect(h).toContain("res.status(401).json({ error: 'Sign in required' });");
  });
  it('fetches the book once, capped; refuses to apply on an incomplete book; writes only with apply: true', () => {
    expect((h.match(/listContacts\(/g) ?? []).length).toBe(1);
    expect(h).toContain('const complete = book.ok && book.status === 200 && (book.data?.length ?? 0) < BOOK_MAX;');
    expect(h).toContain("const apply = req.body?.apply === true;");
    expect(h).toContain('if (!apply || !complete) {');
    expect(at('if (!apply || !complete) {')).toBeLessThan(at(".update({ ghl_contact_id: p.contact_id })"));
    expect(h).toContain("refused: 'contact book incomplete — nothing written'");
  });
  it('writes only eligible pairs, each behind IS NULL in the database, and returns exactly what changed', () => {
    expect(h).toContain("const eligible = plan.filter(p => p.decision === 'eligible');");
    const write = h.slice(at('for (const p of eligible) {'), at('applied: written.length'));
    expect(write).toContain(".is('ghl_contact_id', null)");
    expect(write).toContain(".select('id, email, ghl_contact_id')");
    expect(h).toContain('applied: written.length');
    expect(h).not.toMatch(/\.delete\(|\.insert\(|\.upsert\(/);
  });
  it('never touches GHL beyond reading the book, and nothing else in the database', () => {
    expect(h).not.toMatch(/upsertContact|addContactTags|deleteContact|updateContactPhone|ghlFetch/);
    expect((h.match(/\.from\('/g) ?? []).map(String).every(s => s === ".from('")).toBe(true);
    expect(h.match(/\.from\('([a-z_]+)'\)/g)).toEqual([".from('profiles')", ".from('profiles')"]);
  });
});
