import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildShareHtml } from '@/lib/email/share-html';

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), fetch: vi.fn(), funnel: vi.fn(), lifecycle: vi.fn() }));
vi.mock('./client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
vi.mock('@/lib/i18n', () => ({ detectLang: () => 'en' }));
vi.mock('@/lib/analytics/funnel', () => ({ trackFunnel: h.funnel }));
vi.mock('@/lib/analytics/lifecycle', () => ({ trackLifecycle: h.lifecycle }));
import { fetchProjectTeamAccess, setProjectClient } from './project-team';
import { inviteContractor, revokeInvite } from './invites';
import { acceptProjectViewer, fetchProjectViewers, fetchViewerSummaries, getViewerInvitePreview, inviteProjectViewer } from './project-viewers';

function query(data: unknown) {
  const q: any = { select: vi.fn(() => q), eq: vi.fn(() => q), in: vi.fn(() => q), is: vi.fn(() => q),
    order: vi.fn(async () => ({ data, error: null })), maybeSingle: vi.fn(async () => ({ data, error: null })) };
  h.from.mockReturnValue(q); return q;
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', h.fetch); h.fetch.mockResolvedValue({ ok: true }); });

describe('team RPC boundaries', () => {
  it('reads explicit project capabilities and denies missing or nonboolean flags', async () => {
    h.rpc.mockResolvedValue({ data: { primary_client: true, can_invite: true, primary_contractor: 'true' }, error: null });
    const access = await fetchProjectTeamAccess('project');
    expect(h.rpc).toHaveBeenCalledWith('project_team_access', { p_project: 'project' });
    expect(access).toMatchObject({ primaryClient: true, canInvite: true, primaryContractor: false, canInviteClient: false, canInviteContractor: false });
  });
  it('does not invent permissions if the RPC fails or is unavailable', async () => {
    h.rpc.mockResolvedValueOnce({ error: new Error('not_permitted') }).mockResolvedValueOnce({ data: null });
    await expect(fetchProjectTeamAccess('project')).rejects.toThrow('not_permitted');
    await expect(fetchProjectTeamAccess('project')).rejects.toThrow('unavailable');
  });
  it('creates the initial contractor through the RPC and emails its returned token in the sender language', async () => {
    h.rpc.mockResolvedValue({ data: { id: 'invite', token: 'server-token' }, error: null });
    expect(await inviteContractor('project', 'browser-chosen-actor', ' Builder@Example.com ', 'Home', 'Client', 'en'))
      .toMatchObject({ invite: { token: 'server-token' }, emailSent: true });
    expect(h.rpc).toHaveBeenCalledWith('invite_project_contractor', { p_project: 'project', p_email: 'builder@example.com' });
    expect(h.from).not.toHaveBeenCalled();
    expect(JSON.parse(h.fetch.mock.calls[0][1].body)).toMatchObject({ inviteToken: 'server-token', lang: 'en' });
  });
  it('sends no email when the database denies the contractor invitation', async () => {
    h.rpc.mockResolvedValue({ error: new Error('not_permitted') });
    await expect(inviteContractor('project', 'actor', 'a@example.com', 'Home', 'Client')).rejects.toThrow('not_permitted');
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('accepts a composite contractor result returned as a one-row array', async () => {
    h.rpc.mockResolvedValue({ data: [{ id: 'invite', token: 'token' }], error: null });
    expect((await inviteContractor('project', 'actor', 'a@example.com', 'Home', 'Client')).invite.token).toBe('token');
  });
  it('uses guarded cancellation and staff role-change RPCs', async () => {
    h.rpc.mockResolvedValue({ error: null });
    await revokeInvite('pending'); await setProjectClient('viewer');
    expect(h.rpc).toHaveBeenCalledWith('cancel_project_contractor_invite', { p_invite: 'pending' });
    expect(h.rpc).toHaveBeenCalledWith('set_project_client', { p_viewer: 'viewer' });
    expect(h.from).not.toHaveBeenCalled();
  });
});

describe('clients and observers are distinct memberships', () => {
  it('maps explicit viewer roles and uses only the named client for project labels', async () => {
    const q = query([{ id: 'v', email: 'a@example.com', relationship: 'Ada', invited_at: 'now', accepted_at: null, is_client: false }]);
    expect(await fetchProjectViewers('project')).toEqual([{ id: 'v', email: 'a@example.com', relationship: 'Ada', invitedAt: 'now', acceptedAt: null, isClient: false }]);
    q.order.mockResolvedValue({ data: [{ project_id: 'project', email: 'client@example.com', relationship: 'Client', accepted_at: 'now' }], error: null });
    expect((await fetchViewerSummaries(['project'])).get('project')?.label).toBe('Client');
    expect(q.eq).toHaveBeenCalledWith('is_client', true);
  });
  it('does not count observer invitations as primary-client activation', async () => {
    h.rpc.mockResolvedValue({ data: 'token', error: null });
    await inviteProjectViewer('project', 'observer@example.com');
    expect(h.rpc).toHaveBeenCalledWith('invite_project_viewer', expect.objectContaining({ p_is_client: false }));
    expect(h.funnel).not.toHaveBeenCalled();
    await inviteProjectViewer('project', 'client@example.com', 'Client', true);
    expect(h.funnel).toHaveBeenCalledWith('client_invitation', 'started', 'project');
  });
  it.each([false, true])('tracks acceptance only for the primary client (isClient=%s)', async isClient => {
    h.rpc.mockResolvedValue({ data: 'project', error: null }); query({ is_client: isClient });
    expect(await acceptProjectViewer('token')).toBe('project');
    expect(h.funnel).toHaveBeenCalledTimes(isClient ? 1 : 0);
    expect(h.lifecycle).toHaveBeenCalledTimes(isClient ? 2 : 0);
  });
  it('retains successful membership when the analytics role lookup fails', async () => {
    h.rpc.mockResolvedValue({ data: 'project', error: null }); h.from.mockImplementation(() => { throw new Error('offline'); });
    expect(await acceptProjectViewer('token')).toBe('project');
    expect(h.lifecycle).not.toHaveBeenCalled();
  });
  it('previews the explicit role so the join page explains the right permissions', async () => {
    h.rpc.mockResolvedValue({ data: [{ project_name: 'Home', invited_by_name: 'Builder', accepted: false, is_client: true }], error: null });
    expect(await getViewerInvitePreview('token')).toMatchObject({ isClient: true, accepted: false });
  });
  it.each(['en', 'fr'] as const)('primary-client emails describe approval and observer invitations (%s)', lang => {
    const client = buildShareHtml(lang, 'Builder', 'Home', 'Client', 'token', true);
    const observer = buildShareHtml(lang, 'Client', 'Home', null, 'token');
    expect(client).toContain(lang === 'en' ? 'approve work and invite observers' : 'validez les travaux et invitez des observateurs');
    expect(observer).toContain(lang === 'en' ? 'Follow project stages' : 'Suivez les étapes du chantier');
    expect(client).not.toContain(lang === 'en' ? 'Follow project stages' : 'Suivez les étapes du chantier');
  });
});
