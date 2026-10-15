import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  read: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (...args: unknown[]) => {
          h.eq(...args);
          return { maybeSingle: h.read };
        },
      }),
    }),
  },
}));

import { mustChangePassword } from './provisioned';

describe('required password setup state', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([true, false])('returns the guarded profile flag when it is %s', async value => {
    h.read.mockResolvedValue({ data: { must_change_password: value }, error: null });
    expect(await mustChangePassword('client-id')).toBe(value);
    expect(h.eq).toHaveBeenCalledWith('id', 'client-id');
  });

  it('does not admit the client when the profile read fails', async () => {
    const error = new Error('Profile unavailable');
    h.read.mockResolvedValue({ data: null, error });
    await expect(mustChangePassword('client-id')).rejects.toBe(error);
  });

  it.each([null, {}, { must_change_password: null }])('does not treat an absent flag as completed setup: %s', async data => {
    h.read.mockResolvedValue({ data, error: null });
    await expect(mustChangePassword('client-id')).rejects.toThrow('Password setup status is unavailable');
  });

  it('does not admit the client when the request rejects', async () => {
    h.read.mockRejectedValue(new Error('Network unavailable'));
    await expect(mustChangePassword('client-id')).rejects.toThrow('Network unavailable');
  });
});
