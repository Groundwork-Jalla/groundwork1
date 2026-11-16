import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationRow } from '@/lib/supabase/notifications';

const h = vi.hoisted(() => ({
  index: 0, hooks: [] as any[], effects: [] as (() => void)[], cleanups: [] as (() => void)[],
  navigate: vi.fn(), access: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn(), refresh: vi.fn(),
  roles: { isAdmin: false, isContractor: false, isVerifier: false }, rows: [] as NotificationRow[],
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const index = h.index++; if (!(index in h.hooks)) h.hooks[index] = initial;
    return [h.hooks[index], (value: any) => { h.hooks[index] = typeof value === 'function' ? value(h.hooks[index]) : value; }]; },
  useRef: (initial: any) => { const index = h.index++; return h.hooks[index] ?? (h.hooks[index] = { current: initial }); },
  useEffect: (effect: () => void | (() => void), deps: any[]) => {
    const index = h.index++, old = h.hooks[index];
    if (!old || deps.some((value, at) => !Object.is(value, old.deps[at]))) h.effects.push(() => {
      old?.cleanup?.(); const cleanup = effect(); h.hooks[index] = { deps, cleanup }; if (cleanup) h.cleanups.push(cleanup);
    });
  },
}));
vi.mock('react-router', () => ({ Link: 'a', useNavigate: () => h.navigate }));
vi.mock('framer-motion', () => ({ AnimatePresence: 'presence', motion: { div: 'div' } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.roles }));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => ({ rows: h.rows, loaded: true, unread: 1,
  markRead: h.markRead, markAllRead: h.markAllRead, refresh: h.refresh, failed: false, loadingMore: false }) }));
vi.mock('@/lib/supabase/project-team', () => ({ fetchProjectTeamAccess: h.access }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/notification-text', () => ({ useNotificationText: () => (row: NotificationRow) => ({ title: row.title, body: row.body }) }));
vi.mock('@/lib/format', () => ({ formatRelative: () => 'now' }));

import { NotificationBell } from './NotificationBell';

type Element = { type: unknown; props: any };
function nodes(value: any): Element[] { return Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []; }
function text(value: any): string { return Array.isArray(value) ? value.map(text).join(' ') : value?.props ? text(value.props.children) : typeof value === 'string' ? value : ''; }
function render(userId = 'client') {
  h.index = 0; h.effects = [];
  const view = nodes(NotificationBell({ userId }));
  for (const effect of h.effects) effect();
  return view;
}
function opened() {
  render().find(item => item.type === 'button' && item.props['aria-expanded'] === false)!.props.onClick();
  return render();
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const projectId = 'project-1';
const notice = (data: NotificationRow['data'], extra: Partial<NotificationRow> = {}): NotificationRow => ({
  id: 'notice-1', user_id: 'client', type: 'project.receipt_received', title: 'A project update', body: 'Open the action', data,
  read_at: null, created_at: '2026-11-15', title_key: null, body_key: null, params: null, ...extra,
});
const rowButton = () => render().find(item => item.type === 'button' && text(item).includes('A project update'))!;

beforeEach(() => {
  vi.clearAllMocks(); h.index = 0; h.hooks = []; h.effects = []; h.cleanups = [];
  h.roles = { isAdmin: false, isContractor: false, isVerifier: false };
  h.rows = [notice({ project_id: projectId, receipt_id: 'receipt-8', stage_id: 'stage-4', stage_number: 4 })];
  h.access.mockResolvedValue({ projectRole: 'primary_client' }); h.markRead.mockResolvedValue(undefined);
  h.markAllRead.mockResolvedValue(undefined); h.refresh.mockResolvedValue(undefined);
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { for (const cleanup of h.cleanups) cleanup(); vi.unstubAllGlobals(); });

describe('notification bell action navigation', () => {
  it('keeps the full client notification history reachable through the bell', () => {
    const link = opened().find(item => item.type === 'a' && text(item) === 'notifications.viewAll')!;
    expect(link.props.to).toBe('/notifications');
    link.props.onClick();
    expect(render().some(item => item.type === 'a' && item.props.to === '/notifications')).toBe(false);
  });

  it.each([
    ['primary_client', '/projects/project-1'], ['observer', '/projects/project-1'],
    ['primary_contractor', '/work/projects/project-1'],
  ])('opens the precise receipt in the current %s project workspace', async (projectRole, base) => {
    h.roles.isContractor = true; // Deliberately stale account hint; accepted project role wins.
    h.access.mockResolvedValue({ projectRole }); opened(); rowButton().props.onClick(); await flush();
    const target = new URL(h.navigate.mock.calls[0][0], 'https://test.invalid');
    expect(target.pathname).toBe(base);
    expect(target.searchParams.get('stage')).toBe('4');
    expect(target.searchParams.get('receipt_id')).toBe('receipt-8');
    expect(target.searchParams.get('stage_id')).toBe('stage-4');
    expect(h.markRead).toHaveBeenCalledWith('notice-1');
  });

  it('opens a legacy project notification from its table-level reference', async () => {
    h.rows = [notice({}, { project_id: projectId })]; opened(); rowButton().props.onClick(); await flush();
    expect(h.navigate).toHaveBeenCalledWith('/projects/project-1');
  });

  it('keeps a previously read notification actionable', async () => {
    h.rows[0].read_at = '2026-11-15'; opened(); rowButton().props.onClick(); await flush();
    expect(h.navigate).toHaveBeenCalledOnce(); expect(h.markRead).not.toHaveBeenCalled();
  });

  it('opens the project action even when saving read status fails', async () => {
    h.markRead.mockRejectedValue(new Error('offline')); opened(); rowButton().props.onClick(); await flush();
    expect(h.navigate).toHaveBeenCalledOnce(); expect(text(opened())).toContain('notifications.readFailed');
  });

  it('does not redirect or mark the notification read after project access is revoked', async () => {
    h.access.mockResolvedValue({ projectRole: null }); opened(); rowButton().props.onClick(); await flush();
    expect(h.navigate).not.toHaveBeenCalled(); expect(h.markRead).not.toHaveBeenCalled();
    expect(text(render())).toContain('notifications.openFailed');
  });

  it('explains notices with no linked action rather than silently swallowing the click', async () => {
    h.rows = [notice({})]; opened(); rowButton().props.onClick(); await flush();
    expect(h.navigate).not.toHaveBeenCalled(); expect(h.markRead).not.toHaveBeenCalled();
    expect(text(render())).toContain('notifications.noDestination');
  });

  it('does not reopen a late project target after the user chose notification history', async () => {
    let finish!: (value: any) => void;
    h.access.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    opened(); rowButton().props.onClick();
    render().find(item => item.type === 'a' && text(item) === 'notifications.viewAll')!.props.onClick();
    finish({ projectRole: 'primary_client' }); await flush();
    expect(h.navigate).not.toHaveBeenCalled(); expect(h.markRead).not.toHaveBeenCalled();
  });

  it('sends staff to Admin history and retains in-bell history for roles without a history page', () => {
    h.roles.isAdmin = true;
    expect(opened().find(item => item.type === 'a')?.props.to).toBe('/admin/notifications');
    h.roles.isAdmin = false; h.roles.isContractor = true;
    expect(render().some(item => item.type === 'a')).toBe(false);
  });
});
