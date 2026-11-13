import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ roles: [] as any[], viewer: null as any, contractor: null as any, viewerError: null as any,
  user: vi.fn(), forward: vi.fn(), admin: { from: vi.fn() } }));
vi.mock('../../../api/_lib/stripe.js', () => ({ requireUser: h.user, getSupabaseAdmin: () => h.admin }));
vi.mock('../../../api/ghl/_forward.js', () => ({ forwardToGhl: h.forward }));
import { handler } from '../../../api/_handlers/crm-lifecycle';

beforeEach(() => {
  vi.clearAllMocks(); h.roles = [{ role: 'contractor' }]; h.contractor = null; h.viewerError = null;
  h.viewer = { id: 'membership', is_client: true, invited_by: 'creator', accepted_at: '2026-11-13', revoked_at: null };
  h.user.mockResolvedValue({ id: 'actor', email: 'actor@example.test' }); h.forward.mockResolvedValue({ ok: true });
  h.admin.from.mockImplementation((table: string) => {
    const result = () => ({ error: table === 'project_viewers' ? h.viewerError : null, data:
      table === 'profiles' ? { id: 'actor', full_name: 'Ada', email: 'actor@example.test', preferred_lang: 'en' }
        : table === 'user_roles' ? h.roles
        : table === 'contractor_onboarding' ? { client_intent: 'onboard_client' }
        : table === 'projects' ? { id: 'project', user_id: 'creator', name: 'Home' }
        : table === 'project_viewers' ? h.viewer : h.contractor });
    const q: any = { select: () => q, eq: () => q, maybeSingle: async () => result(), then: (resolve: any) => Promise.resolve(result()).then(resolve) };
    return q;
  });
});

async function report() {
  const response: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ method: 'POST', body: { event: 'invitation_accepted', projectId: 'project' } }, response);
  return response;
}

describe('project roles determine invitation communication', () => {
  it('keeps a global contractor on the client journey when they are this project’s primary client', async () => {
    await report();
    expect(h.forward).toHaveBeenCalledWith('invitation_accepted', expect.anything(), expect.objectContaining({
      user_role: 'client', entry_source: 'client_invitation', inviter_role: 'contractor',
    }), expect.objectContaining({ party: 'Homeowner' }));
  });
  it('routes an accepted primary contractor by membership even if their earlier account role was client', async () => {
    h.roles = []; h.viewer = null; h.contractor = { id: 'contractor', status: 'accepted', is_primary: true, invited_by: 'creator' };
    await report();
    expect(h.forward).toHaveBeenCalledWith('invitation_accepted', expect.anything(), expect.objectContaining({
      user_role: 'contractor', entry_source: 'contractor_invitation', inviter_role: 'client',
    }), expect.objectContaining({ party: 'Contractor' }));
  });
  it('keeps observers out of primary-client and contractor onboarding sequences', async () => {
    h.viewer.is_client = false;
    const response = await report();
    expect(response.json).toHaveBeenCalledWith({ ok: false, reason: 'observer_or_secondary' });
    expect(h.forward).not.toHaveBeenCalled();
  });
  it('rejects revoked access instead of scheduling a welcome sequence', async () => {
    h.viewer.revoked_at = '2026-11-13';
    const response = await report();
    expect(response.json).toHaveBeenCalledWith({ ok: false, reason: 'not_a_member' });
    expect(h.forward).not.toHaveBeenCalled();
  });
  it('does not invent a project role when membership reads fail', async () => {
    h.viewerError = { code: '42501' };
    const response = await report();
    expect(response.status).toHaveBeenCalledWith(503);
    expect(h.forward).not.toHaveBeenCalled();
  });
});
