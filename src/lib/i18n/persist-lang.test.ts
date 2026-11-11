import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  getUser: vi.fn(), read: vi.fn(), write: vi.fn(), values: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: { getUser: db.getUser },
  from: () => ({
    update: (values: unknown) => { db.values(values); return { eq: db.write }; },
    select: () => ({ eq: () => ({ maybeSingle: db.read }) }),
  }),
} }));

import { fetchPreferredLang, persistPreferredLang, reconcileLang } from './persist-lang';

beforeEach(() => {
  vi.clearAllMocks();
  db.getUser.mockResolvedValue({ data: { user: { id: 'person-1' } } });
  db.write.mockResolvedValue({ error: null });
  db.read.mockResolvedValue({ data: { preferred_lang: null }, error: null });
});

describe('account communication language', () => {
  it('persists default English for an account with no preference', async () => {
    const remote = await fetchPreferredLang('person-1');
    const result = reconcileLang(null, remote!, 'en');
    expect(result).toEqual({ push: 'en' });
    await expect(persistPreferredLang(result.push!)).resolves.toBe(true);
    expect(db.values).toHaveBeenCalledWith({ preferred_lang: 'en' });
    expect(db.write).toHaveBeenCalledWith('id', 'person-1');
  });

  it('preserves an existing recipient preference when detection differs', async () => {
    db.read.mockResolvedValue({ data: { preferred_lang: 'fr' }, error: null });
    expect(reconcileLang(null, (await fetchPreferredLang('person-1'))!, 'en')).toEqual({ adopt: 'fr' });
  });

  it('distinguishes a failed read from an account without a language', async () => {
    db.read.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await expect(fetchPreferredLang('person-1')).resolves.toBeUndefined();
    expect(db.values).not.toHaveBeenCalled();
  });

  it('reports a failed write and allows the next auth reconciliation to retry', async () => {
    db.write.mockResolvedValueOnce({ error: { message: 'offline' } });
    await expect(persistPreferredLang('en')).resolves.toBe(false);
    await expect(persistPreferredLang('en')).resolves.toBe(true);
    expect(db.values).toHaveBeenCalledTimes(2);
  });

  it('does not update a profile while signed out', async () => {
    db.getUser.mockResolvedValue({ data: { user: null } });
    await expect(persistPreferredLang('en')).resolves.toBe(false);
    expect(db.values).not.toHaveBeenCalled();
  });
});
