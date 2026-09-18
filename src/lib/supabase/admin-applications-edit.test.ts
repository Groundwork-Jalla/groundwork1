import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Admin edits to a contractor application: the floor the row has to clear, the
 * column mapping, and the write itself against a faked client.
 */

const h = vi.hoisted(() => ({
  updates: [] as { values: Record<string, unknown>; id: string }[],
  updateError: null as unknown,
  row: null as Record<string, unknown> | null,
}));

vi.mock('./client', () => ({
  supabase: {
    from: (_table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: async (_c: string, id: string) => { h.updates.push({ values, id }); return { error: h.updateError }; },
      }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.row, error: null }) }) }),
    }),
  },
}));

import {
  applicationEditToRow, updateApplication, validateApplicationEdit, type ApplicationEdit,
} from './admin-applications';

const GOOD: ApplicationEdit = {
  fullName: ' Ada Client ', businessName: '', email: 'Ada@Example.CM', phone: '+237 6', country: 'CM',
  city: 'Douala', portfolioUrl: null, lang: 'fr', role: 'mason', roleOther: null,
  yearsExperience: 'y1_3', operatesAs: 'independent', teamSize: '  ', projectTypes: ['residential'],
  credentials: { tradeProjects: 'x', workStyle: 'crew' }, projects: [],
  acceptsMilestones: true, acceptsVerification: true, acceptsNoSidePay: false,
  videoUrl: '', whyJoin: 'w', differentiator: 'd', readyForEarly: true,
  regions: 'Littoral', concurrentProjects: 'one',
};

describe('validateApplicationEdit', () => {
  it('passes a complete edit', () => {
    expect(validateApplicationEdit(GOOD)).toBeNull();
  });

  it.each([
    ['fullName', { fullName: ' ' }],
    ['email', { email: 'not-an-email' }],
    ['phone', { phone: '' }],
    ['city', { city: '' }],
    ['role', { role: '' }],
    ['roleOther', { role: 'other', roleOther: '  ' }],     // the 081 CHECK
    ['yearsExperience', { yearsExperience: '' }],
    ['projectTypes', { projectTypes: [] }],
    ['whyJoin', { whyJoin: '' }],
    ['regions', { regions: '' }],
    ['concurrentProjects', { concurrentProjects: '' }],
  ] as [string, Partial<ApplicationEdit>][])('names %s as the first problem', (field, patch) => {
    expect(validateApplicationEdit({ ...GOOD, ...patch })).toBe(field);
  });

  it('does not require roleOther unless the role is other', () => {
    expect(validateApplicationEdit({ ...GOOD, role: 'mason', roleOther: '' })).toBeNull();
    expect(validateApplicationEdit({ ...GOOD, role: 'other', roleOther: 'Tiler' })).toBeNull();
  });
});

describe('applicationEditToRow', () => {
  const row = applicationEditToRow(GOOD);

  it('maps to the table columns and normalises text', () => {
    expect(row).toMatchObject({
      full_name: 'Ada Client', email: 'ada@example.cm', lang: 'fr', role: 'mason',
      years_experience: 'y1_3', operates_as: 'independent', project_types: ['residential'],
      accepts_no_side_pay: false, ready_for_early: true, concurrent_projects: 'one',
    });
  });

  it('stores optional blanks as NULL, never as empty strings', () => {
    expect(row.business_name).toBeNull();
    expect(row.team_size).toBeNull();
    expect(row.video_url).toBeNull();
    expect(row.portfolio_url).toBeNull();
  });

  it('clears role_other when the role is not other, so a stale value cannot linger', () => {
    expect(applicationEditToRow({ ...GOOD, role: 'mason', roleOther: 'Tiler' }).role_other).toBeNull();
    expect(applicationEditToRow({ ...GOOD, role: 'other', roleOther: 'Tiler' }).role_other).toBe('Tiler');
  });

  it('never writes what the admin may not change', () => {
    for (const col of ['status', 'uploads', 'agreed_to_terms', 'edited_at', 'edited_by', 'synced_to_ghl', 'acknowledged_at', 'created_at', 'id']) {
      expect(row, col).not.toHaveProperty(col);
    }
  });
});

describe('updateApplication', () => {
  beforeEach(() => {
    h.updates = []; h.updateError = null;
    h.row = { id: 'app-1', full_name: 'Ada Client', email: 'ada@example.cm', status: 'pending', edited_at: '2026-09-18T10:00:00Z', edited_by: 'admin-1', project_types: [] };
  });

  it('refuses an invalid edit before touching the database', async () => {
    await expect(updateApplication('app-1', { ...GOOD, email: 'nope' })).rejects.toThrow('invalid:email');
    expect(h.updates).toEqual([]);
  });

  it('writes the mapped row to the right id and reads the stamped row back', async () => {
    const fresh = await updateApplication('app-1', GOOD);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].id).toBe('app-1');
    expect(h.updates[0].values.full_name).toBe('Ada Client');
    // The stamp comes from the trigger, so it is only knowable by reading back.
    expect(fresh.editedAt).toBe('2026-09-18T10:00:00Z');
    expect(fresh.editedBy).toBe('admin-1');
  });

  it('surfaces a database error', async () => {
    h.updateError = { message: 'permission denied' };
    await expect(updateApplication('app-1', GOOD)).rejects.toMatchObject({ message: 'permission denied' });
  });
});

describe('migration 093 stamps edits in the database, not the client', () => {
  const sql = readFileSync(join(resolve(__dirname, '..', '..', '..'), 'supabase/migrations/093_application_edit_audit.sql'), 'utf8');

  it('fires BEFORE UPDATE on contractor_applications', () => {
    expect(sql).toMatch(/BEFORE UPDATE ON public\.contractor_applications/);
    expect(sql).toMatch(/NEW\.edited_by := auth\.uid\(\)/);
  });

  it('compares every applicant-content column, and no bookkeeping column', () => {
    const compared = [...sql.matchAll(/NEW\.([a-z_]+)/g)].map(m => m[1]);
    for (const col of ['full_name', 'email', 'phone', 'role', 'role_other', 'credentials', 'projects', 'why_join', 'regions', 'lang']) {
      expect(compared, col).toContain(col);
    }
    for (const col of ['status', 'uploads', 'agreed_to_terms', 'synced_to_ghl', 'acknowledged_at']) {
      expect(compared, col).not.toContain(col);
    }
  });

  it('lets the FK cascade null edited_by only when that admin is gone', () => {
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM auth\.users u WHERE u\.id = OLD\.edited_by\)/);
  });
});
