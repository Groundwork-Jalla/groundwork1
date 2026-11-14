import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectTeamAccess } from '@/lib/supabase/project-team';

const h = vi.hoisted(() => ({
  state: [] as any[], refs: [] as any[], memos: [] as any[], deps: [] as any[], cleanups: [] as any[],
  effects: [] as { index: number; effect: () => any }[], si: 0, ri: 0, mi: 0, ei: 0,
  team: {} as any, viewers: vi.fn(), invites: vi.fn(), inviteViewer: vi.fn(), send: vi.fn(),
  revokeViewer: vi.fn(), inviteContractor: vi.fn(), revokeInvite: vi.fn(), refresh: vi.fn(),
  setClient: vi.fn(), createLink: vi.fn(),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = h.si++; if (!(i in h.state)) h.state[i] = typeof initial === 'function' ? initial() : initial;
    return [h.state[i], (value: any) => { h.state[i] = typeof value === 'function' ? value(h.state[i]) : value; }]; },
  useRef: (initial: any) => h.refs[h.ri++] ?? (h.refs[h.ri - 1] = { current: initial }),
  useCallback: (callback: any, deps: any[]) => { const i = h.mi++; if (!h.memos[i] || deps.some((v, k) => !Object.is(v, h.memos[i].deps[k]))) h.memos[i] = { callback, deps }; return h.memos[i].callback; },
  useEffect: (effect: () => any, deps: any[]) => { const i = h.ei++; if (!h.deps[i] || deps.some((v, k) => !Object.is(v, h.deps[i][k]))) { h.deps[i] = deps; h.effects.push({ index: i, effect }); } },
  useId: () => 'invite-panel',
}));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor', email: 'actor@example.com' } }) }));
vi.mock('@/hooks/useProjectTeamAccess', () => ({ useProjectTeamAccess: () => ({ ...h.team, refresh: h.refresh }) }));
vi.mock('@/lib/supabase/project-viewers', () => ({ fetchProjectViewers: h.viewers, inviteProjectViewer: h.inviteViewer,
  revokeProjectViewer: h.revokeViewer, sendShareInviteEmail: h.send, shareLinkFor: (token: string) => `/share/${token}`,
  ShareFailed: class extends Error { constructor(public code: string) { super(code); } } }));
vi.mock('@/lib/supabase/invites', () => ({ fetchInvites: h.invites, inviteContractor: h.inviteContractor, revokeInvite: h.revokeInvite }));
vi.mock('@/lib/supabase/project-team', () => ({ setProjectClient: h.setClient }));
vi.mock('@/lib/supabase/project-invitation-links', async original => ({ ...await original<typeof import('@/lib/supabase/project-invitation-links')>(), createProjectInvitationLink: h.createLink }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/ui/button', () => ({ Button: 'button' }));
vi.mock('@/components/ui/input', () => ({ Input: 'input' }));
vi.mock('@/components/ui/label', () => ({ Label: 'label' }));
vi.mock('@/components/ui/ConfirmModal', () => ({ ConfirmModal: 'confirm-modal' }));
import { ProjectInvitationLink } from '@/components/project/ProjectInvitationLink';
import { ShareProject } from '@/components/project/ShareProject';
import { ContractorInvite } from '@/components/project/ContractorInvite';
import { PrimaryClientCard } from '@/components/admin/workspace/PrimaryClientCard';
import { TeamTab } from '@/components/admin/workspace/TeamTab';
import { ProjectTeam } from '@/components/project/ProjectTeam';
import { ProjectSharing } from '@/components/project/ProjectSharing';

type Node = { type: any; props: Record<string, any> };
function nodes(value: any): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value?.props) return [];
  return [value, ...nodes(value.props.children)];
}
function text(value: any): string {
  if (Array.isArray(value)) return value.map(text).join(' ');
  if (typeof value === 'string') return value;
  return value?.props ? text(value.props.children) : '';
}
function render(component: () => any) {
  h.si = h.ri = h.mi = h.ei = 0;
  const tree = component();
  for (const { index, effect } of h.effects.splice(0)) { h.cleanups[index]?.(); h.cleanups[index] = effect(); }
  return { tree, all: nodes(tree), text: text(tree) };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const caps: ProjectTeamAccess = { canInvite: true, primaryClient: true, primaryContractor: false,
  assignedContractor: false,
  canEditBoq: false,
  canInviteClient: false, canInviteContractor: true, hasClientInvitation: false, hasContractor: false,
  hasPendingContractor: false, canChangeRoles: false, needsPrimaryReview: false };
const observer = { id: 'observer', email: 'observer@example.com', relationship: 'Family', invitedAt: 'now', acceptedAt: 'now', isClient: false };
const client = { id: 'client', email: 'client@example.com', relationship: 'Client', invitedAt: 'now', acceptedAt: 'now', isClient: true };
beforeEach(() => {
  for (const cleanup of h.cleanups) cleanup?.();
  vi.clearAllMocks(); h.state = []; h.refs = []; h.memos = []; h.deps = []; h.cleanups = []; h.effects = [];
  h.team = { scope: 'actor:project', access: { ...caps }, error: false };
  h.viewers.mockResolvedValue([]); h.invites.mockResolvedValue([]); h.refresh.mockResolvedValue(undefined);
  h.inviteViewer.mockResolvedValue('token'); h.send.mockResolvedValue(true);
  h.inviteContractor.mockResolvedValue({ invite: { token: 'token' }, emailSent: true });
  h.setClient.mockResolvedValue(undefined); h.createLink.mockResolvedValue(undefined);
  vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
});

describe('shareable links are the primary invitation option', () => {
  it.each(['observer', 'client', 'contractor'] as const)('creates a %s link without sending email', async role => {
    if (role === 'client') h.team.access = { ...caps, primaryClient: false, primaryContractor: true, canInviteClient: true };
    const component = role === 'contractor'
      ? () => ContractorInvite({ projectId: 'project', userId: 'actor', projectName: 'Home' })
      : () => ShareProject({ projectId: 'project', asClient: role === 'client' });
    render(component); await flush();
    const view = render(component);
    const link = view.all.find(n => n.type === ProjectInvitationLink)!;
    expect(link.props.canCreate).toBe(true);
    expect(view.all.findIndex(n => n === link)).toBeLessThan(view.all.findIndex(n => n.type === 'details'));
    expect(view.all.find(n => n.type === 'details')!.props.open).toBeUndefined();
    link.props.onCreate(); await flush();
    expect(h.createLink).toHaveBeenCalledWith('project', role);
    expect(h.send).not.toHaveBeenCalled(); expect(h.inviteContractor).not.toHaveBeenCalled();
    expect(h.refresh).toHaveBeenCalled();
  });

  it('reopens an existing client link when a primary invitation already reserves the role', async () => {
    h.team.access = { ...caps, primaryClient: false, primaryContractor: true, canInviteClient: false, hasClientInvitation: true };
    h.viewers.mockResolvedValue([{ ...client, email: '', acceptedAt: null, isShareLink: true, token: 'existing', expiresAt: '2099-01-01T00:00:00Z' }]);
    const component = () => ShareProject({ projectId: 'project', asClient: true });
    render(component); await flush();
    const link = render(component).all.find(n => n.type === ProjectInvitationLink)!;
    expect(link.props.canCreate).toBe(false);
    expect(link.props.link.token).toBe('existing');
    expect(h.createLink).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });

  it('keeps an observer identity visible alongside pending status', async () => {
    h.viewers.mockResolvedValue([{ ...observer, acceptedAt: null }]);
    const component = () => ShareProject({ projectId: 'project' });
    render(component); await flush();
    const view = render(component);
    expect(view.text).toContain('teamAccess.observer');
    expect(view.text).toContain('projectShare.pending');
  });

  it('keeps pending links copyable regardless of legacy expiration dates', async () => {
    h.viewers.mockResolvedValue([{ ...observer, email: '', acceptedAt: null, isShareLink: true, token: 'expired', expiresAt: '2001-01-01T00:00:00Z' }]);
    const component = () => ShareProject({ projectId: 'project' });
    render(component); await flush();
    const view = render(component);
    expect(view.all.find(n => n.type === ProjectInvitationLink)!.props.link.token).toBe('expired');
    expect(view.text).not.toContain('projectLinks.expired');
  });

  it('discards a link-creation result after changing project', async () => {
    let finish!: () => void;
    h.createLink.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    let projectId = 'project'; const component = () => ShareProject({ projectId });
    render(component); await flush();
    render(component).all.find(n => n.type === ProjectInvitationLink)!.props.onCreate();
    projectId = 'other'; h.team.scope = 'actor:other'; render(component); await flush();
    finish(); await flush();
    expect(h.refresh).not.toHaveBeenCalled();
    expect(render(component).text).not.toContain('projectLinks.createFailed');
  });
});

describe('copying a project invitation', () => {
  const props = { scope: 'actor:project', role: 'observer' as const, busy: false, canCreate: true, onCreate: vi.fn(),
    link: { token: 'token' } };

  it('copies the intended project route and confirms success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const component = () => ProjectInvitationLink(props);
    const view = render(component);
    await view.all.find(n => n.type === 'button')!.props.onClick(); await flush();
    expect(writeText).toHaveBeenCalledWith('https://example.test/share/token');
    expect(render(component).text).toContain('projectLinks.copied');
    expect(view.text).toContain('teamAccess.observer');
  });

  it('offers manual copying if clipboard permission is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const component = () => ProjectInvitationLink({ ...props, role: 'contractor' });
    const view = render(component);
    view.all.find(n => n.type === 'button')!.props.onClick(); await flush();
    const updated = render(component);
    expect(updated.text).toContain('projectLinks.copyFailed');
    expect(updated.all.find(n => n.type === 'input')!.props.value).toBe('https://example.test/invite/token');
    expect(updated.text).not.toContain('projectLinks.copied');
  });

  it('discards a clipboard result when the project changes', async () => {
    let finish!: () => void;
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) } });
    let scope = 'actor:project'; const component = () => ProjectInvitationLink({ ...props, scope });
    render(component).all.find(n => n.type === 'button')!.props.onClick();
    scope = 'actor:other'; render(component); finish(); await flush();
    expect(render(component).text).not.toContain('projectLinks.copied');
  });
});

describe('the client project Team tab reuses the role-checked invitation panels', () => {
  const project = { id: 'project', name: 'Home', user_id: 'different-creator' };
  const component = () => ProjectTeam({ project });

  it('shows the invited primary client their contractor and observer invitations', () => {
    const view = render(component);
    expect(view.text).toContain('teamAccess.primaryClient');
    expect(view.all.find(n => n.type === ProjectSharing)!.props).toMatchObject({ projectId: 'project', projectName: 'Home' });
    expect(view.all.some(n => n.type === ContractorInvite || n.type === ShareProject)).toBe(false);
  });

  it('offers the primary contractor the existing client and observer panels', () => {
    h.team.access = { ...caps, primaryClient: false, primaryContractor: true, assignedContractor: true };
    const view = render(component);
    expect(view.text).toContain('teamAccess.primaryContractor');
    expect(view.all.some(n => n.type === ContractorInvite)).toBe(false);
    expect(view.all.filter(n => n.type === ProjectSharing)).toHaveLength(1);
  });

  it('keeps the accepted contractor status panel without a permanent invitation cue', () => {
    h.team.access = { ...caps, canInviteContractor: false, hasContractor: true };
    const view = render(component);
    expect(view.all.some(n => n.type === ProjectSharing)).toBe(true);
    expect(view.all.some(n => n.props['data-tour'] === 'invite-contractor')).toBe(false);
  });

  it('gives observers a role and access explanation without invitation panels', () => {
    h.team.access = { ...caps, canInvite: false, primaryClient: false, canInviteContractor: false };
    const view = render(component);
    expect(view.text).toContain('teamAccess.observer'); expect(view.text).toContain('projectTeam.viewAccess');
    expect(view.all.some(n => n.type === ContractorInvite || n.type === ShareProject)).toBe(false);
  });

  it('does not confuse an assigned secondary contractor with a primary inviter', () => {
    h.team.access = { ...caps, canInvite: false, primaryClient: false, assignedContractor: true, canInviteContractor: false };
    const view = render(component);
    expect(view.text).toContain('adminRole.contractor');
    expect(view.all.some(n => n.type === ContractorInvite || n.type === ShareProject)).toBe(false);
  });

  it('waits for real permissions before displaying either invitation panel', () => {
    h.team.access = null;
    const view = render(component);
    expect(view.text).toContain('common.loading');
    expect(view.all.some(n => n.type === ContractorInvite || n.type === ShareProject)).toBe(false);
    expect(view.text).not.toContain('teamAccess.observer');
  });

  it('keeps invitation panels closed and offers retry if permissions cannot load', () => {
    h.team.access = null; h.team.error = true;
    const view = render(component);
    expect(view.all.some(n => n.props.role === 'alert')).toBe(true);
    expect(view.all.some(n => n.type === ContractorInvite || n.type === ShareProject)).toBe(false);
    view.all.find(n => n.type === 'button')!.props.onClick(); expect(h.refresh).toHaveBeenCalledOnce();
  });
});

describe('the sender selects a project role before generating a link', () => {
  const component = () => ProjectSharing({ projectId: 'project', projectName: 'Home' });
  const choose = (role: string) => render(component).all.find(node => node.type === 'select')!.props.onChange({ target: { value: role } });

  it('requires an explicit choice before showing link generation or sending anything', () => {
    const view = render(component);
    expect(view.all.find(node => node.type === 'select')!.props.value).toBe('');
    expect(view.all.some(node => node.type === ContractorInvite || node.type === ShareProject || node.type === ProjectInvitationLink)).toBe(false);
    expect(h.createLink).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });

  it('offers a client contractor or observer access, then opens only the chosen invitation', () => {
    expect(render(component).all.filter(node => node.type === 'option').map(node => node.props.value)).toEqual(['', 'contractor', 'observer', 'family']);
    choose('contractor');
    expect(render(component).all.find(node => node.type === ContractorInvite)!.props).toMatchObject({ projectId: 'project', projectName: 'Home' });
    expect(render(component).all.some(node => node.type === ShareProject)).toBe(false);
    choose('observer');
    expect(render(component).all.find(node => node.type === ShareProject)!.props.asClient).toBeUndefined();
    expect(render(component).all.some(node => node.type === ContractorInvite)).toBe(false);
    expect(h.createLink).not.toHaveBeenCalled();
  });

  it('offers the primary contractor client, additional-contractor and observer invitations', () => {
    h.team.access = { ...caps, primaryClient: false, primaryContractor: true, canInviteClient: true, canInviteContractor: false, canInviteAdditionalContractor: true };
    expect(render(component).all.filter(node => node.type === 'option').map(node => node.props.value)).toEqual(['', 'client', 'contractor', 'observer', 'family']);
    choose('client'); expect(render(component).all.find(node => node.type === ShareProject)!.props.asClient).toBe(true);
    choose('contractor'); expect(render(component).all.some(node => node.type === ContractorInvite)).toBe(true);
    expect(render(component).text).toContain('projectLinks.additionalContractorHelp');
    expect(h.createLink).not.toHaveBeenCalled();
  });

  it('ignores an unavailable role even when an old event tries to choose it', () => {
    choose('client');
    expect(render(component).all.find(node => node.type === 'select')!.props.value).toBe('');
    expect(render(component).all.some(node => node.type === ShareProject)).toBe(false);
    choose('contractor'); h.team.scope = 'actor:other-project';
    expect(render(component).all.find(node => node.type === 'select')!.props.value).toBe('');
  });

  it('family links grant observer access without client approval responsibilities', () => {
    choose('family');
    const panel = render(component).all.find(node => node.type === ShareProject)!;
    expect(panel.props.asClient).toBeUndefined();
    expect(render(component).text).toContain('projectLinks.familyRoleHelp');
    expect(h.createLink).not.toHaveBeenCalled();
  });

  it('withdraws every invitation control when the current account loses invitation permission', () => {
    choose('contractor'); h.team.access = { ...caps, canInvite: false, primaryClient: false, assignedContractor: true };
    expect(render(component).tree).toBeNull(); expect(h.createLink).not.toHaveBeenCalled();
  });

  it('reuses the role selector when an established client invitation is inspected without offering a second client', () => {
    h.team.access = { ...caps, primaryClient: false, primaryContractor: true, canInviteClient: false, hasClientInvitation: true };
    choose('client');
    expect(render(component).all.find(node => node.type === ShareProject)!.props.asClient).toBe(true);
    expect(h.createLink).not.toHaveBeenCalled();
  });
});

describe('the additional-contractor invitation card', () => {
  it('uses an additional assignment and its own pending token, preserving the primary contractor', async () => {
    h.team.access = { ...caps, primaryClient: false, primaryContractor: true, canInviteContractor: false, canInviteAdditionalContractor: true, hasContractor: true };
    h.invites.mockResolvedValue([{ id: 'primary', token: 'primary-old', is_primary: true, status: 'accepted' },
      { id: 'new', token: 'additional-pending', is_share_link: true, primary_on_acceptance: false, status: 'pending' }]);
    const component = () => ContractorInvite({ projectId: 'project', projectName: 'Home', userId: 'actor' });
    render(component); await flush();
    const link = render(component).all.find(node => node.type === ProjectInvitationLink)!;
    expect(link.props.primaryContractor).toBe(false); expect(link.props.link.token).toBe('additional-pending');
    expect(link.props.canCreate).toBe(true);
    await link.props.onCreate(); await flush();
    expect(h.createLink).toHaveBeenCalledWith('project', 'contractor');
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe('staff changes primary clients explicitly', () => {
  it('does not label a creator with a secondary contractor assignment as the primary client', () => {
    const loaded: any = { workspace: { project: { id: 'project', user_id: 'owner' },
      available: { invites: true, verifiers: false }, team: { owner: { name: 'Creator' }, verifiers: [],
        contractors: [{ id: 'assignment', status: 'accepted', contractor_user_id: 'owner', is_primary: false }] } } };
    const view = render(() => TeamTab({ loaded, onChanged() {}, onNotice() {} }));
    expect(view.all.find(n => n.type === PrimaryClientCard)!.props.ownerClientName).toBeNull();
  });
  it('confirms promoting an accepted observer before changing any role', async () => {
    h.viewers.mockResolvedValue([client, observer]);
    const changed = vi.fn(), notice = vi.fn();
    const component = () => PrimaryClientCard({ projectId: 'project', onChanged: changed, onNotice: notice });
    render(component); await flush();
    render(component).all.find(n => n.type === 'button')!.props.onClick();
    expect(h.setClient).not.toHaveBeenCalled();
    await render(component).all.find(n => n.type === 'confirm-modal')!.props.onConfirm();
    expect(h.setClient).toHaveBeenCalledWith(observer.id); expect(changed).toHaveBeenCalledOnce();
    expect(notice).toHaveBeenCalledWith('teamAccess.clientChanged');
  });
  it('offers no role change for a pending observer', async () => {
    h.viewers.mockResolvedValue([{ ...observer, acceptedAt: null }]);
    const component = () => PrimaryClientCard({ projectId: 'project', onChanged() {}, onNotice() {} });
    render(component); await flush(); expect(render(component).all.some(n => n.type === 'button')).toBe(false);
  });
});

describe('sharing follows primary project roles', () => {
  it.each(['client', 'contractor'])('an invited primary %s can invite an observer without owning the project', async role => {
    h.team.access = { ...caps, primaryClient: role === 'client', primaryContractor: role === 'contractor' };
    const component = () => ShareProject({ projectId: 'project' });
    render(component); await flush();
    const input = render(component).all.find(n => n.type === 'input' && n.props.type === 'email')!;
    input.props.onChange({ target: { value: 'family@example.com' } });
    const form = render(component).all.find(n => n.type === 'form')!;
    await form.props.onSubmit({ preventDefault: vi.fn() });
    expect(h.inviteViewer).toHaveBeenCalledWith('project', 'family@example.com', undefined, false);
    expect(h.send).toHaveBeenCalledWith('token', 'en');
  });
  it('an observer is offered no invitation or removal controls', async () => {
    h.team.access = { ...caps, canInvite: false, primaryClient: false };
    const view = render(() => ShareProject({ projectId: 'project' }));
    expect(view.tree).toBeNull(); expect(h.viewers).not.toHaveBeenCalled();
  });
  it('keeps invitation controls closed while permission loading fails and offers retry', () => {
    h.team.access = null; h.team.error = true;
    const view = render(() => ShareProject({ projectId: 'project' }));
    expect(view.all.some(n => n.type === 'form')).toBe(false);
    expect(view.text).toContain('teamAccess.loadFailed');
    view.all.find(n => n.type === 'button')!.props.onClick();
    expect(h.refresh).toHaveBeenCalled();
  });
  it('does not treat a failed participant read as an empty project', async () => {
    h.viewers.mockRejectedValue(new Error('offline'));
    const component = () => ShareProject({ projectId: 'project' });
    render(component); await flush(); const view = render(component);
    expect(view.all.some(n => n.type === 'form')).toBe(false);
    expect(view.text).toContain('teamAccess.loadFailed');
    expect(view.text).not.toContain('projectShare.familyNone');
  });
  it('keeps the primary client out of the observer removal list', async () => {
    h.viewers.mockResolvedValue([client, observer]);
    const component = () => ShareProject({ projectId: 'project' });
    render(component); await flush(); const view = render(component);
    expect(view.text).toContain(observer.email); expect(view.text).not.toContain(client.email);
  });
  it('shows accepted primary client status without a repeated invite or remove action', async () => {
    h.team.access = { ...caps, primaryClient: false, primaryContractor: true, hasClientInvitation: true };
    h.viewers.mockResolvedValue([client, observer]);
    const component = () => ShareProject({ projectId: 'project', asClient: true });
    render(component); await flush(); const view = render(component);
    expect(view.text).toContain('teamAccess.clientTitle'); expect(view.text).toContain(client.email);
    expect(view.text).not.toContain(observer.email);
    expect(view.all.some(n => n.type === 'form' || n.type === 'button')).toBe(false);
  });
  it('prevents a double submission before the first invitation finishes', async () => {
    let finish!: (token: string) => void;
    h.inviteViewer.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const component = () => ShareProject({ projectId: 'project' });
    render(component); await flush();
    render(component).all.find(n => n.type === 'input' && n.props.type === 'email')!.props.onChange({ target: { value: 'a@example.com' } });
    const submit = render(component).all.find(n => n.type === 'form')!.props.onSubmit;
    const pending = submit({ preventDefault: vi.fn() });
    await submit({ preventDefault: vi.fn() });
    expect(h.inviteViewer).toHaveBeenCalledTimes(1); finish('token'); await pending;
  });
  it('finishes the requested invitation delivery without showing its result on another project', async () => {
    let finish!: (token: string) => void;
    h.inviteViewer.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    let projectId = 'project'; const component = () => ShareProject({ projectId });
    render(component); await flush();
    render(component).all.find(n => n.type === 'input' && n.props.type === 'email')!.props.onChange({ target: { value: 'a@example.com' } });
    const pending = render(component).all.find(n => n.type === 'form')!.props.onSubmit({ preventDefault: vi.fn() });
    projectId = 'other-project'; h.team.scope = 'actor:other-project'; render(component);
    finish('old-token'); await pending;
    expect(h.send).toHaveBeenCalledWith('old-token', 'en'); expect(render(component).text).not.toContain('projectShare.sent');
  });
  it('finishes delivery after the Team panel unmounts without refreshing the old UI', async () => {
    let finish!: (token: string) => void;
    h.inviteViewer.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const component = () => ShareProject({ projectId: 'project' });
    render(component); await flush();
    render(component).all.find(n => n.type === 'input' && n.props.type === 'email')!.props.onChange({ target: { value: 'a@example.com' } });
    const pending = render(component).all.find(n => n.type === 'form')!.props.onSubmit({ preventDefault: vi.fn() });
    for (const cleanup of h.cleanups) cleanup?.();
    finish('saved-token'); await pending;
    expect(h.send).toHaveBeenCalledWith('saved-token', 'en');
    expect(h.refresh).not.toHaveBeenCalled();
  });
});

describe('the first contractor invitation is an assignment, further invitations are observers', () => {
  const component = () => ContractorInvite({ projectId: 'project', userId: 'actor', projectName: 'Home' });
  it('shows the initial contractor form to the project client', async () => {
    render(component); await flush(); expect(render(component).all.some(n => n.type === 'form')).toBe(true);
  });
  it('replaces an accepted contractor invite prompt with assignment status', async () => {
    h.team.access = { ...caps, canInviteContractor: false, hasContractor: true };
    h.invites.mockResolvedValue([{ id: 'invite', email: 'builder@example.com', status: 'accepted', is_primary: true }]);
    render(component); await flush(); const view = render(component);
    expect(view.text).toContain('teamAccess.contractorTitle'); expect(view.text).toContain('builder@example.com');
    expect(view.text).toContain('teamAccess.primaryContractor');
    expect(view.all.some(n => n.type === 'form')).toBe(false);
  });
  it('does not offer a contractor assignment to an observer', () => {
    h.team.access = { ...caps, canInvite: false, primaryClient: false, canInviteContractor: false };
    expect(render(component).tree).toBeNull();
  });
  it('preserves a usable invitation link when only email delivery fails', async () => {
    h.inviteContractor.mockResolvedValue({ invite: { token: 'pending-token' }, emailSent: false });
    render(component); await flush();
    render(component).all.find(n => n.type === 'input')!.props.onChange({ target: { value: 'builder@example.com' } });
    await render(component).all.find(n => n.type === 'form')!.props.onSubmit({ preventDefault: vi.fn() });
    expect(render(component).text).toContain('https://example.test/invite/pending-token');
  });
  it('requires confirmation before withdrawing a pending contractor invitation', async () => {
    h.team.access = { ...caps, canInviteContractor: false, hasPendingContractor: true };
    h.invites.mockResolvedValue([{ id: 'pending', email: 'builder@example.com', status: 'pending' }]);
    render(component); await flush();
    render(component).all.find(n => n.type === 'button' && n.props['aria-label'])!.props.onClick();
    expect(h.revokeInvite).not.toHaveBeenCalled();
    await render(component).all.find(n => n.type === 'confirm-modal')!.props.onConfirm();
    expect(h.revokeInvite).toHaveBeenCalledWith('pending'); expect(h.refresh).toHaveBeenCalled();
  });
});
