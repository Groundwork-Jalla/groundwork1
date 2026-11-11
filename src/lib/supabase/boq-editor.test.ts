import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CITY_RATES } from '@/lib/budget';

const h = vi.hoisted(() => ({ reply: {} as any, query: {} as any, events: vi.fn(), rpc: vi.fn(), team: {} as any, pathname: '/projects/project/takeoff' }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: () => h.query, rpc: h.rpc } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: h.events }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor' } }) }));
vi.mock('@/hooks/useProjectTeamAccess', () => ({ useProjectTeamAccess: () => h.team }));
vi.mock('react-router', () => ({ Link: 'a', Navigate: 'redirect', useLocation: () => ({ pathname: h.pathname }), useParams: () => ({ id: 'project', takeoffId: 'bill' }), useNavigate: () => vi.fn() }));
import TakeoffList from '@/app/routes/projects/takeoff';
import TakeoffDetail from '@/app/routes/projects/takeoff.detail';
import { deleteDraft, saveDraft, submitTakeoff } from './takeoffs';
import { fetchProjectTeamAccess } from './project-team';

beforeEach(() => {
  vi.clearAllMocks(); h.reply = { data: { id: 'draft' }, error: null };
  h.query = { update: vi.fn(), delete: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn(() => Promise.resolve(h.reply)) };
  for (const name of ['update', 'delete', 'eq', 'select']) h.query[name].mockReturnValue(h.query);
  h.pathname = '/projects/project/takeoff';
  h.team = { access: { canEditBoq: false }, error: false, refresh: vi.fn() };
});
const submit = () => submitTakeoff('draft', { lines: [], totalLocal: 80, cityRate: CITY_RATES.DOUALA }, 600);

describe('BQ writes cannot silently succeed after permissions change', () => {
  it.each(['save', 'submit', 'delete'])('reports a refused %s instead of claiming success', async action => {
    h.reply.data = null;
    await expect(action === 'save' ? saveDraft('draft', { note: 'Revised' }) : action === 'submit' ? submit() : deleteDraft('draft')).rejects.toThrow('not_permitted');
    expect(h.events).not.toHaveBeenCalled();
  });
  it('limits a draft mutation by status and reports a successful submission once', async () => {
    await submit();
    expect(h.query.eq).toHaveBeenCalledWith('id', 'draft');
    expect(h.query.eq).toHaveBeenCalledWith('status', 'draft');
    expect(h.events).toHaveBeenCalledWith('takeoff_submitted', { takeoff_id: 'draft' });
  });
  it('propagates a database failure for retry rather than returning a success', async () => {
    h.reply = { data: null, error: new Error('connection lost') };
    await expect(saveDraft('draft', {})).rejects.toThrow('connection lost');
  });
});

describe('BQ editor routes and role capabilities', () => {
  it.each([TakeoffList, TakeoffDetail])('keeps direct client/observer editor URLs read-only', Component => {
    const html = renderToStaticMarkup(createElement(Component));
    expect(html).toContain('project.review.editorRestricted');
    expect(html).not.toContain('takeoff.saveDraft');
    expect(html).not.toContain('takeoff.submit');
    expect(html).not.toContain('takeoff.editBoq');
  });
  it('shows a retryable permission error without opening the editor', () => {
    h.team = { access: null, error: true, refresh: vi.fn() };
    const html = renderToStaticMarkup(createElement(TakeoffDetail));
    expect(html).toContain('teamAccess.loadFailed');
    expect(html).toContain('common.retry');
    expect(html).not.toContain('takeoff.saveDraft');
  });
  it('does not infer editor rights from account role, ownership, or an old server response', async () => {
    h.rpc.mockResolvedValue({ data: { assigned_contractor: true, primary_client: false }, error: null });
    expect((await fetchProjectTeamAccess('project')).canEditBoq).toBe(false);
    h.rpc.mockResolvedValue({ data: { can_edit_boq: true }, error: null });
    expect((await fetchProjectTeamAccess('project')).canEditBoq).toBe(true);
  });
});


describe('authoring stays in the contractor or admin workspace', () => {
  it.each([['work', false], ['admin', true]] as const)('redirects old list links into %s', (role, admin) => {
    h.team.access = { canEditBoq: true, canChangeRoles: admin };
    const html = renderToStaticMarkup(createElement(TakeoffList));
    expect(html).toContain(`to="/${role}/projects/project/takeoff"`);
  });
  it('preserves a legacy bill deep link when redirecting', () => {
    h.team.access = { canEditBoq: true, canChangeRoles: false };
    h.pathname = '/projects/project/takeoff/bill';
    expect(renderToStaticMarkup(createElement(TakeoffDetail))).toContain('to="/work/projects/project/takeoff/bill"');
  });
});
