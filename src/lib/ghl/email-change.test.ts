import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * A changed sign-in email has to reach the CRM as a change to the SAME contact.
 * The upsert path keys on email, so sending the new address through it would create a
 * stranger; this pins the path that addresses the contact by id instead, and the order
 * in which the contact is found.
 */

const h = vi.hoisted(() => ({
  calls: [] as { fn: string; args: unknown[] }[],
  found: null as null | { id: string },
  findOk: true,
  updateOk: true,
}));

vi.mock('../../../api/ghl/_client', () => ({
  ghlConfig: async () => ({ token: 't', locationId: 'loc' }),
  upsertContact: async (_cfg: unknown, input: unknown) => { h.calls.push({ fn: 'upsert', args: [input] }); return { ok: true, status: 200, data: { contactId: 'fresh-id' } }; },
  addContactTags: async () => ({ ok: true, status: 200 }),
  moveToStage: async () => ({ ok: true, status: 200 }),
  updateContactEmail: async (_cfg: unknown, id: string, email: string) => { h.calls.push({ fn: 'update', args: [id, email] }); return h.updateOk ? { ok: true, status: 200 } : { ok: false, status: 422, error: 'nope' }; },
  findContactByEmail: async (_cfg: unknown, email: string) => { h.calls.push({ fn: 'find', args: [email] }); return h.findOk ? { ok: true, status: 200, data: h.found } : { ok: false, status: 0 }; },
}));
vi.mock('../../../api/ghl/_config', () => ({ ghlSettings: async () => ({ GHL_EVENT_WEBHOOK_URL: { value: '' } }) }));

const { deliver } = await import('../../../api/ghl/_forward');

beforeEach(() => { h.calls = []; h.found = null; h.findOk = true; h.updateOk = true; });

describe('deliver("email_changed")', () => {
  it('re-addresses the known contact by id and never upserts', async () => {
    const r = await deliver('email_changed', 'new@x.cm', { email: 'new@x.cm' }, { old_email: 'old@x.cm', contact_id: 'ghl-1', user_id: 'u' });
    expect(r).toMatchObject({ ok: true, contactId: 'ghl-1', via: 'api' });
    expect(h.calls).toEqual([{ fn: 'update', args: ['ghl-1', 'new@x.cm'] }]);
  });

  it('with no stored id, finds the contact by the OLD address (from the payload) and updates it', async () => {
    h.found = { id: 'ghl-found' };
    const r = await deliver('email_changed', 'new@x.cm', { email: 'new@x.cm' }, { old_email: 'old@x.cm', contact_id: null, user_id: 'u' });
    expect(r).toMatchObject({ ok: true, contactId: 'ghl-found' });
    expect(h.calls.map(c => c.fn)).toEqual(['find', 'update']);
    expect(h.calls[0].args).toEqual(['old@x.cm']);
    expect(h.calls[1].args).toEqual(['ghl-found', 'new@x.cm']);
  });

  it('with nothing to find, creates the person under the new address rather than guessing', async () => {
    h.found = null;
    const r = await deliver('email_changed', 'new@x.cm', { email: 'new@x.cm' }, { old_email: 'old@x.cm', contact_id: null, user_id: 'u' });
    expect(r).toMatchObject({ ok: true, contactId: 'fresh-id' });
    expect(h.calls.map(c => c.fn)).toEqual(['find', 'upsert']);
    expect(h.calls[1].args[0]).toMatchObject({ email: 'new@x.cm' });
  });

  it('reports a failed lookup as a failure to retry, not as "not found"', async () => {
    h.findOk = false;
    const r = await deliver('email_changed', 'new@x.cm', { email: 'new@x.cm' }, { old_email: 'old@x.cm', contact_id: null, user_id: 'u' });
    expect(r.ok).toBe(false);
    expect(h.calls.map(c => c.fn)).toEqual(['find']);      // no upsert on the back of an outage
  });

  it('a rejected update is a failure with the status kept', async () => {
    h.updateOk = false;
    const r = await deliver('email_changed', 'new@x.cm', { email: 'new@x.cm' }, { old_email: 'old@x.cm', contact_id: 'ghl-1', user_id: 'u' });
    expect(r).toMatchObject({ ok: false, reason: 'rejected', status: 422 });
  });
});

describe('the pieces are wired', () => {
  const ROOT = resolve(__dirname, '..', '..', '..');
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').split('\n').filter(l => !/^\s*(\*|\/[/*])/.test(l)).join('\n');

  it('the database queues the change with the old address, server-side', () => {
    const sql = read('supabase/migrations/095_email_change_to_crm.sql');
    expect(sql).toMatch(/AFTER UPDATE OF email ON auth\.users/);
    expect(sql).toMatch(/'email_changed'/);
    expect(sql).toMatch(/'old_email',\s*lower\(OLD\.email\)/);
    expect(sql).toMatch(/ON CONFLICT \(dedupe_key\) DO NOTHING/);
  });

  it('the retry job knows the event, so a failed row is not parked as unknown', () => {
    expect(read('api/_handlers/retry.ts')).toMatch(/v === 'email_changed'/);
  });

  it('the sync handler only ever reads the caller\'s own rows', () => {
    const src = read('api/_handlers/crm-email-sync.ts');
    expect(src).toMatch(/\.eq\('payload->>user_id', user\.id\)/);
    expect(src).not.toMatch(/req\.body/);
  });

  it('the confirmation link triggers the prompt attempt', () => {
    const src = read('src/app/routes/auth/callback.tsx');
    expect(src).toMatch(/type'\) === 'email_change'[\s\S]*syncEmailChangeToCrm\(\)/);
  });

  it('exactly-one match: the lookup refuses to pick between duplicates', () => {
    expect(read('api/ghl/_client.ts')).toMatch(/exact\.length !== 1\) return \{ ok: true, status: r\.status, data: null \}/);
  });
});
