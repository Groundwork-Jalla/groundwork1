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
  auditInsertError: null as null | { message: string },
  auditRows: [] as Row[],
  roleInsertError: null as null | { message: string },
  roleRows: [] as Row[],
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
        insert: async (row: Row) => {
          if (table === 'project_audit_log') {
            state.auditRows.push(row);
            return { error: state.auditInsertError };
          }
          if (table === 'user_roles') {
            state.roleRows.push(row);
            return { error: state.roleInsertError };
          }
          return { error: null };
        },
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
  state.auditInsertError = null;
  state.auditRows = [];
  state.roleInsertError = null;
  state.roleRows = [];
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

  it('records the provisioning as a person-level activity row (089): no project, actor = the verified caller', async () => {
    await call(GOOD);
    expect(state.auditRows).toHaveLength(1);
    expect(state.auditRows[0]).toMatchObject({
      project_id: null,
      action: 'client.provisioned',
      actor_id: 'admin-1',
      person_id: 'new-user-id',
      entity_type: 'profile',
      entity_id: 'new-user-id',
    });
    // Nothing from the request body decides who the actor is.
    expect(state.auditRows[0].actor_id).not.toBe('new-user-id');
  });

  it('still provisions when the audit row cannot be written (089 not yet applied)', async () => {
    state.auditInsertError = { message: 'column "person_id" does not exist' };
    const res = await call(GOOD);
    expect(res.statusCode).toBe(200);
    expect(state.deletedUsers).toEqual([]);
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

describe('the role', () => {
  /**
   * The role is the only thing on this form that confers privilege, so it is the only
   * thing worth testing twice: that the asked-for role is what lands, and that no other
   * value can reach `user_roles` at all.
   */

  it('defaults to a client when the body says nothing, and gives a client NO role row (032)', async () => {
    const res = await call(GOOD);
    expect(res.statusCode).toBe(200);
    expect(state.roleRows).toEqual([]);
    expect(state.createUserCalls[0].user_metadata).toMatchObject({ tier: 'jalla_management' });
  });

  it('grants contractor and verifier rows naming the new account, not the caller', async () => {
    for (const role of ['contractor', 'verifier'] as const) {
      state.roleRows = [];
      const res = await call({ ...GOOD, role });
      expect(res.statusCode).toBe(200);
      expect(state.roleRows).toEqual([{ user_id: 'new-user-id', role }]);
    }
  });

  it('gives a contractor or verifier no tier: a plan on an account with no projects would be read as one', async () => {
    await call({ ...GOOD, role: 'contractor' });
    expect((state.createUserCalls[0].user_metadata as Row).tier).toBeUndefined();
  });

  it('refuses admin — staff privilege is not granted from the form that makes a contractor', async () => {
    const res = await call({ ...GOOD, role: 'admin' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_role' });
    expect(state.createUserCalls).toEqual([]);
    expect(state.roleRows).toEqual([]);
  });

  it('refuses an unknown or non-string role before the account exists, rather than quietly making a client', async () => {
    // 'constructor' and '__proto__' are the interesting ones: they are truthy under `in`,
    // so a prototype-chain check would have accepted them and inserted Object's own
    // constructor as the role.
    for (const role of ['homeowner', 'Contractor', 'verifier ', '', 'constructor', '__proto__', 'toString', 42, null, {}]) {
      state.createUserCalls = [];
      const res = await call({ ...GOOD, role });
      // `undefined` is the only absent-means-client case; everything else is refused.
      expect(res.body).toEqual({ error: 'invalid_role' });
      expect(state.createUserCalls).toEqual([]);
    }
  });

  it('rolls the account back when the role grant fails, rather than handing over a silent client', async () => {
    state.roleInsertError = { message: 'duplicate key value violates unique constraint' };
    const res = await call({ ...GOOD, role: 'verifier' });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'create_failed' });
    expect(state.deletedUsers).toEqual(['new-user-id']);
  });

  it('names the role in the audit row, keeping the action name existing readers rely on', async () => {
    await call({ ...GOOD, role: 'verifier' });
    expect(state.auditRows[0]).toMatchObject({
      action: 'client.provisioned',
      actor_id: 'admin-1',
      details: { email: 'client@example.com', role: 'verifier', tier: null, by: 'admin' },
    });
  });

  it('still provisions a verifier when only the audit row fails', async () => {
    state.auditInsertError = { message: 'column "person_id" does not exist' };
    const res = await call({ ...GOOD, role: 'verifier' });
    expect(res.statusCode).toBe(200);
    expect(state.roleRows).toEqual([{ user_id: 'new-user-id', role: 'verifier' }]);
    expect(state.deletedUsers).toEqual([]);
  });
});
