import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The contractor can prepare a client's project, but never receives a credential for
 * their account. In particular, neither a failed write nor an emailed link may expose
 * an account before its password gate and ownership link are ready.
 */

type Row = Record<string, unknown>;
type Failure = { message: string } | null;

const state = {
  caller: null as { id: string; email: string } | null,
  isContractor: false,
  hasAcceptedAssignment: false,
  adminUnavailable: false,
  existingProfile: null as { id: string } | null,
  profileLookupError: null as Failure,
  createUserError: null as Failure,
  createUserMissing: false,
  profileUpdateError: null as Failure,
  linkError: null as Failure,
  inviteError: null as Failure,
  pendingLinksError: null as Failure,
  pendingProfilesError: null as Failure,
  pendingProjectsError: null as Failure,
  pendingLinks: [] as Row[],
  pendingProfiles: [] as Row[],
  pendingProjects: [] as Row[],
  pendingQueries: [] as { table: string; columns: string; filters: Row }[],
  invitedUserId: 'new-client-id' as string | null,
  events: [] as string[],
  gateQueries: [] as { table: string; filters: Row }[],
  profileLookups: [] as Row[],
  createUserCalls: [] as Row[],
  profileUpdates: [] as { values: Row; id: string }[],
  links: [] as { values: Row; options: Row }[],
  invitations: [] as { email: string; options: Row }[],
  deletedUsers: [] as string[],
};

function fakeAdmin() {
  return {
    from(table: string) {
      const filters: Row = {};
      let columns = '';
      const chain: any = {
        select: (selected: string) => { columns = selected; return chain; },
        eq: (column: string, value: unknown) => { filters[column] = value; return chain; },
        ilike: (column: string, value: unknown) => { filters[column] = value; return chain; },
        in: (column: string, values: unknown[]) => { filters[column] = values; return chain; },
        or: (value: string) => { filters.or = value; return chain; },
        order: (column: string, options: Row) => { filters.order = { column, ...options }; return chain; },
        then: (resolve: (result: { data: Row[] | null; error: Failure }) => unknown) => {
          state.pendingQueries.push({ table, columns, filters });
          if (table === 'contractor_clients') {
            const data = state.pendingLinks.filter(link =>
              link.contractor_id === filters.contractor_id
                && (link.client_was_created === true || link.accepted_at != null))
              .sort((a, b) => String(b.invited_at).localeCompare(String(a.invited_at)));
            return Promise.resolve({ data, error: state.pendingLinksError }).then(resolve);
          }
          const ids = filters[table === 'profiles' ? 'id' : 'user_id'] as string[];
          const rows = table === 'profiles' ? state.pendingProfiles : state.pendingProjects;
          const data = rows.filter(row => ids.includes(String(row[table === 'profiles' ? 'id' : 'user_id'])));
          const error = table === 'profiles' ? state.pendingProfilesError : state.pendingProjectsError;
          return Promise.resolve({ data, error }).then(resolve);
        },
        limit: async () => {
          state.gateQueries.push({ table, filters });
          if (table === 'user_roles') {
            state.events.push('contractor_role');
            return { data: state.isContractor ? [{ role: 'contractor' }] : [], error: null };
          }
          state.events.push('accepted_assignment');
          return { data: state.hasAcceptedAssignment ? [{ id: 'assignment-1' }] : [], error: null };
        },
        maybeSingle: async () => {
          state.events.push('existing_account');
          state.profileLookups.push(filters);
          return { data: state.existingProfile, error: state.profileLookupError };
        },
        update: (values: Row) => ({
          eq: async (_column: string, id: string) => {
            state.events.push('profile_flags');
            state.profileUpdates.push({ values, id });
            return { error: state.profileUpdateError };
          },
        }),
        upsert: async (values: Row, options: Row) => {
          state.events.push('client_link');
          state.links.push({ values, options });
          return { error: state.linkError };
        },
      };
      return chain;
    },
    auth: {
      admin: {
        createUser: async (args: Row) => {
          state.events.push('create_user');
          state.createUserCalls.push(args);
          return {
            data: { user: state.createUserError || state.createUserMissing ? null : { id: 'new-client-id' } },
            error: state.createUserError,
          };
        },
        inviteUserByEmail: async (email: string, options: Row) => {
          state.events.push('send_invitation');
          state.invitations.push({ email, options });
          // Even if upstream includes sensitive fields, none belongs in the response.
          return {
            data: {
              user: state.invitedUserId ? { id: state.invitedUserId } : null,
              session: { access_token: 'private-access-token', refresh_token: 'private-refresh-token' },
            },
            error: state.inviteError,
          };
        },
        deleteUser: async (id: string) => {
          state.events.push('delete_user');
          state.deletedUsers.push(id);
          return { error: null };
        },
      },
    },
  };
}

vi.mock('../../../api/_lib/stripe', () => ({
  getSupabaseAdmin: () => {
    if (state.adminUnavailable) throw new Error('Missing service role key');
    return fakeAdmin();
  },
  requireUser: async () => state.caller,
}));

vi.mock('../site-url', () => ({ siteUrl: () => 'https://groundwork.test' }));

const { handler } = await import('../../../api/_handlers/contractor-invite-client');

async function call(body: Row = GOOD, method = 'POST') {
  const response: any = {
    statusCode: 0,
    body: null as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; return this; },
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
  };
  await handler({ method, headers: {}, body }, response);
  return response;
}

// A phone is now required: `profiles.phone` is the only thing WhatsApp delivery
// resolves a destination from, and a contractor-invited client used to get none —
// so they could never be reached on the channel most of them actually read.
const GOOD = { email: ' Client@Example.com ', fullName: ' Ada Client ', phone: '+237670000001' };

beforeEach(() => {
  state.caller = { id: 'contractor-1', email: 'contractor@example.com' };
  state.isContractor = true;
  state.hasAcceptedAssignment = false;
  state.adminUnavailable = false;
  state.existingProfile = null;
  state.profileLookupError = null;
  state.createUserError = null;
  state.createUserMissing = false;
  state.profileUpdateError = null;
  state.linkError = null;
  state.inviteError = null;
  state.pendingLinksError = null;
  state.pendingProfilesError = null;
  state.pendingProjectsError = null;
  state.pendingLinks = [];
  state.pendingProfiles = [];
  state.pendingProjects = [];
  state.pendingQueries = [];
  state.invitedUserId = 'new-client-id';
  state.events = [];
  state.gateQueries = [];
  state.profileLookups = [];
  state.createUserCalls = [];
  state.profileUpdates = [];
  state.links = [];
  state.invitations = [];
  state.deletedUsers = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('contractor and account ownership gates', () => {
  it('refuses other methods and missing sessions before doing any work', async () => {
    expect((await call(GOOD, 'PUT')).statusCode).toBe(405);
    state.caller = null;
    expect((await call()).statusCode).toBe(401);
    expect(state.events).toEqual([]);
  });

  it('returns 404 for a signed-in user without contractor standing and creates nothing', async () => {
    state.isContractor = false;
    const response = await call();
    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: 'Not found' });
    expect(state.events).toEqual(['contractor_role', 'accepted_assignment']);
    expect(state.createUserCalls).toEqual([]);
  });

  it('allows an accepted assignment and checks only the verified caller', async () => {
    state.isContractor = false;
    state.hasAcceptedAssignment = true;
    const response = await call({ ...GOOD, contractorId: 'forged-id', userId: 'forged-id' });
    expect(response.statusCode).toBe(200);
    expect(state.gateQueries).toEqual([
      { table: 'user_roles', filters: { user_id: 'contractor-1', role: 'contractor' } },
      { table: 'contractor_invites', filters: { contractor_user_id: 'contractor-1', status: 'accepted' } },
    ]);
    expect(state.links[0].values.contractor_id).toBe('contractor-1');
  });

  it('refuses invalid input without creating an account or sending email', async () => {
    expect((await call({ ...GOOD, email: 'not-an-email' })).body).toEqual({ error: 'invalid_email' });
    // Checked on the server, not merely normalised in the browser. `normalisePhone`
    // hands back whatever it was given when it cannot place a number, so "the field
    // had something in it" is not the same as "this reaches a handset".
    expect((await call({ ...GOOD, phone: '670000001' })).body).toEqual({ error: 'invalid_phone' });
    expect((await call({ ...GOOD, fullName: ' ' })).body).toEqual({ error: 'name_required' });
    expect(state.createUserCalls).toEqual([]);
    expect(state.invitations).toEqual([]);
  });

  it('but an absent phone is not invalid input — it is a question for the client', () => {
    // Asking a contractor for their client's number asks them to expose the
    // relationship they are protecting, and one who declines does not invite their
    // client at all. `new-password` asks the client for it when they accept.
    // Changed 29 October.
    return call({ ...GOOD, phone: '' }).then(response => {
      expect(response.body).not.toEqual({ error: 'invalid_phone' });
      expect(response.statusCode).toBe(200);
      expect(state.createUserCalls).toHaveLength(1);
      expect(state.invitations).toHaveLength(1);
    });
  });

  it('refuses inviting the caller, even when their email uses different casing', async () => {
    const response = await call({ ...GOOD, email: 'Contractor@Example.com' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: 'self_invite' });
    expect(state.createUserCalls).toEqual([]);
  });

  it('refuses an existing account without linking, modifying, or inviting it', async () => {
    state.existingProfile = { id: 'someone-else' };
    const response = await call();
    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ error: 'client_exists' });
    expect(state.profileLookups).toEqual([{ email: 'client@example.com' }]);
    expect(state.createUserCalls).toEqual([]);
    expect(state.profileUpdates).toEqual([]);
    expect(state.links).toEqual([]);
    expect(state.invitations).toEqual([]);
    expect(state.deletedUsers).toEqual([]);
  });

  it('refuses an auth duplicate caused by a racing signup without touching that account', async () => {
    state.createUserError = { message: 'A user with this email address has already been registered' };
    const response = await call();
    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ error: 'client_exists' });
    expect(state.profileUpdates).toEqual([]);
    expect(state.links).toEqual([]);
    expect(state.invitations).toEqual([]);
    expect(state.deletedUsers).toEqual([]);
  });
});

describe('the client owns their first credential', () => {
  it('creates an unconfirmed account without a password and marks the client invitation', async () => {
    const response = await call({ ...GOOD, password: 'contractor-chosen-password', email_confirm: true });
    expect(response.statusCode).toBe(200);
    expect(state.createUserCalls).toEqual([{
      email: 'client@example.com',
      email_confirm: false,
      user_metadata: {
        full_name: 'Ada Client',
        onboarding_complete: true,
        client_invited_by_contractor: true,
      },
    }]);
  });

  it('arms the profile gates and records the new client link before any email is sent', async () => {
    await call();
    expect(state.events).toEqual([
      'contractor_role', 'existing_account', 'create_user', 'profile_flags', 'client_link', 'send_invitation',
    ]);
    expect(state.profileUpdates).toHaveLength(1);
    expect(state.profileUpdates[0]).toMatchObject({
      id: 'new-client-id',
      values: { email_mfa_enabled: true, must_change_password: true, provisioned_by: 'contractor-1' },
    });
    expect(typeof state.profileUpdates[0].values.provisioned_at).toBe('string');
    expect(state.links).toEqual([{
      values: { contractor_id: 'contractor-1', client_id: 'new-client-id', client_was_created: true },
      options: { onConflict: 'contractor_id,client_id' },
    }]);
    expect(state.invitations).toEqual([{
      email: 'client@example.com',
      options: { redirectTo: 'https://groundwork.test/auth/callback?flow=client-invite' },
    }]);
  });

  it('returns only the account identity, with no password, tokens, or invitation link', async () => {
    const response = await call();
    expect(response.body).toEqual({ clientId: 'new-client-id', email: 'client@example.com' });
    expect(JSON.stringify(response.body)).not.toMatch(/password|token|redirectTo|https:/i);
    expect(state.deletedUsers).toEqual([]);
  });
});

describe('partial failures never send an unready invitation', () => {
  it('reports missing server configuration', async () => {
    state.adminUnavailable = true;
    const response = await call();
    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'Server is not configured' });
    expect(state.events).toEqual([]);
  });

  it('reports account creation errors and missing users before any later writes', async () => {
    for (const mode of ['error', 'missing-user']) {
      state.createUserError = mode === 'error' ? { message: 'Auth service unavailable' } : null;
      state.createUserMissing = mode === 'missing-user';
      const response = await call();
      expect(response.statusCode).toBe(500);
      expect(response.body).toEqual({ error: 'create_failed' });
    }
    expect(state.profileUpdates).toEqual([]);
    expect(state.links).toEqual([]);
    expect(state.invitations).toEqual([]);
  });

  it('fails closed if an existing account lookup cannot be completed', async () => {
    state.profileLookupError = { message: 'Profile service unavailable' };
    const response = await call();
    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'create_failed' });
    expect(state.createUserCalls).toEqual([]);
    expect(state.invitations).toEqual([]);
  });

  it('deletes the new account if its password gate cannot be armed', async () => {
    state.profileUpdateError = { message: 'Profile update failed' };
    const response = await call();
    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'create_failed' });
    expect(state.deletedUsers).toEqual(['new-client-id']);
    expect(state.links).toEqual([]);
    expect(state.invitations).toEqual([]);
  });

  it('deletes the new account if the contractor-client link cannot be written', async () => {
    state.linkError = { message: 'Link update failed' };
    const response = await call();
    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'link_failed' });
    expect(state.deletedUsers).toEqual(['new-client-id']);
    expect(state.invitations).toEqual([]);
  });

  it('deletes the new account and reports failure if Supabase cannot send the invitation', async () => {
    state.inviteError = { message: 'Email service unavailable' };
    const response = await call();
    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'invite_failed' });
    expect(state.events.slice(-2)).toEqual(['send_invitation', 'delete_user']);
    expect(state.deletedUsers).toEqual(['new-client-id']);
  });

  it('refuses an invitation result for another account or without a user', async () => {
    for (const invitedId of ['someone-else', null]) {
      state.invitedUserId = invitedId;
      state.deletedUsers = [];
      const response = await call();
      expect(response.statusCode).toBe(500);
      expect(response.body).toEqual({ error: 'invite_failed' });
      // Only the account this request created may be rolled back.
      expect(state.deletedUsers).toEqual(['new-client-id']);
    }
  });
});

describe('recovering clients whose project was not created', () => {
  function link(clientId: string, fields: Row = {}) {
    return {
      client_id: clientId,
      contractor_id: 'contractor-1',
      client_was_created: true,
      accepted_at: null,
      invited_at: '2026-10-20T01:00:00Z',
      ...fields,
    };
  }

  it('checks the authenticated contractor before reading client details', async () => {
    state.caller = null;
    const signedOut = await call({}, 'GET');
    expect(signedOut.statusCode).toBe(401);
    expect(signedOut.headers['Cache-Control']).toBe('no-store');
    state.caller = { id: 'contractor-1', email: 'contractor@example.com' };
    state.isContractor = false;
    expect((await call({}, 'GET')).statusCode).toBe(404);
    expect(state.pendingQueries).toEqual([]);
    expect(state.createUserCalls).toEqual([]);
    expect(state.invitations).toEqual([]);
  });

  it('allows the existing accepted-assignment gate without a role row', async () => {
    state.isContractor = false;
    state.hasAcceptedAssignment = true;
    const response = await call({}, 'GET');
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ clients: [] });
    expect(state.gateQueries[1]).toEqual({
      table: 'contractor_invites',
      filters: { contractor_user_id: 'contractor-1', status: 'accepted' },
    });
  });

  it('recovers only the caller’s authorized projectless clients, newest first', async () => {
    state.pendingLinks = [
      link('older-client', { invited_at: '2026-10-19T01:00:00Z' }),
      link('unsafe-client', { client_was_created: false }),
      link('other-contractor-client', { contractor_id: 'contractor-2' }),
      link('newer-client', { invited_at: '2026-10-21T01:00:00Z' }),
      link('accepted-client', { client_was_created: false, accepted_at: '2026-10-20T02:00:00Z' }),
      link('completed-client'),
    ];
    state.pendingProfiles = state.pendingLinks.map(row => ({
      id: row.client_id,
      full_name: row.client_id === 'older-client' ? null : `Name ${row.client_id}`,
      email: `${row.client_id}@example.com`,
      password: 'private-password',
      access_token: 'private-token',
    }));
    state.pendingProjects = [{ user_id: 'completed-client', created_by: 'the-client' }];

    // Caller-supplied ownership is never used to broaden the service-role query.
    const response = await call({ contractorId: 'contractor-2' }, 'GET');
    expect(response.statusCode).toBe(200);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(response.body).toEqual({ clients: [
      { clientId: 'newer-client', fullName: 'Name newer-client', email: 'newer-client@example.com', invitedAt: '2026-10-21T01:00:00Z' },
      { clientId: 'accepted-client', fullName: 'Name accepted-client', email: 'accepted-client@example.com', invitedAt: '2026-10-20T01:00:00Z' },
      { clientId: 'older-client', fullName: 'older-client@example.com', email: 'older-client@example.com', invitedAt: '2026-10-19T01:00:00Z' },
    ] });
    expect(state.pendingQueries).toEqual([
      {
        table: 'contractor_clients', columns: 'client_id, invited_at',
        filters: {
          contractor_id: 'contractor-1',
          or: 'client_was_created.eq.true,accepted_at.not.is.null',
          order: { column: 'invited_at', ascending: false },
        },
      },
      { table: 'profiles', columns: 'id, full_name, email', filters: { id: ['newer-client', 'accepted-client', 'completed-client', 'older-client'] } },
      { table: 'projects', columns: 'user_id', filters: { user_id: ['newer-client', 'accepted-client', 'completed-client', 'older-client'] } },
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/password|token|unsafe|other-contractor|completed/);
    expect(state.createUserCalls).toEqual([]);
    expect(state.links).toEqual([]);
    expect(state.invitations).toEqual([]);
  });

  it('does not query profiles or projects when no authorized links exist', async () => {
    const response = await call({}, 'GET');
    expect(response.body).toEqual({ clients: [] });
    expect(state.pendingQueries.map(query => query.table)).toEqual(['contractor_clients']);
  });

  it.each(['links', 'profiles', 'projects'])('fails closed when the %s read fails', async stage => {
    state.pendingLinks = [link('client-1')];
    const error = { message: 'Database read unavailable' };
    if (stage === 'links') state.pendingLinksError = error;
    if (stage === 'profiles') state.pendingProfilesError = error;
    if (stage === 'projects') state.pendingProjectsError = error;
    const response = await call({}, 'GET');
    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'pending_clients_failed' });
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(state.deletedUsers).toEqual([]);
    expect(state.invitations).toEqual([]);
  });
});
