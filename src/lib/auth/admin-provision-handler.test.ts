import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The handler against a faked Supabase admin client: every refusal, the shape of the
 * account it creates, and what it does when the second write fails. The source-scan
 * guards in provisioned.test.ts pin the properties; this pins the behaviour.
 */

type Row = Record<string, unknown>;

const state = {
  caller: null as null | { id: string },
  isAdmin: false,
  existingProfile: null as null | { id: string },
  createUserError: null as null | { message: string },
  profileUpdateError: null as null | { message: string },
  createUserCalls: [] as Row[],
  profileUpdates: [] as { values: Row; id: string }[],
  deletedUsers: [] as string[],
};

function fakeAdmin() {
  return {
    from(table: string) {
      const q: Row = {};
      const chain: any = {
        select: () => chain, eq: (col: string, v: unknown) => { q[col] = v; return chain; },
        ilike: () => chain,
        maybeSingle: async () => {
          if (table === 'user_roles') return { data: state.isAdmin ? { role: 'admin' } : null };
          if (table === 'profiles')   return { data: state.existingProfile };
          return { data: null };
        },
        update: (values: Row) => ({
          eq: async (_c: string, id: string) => {
            state.profileUpdates.push({ values, id });
            return { error: state.profileUpdateError };
          },
        }),
      };
      return chain;
    },
    auth: {
      admin: {
        createUser: async (args: Row) => {
          state.createUserCalls.push(args);
          if (state.createUserError) return { data: { user: null }, error: state.createUserError };
          return { data: { user: { id: 'new-user-id' } }, error: null };
        },
        deleteUser: async (id: string) => { state.deletedUsers.push(id); return { error: null }; },
      },
    },
  };
}

vi.mock('../../../api/_lib/stripe', () => ({
  getSupabaseAdmin: () => fakeAdmin(),
  requireUser: async () => state.caller,
}));

const { handler } = await import('../../../api/_handlers/admin-provision-user');

function call(body: Row, method = 'POST') {
  const res: any = {
    statusCode: 0, body: null as unknown,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  return handler({ method, headers: {}, body }, res).then(() => res);
}

const GOOD = { email: 'Client@Example.com', fullName: 'Ada Client', phone: '+237 6 12 34 56 78', country: 'cm', lang: 'fr' };

beforeEach(() => {
  state.caller = { id: 'admin-1' };
  state.isAdmin = true;
  state.existingProfile = null;
  state.createUserError = null;
  state.profileUpdateError = null;
  state.createUserCalls = [];
  state.profileUpdates = [];
  state.deletedUsers = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('refusals', () => {
  it('405 on anything but POST', async () => {
    expect((await call(GOOD, 'GET')).statusCode).toBe(405);
  });
  it('401 without a session', async () => {
    state.caller = null;
    expect((await call(GOOD)).statusCode).toBe(401);
  });
  it('404 — not 403 — for a signed-in non-admin, and creates nothing', async () => {
    state.isAdmin = false;
    const res = await call(GOOD);
    expect(res.statusCode).toBe(404);
    expect(state.createUserCalls).toEqual([]);
  });
  it('400 for a malformed email or a missing name', async () => {
    expect((await call({ ...GOOD, email: 'not-an-email' })).body).toEqual({ error: 'invalid_email' });
    expect((await call({ ...GOOD, fullName: ' ' })).body).toEqual({ error: 'name_required' });
    expect((await call({ ...GOOD, country: 'Cameroon' })).body).toEqual({ error: 'invalid_country' });
    expect(state.createUserCalls).toEqual([]);
  });
  it('409 when the email already has an account, and never issues a password for it', async () => {
    state.existingProfile = { id: 'someone-else' };
    const res = await call(GOOD);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'email_taken' });
    expect(state.createUserCalls).toEqual([]);
  });
  it('409 when Supabase itself reports the duplicate (a race with a self sign-up)', async () => {
    state.createUserError = { message: 'A user with this email address has already been registered' };
    const res = await call(GOOD);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'email_taken' });
  });
});

describe('the account it creates', () => {
  it('is confirmed, managed, past onboarding, and carries the collected details', async () => {
    const res = await call(GOOD);
    expect(res.statusCode).toBe(200);

    const [args] = state.createUserCalls;
    expect(args.email).toBe('client@example.com');          // normalised
    expect(args.email_confirm).toBe(true);
    expect(args.user_metadata).toMatchObject({
      full_name: 'Ada Client',
      phone: '+237 6 12 34 56 78',
      country: 'CM',
      tier: 'jalla_management',
      onboarding_complete: true,
    });
  });

  it('marks the profile provisioned with both first-sign-in steps armed', async () => {
    await call(GOOD);
    const [{ values, id }] = state.profileUpdates;
    expect(id).toBe('new-user-id');
    expect(values).toMatchObject({
      email_mfa_enabled: true,
      must_change_password: true,
      provisioned_by: 'admin-1',
      preferred_lang: 'fr',
      country: 'CM',
    });
    expect(typeof values.provisioned_at).toBe('string');
  });

  it('returns the temporary password once, and it is the one given to Supabase', async () => {
    const res = await call(GOOD);
    expect(res.body).toEqual({
      userId: 'new-user-id',
      email: 'client@example.com',
      password: state.createUserCalls[0].password,
    });
    expect(res.body.password).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
  });

  it('treats an unknown lang as English rather than failing', async () => {
    await call({ ...GOOD, lang: 'de' });
    expect(state.profileUpdates[0].values.preferred_lang).toBe('en');
  });
});

describe('when the second write fails', () => {
  it('deletes the half-made account and reports failure', async () => {
    state.profileUpdateError = { message: 'boom' };
    const res = await call(GOOD);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'create_failed' });
    expect(state.deletedUsers).toEqual(['new-user-id']);
  });
});
