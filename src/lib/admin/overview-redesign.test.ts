import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { lookup } from '@/lib/i18n/translate';
import { KPI_LINKS, SEE_ALL_LINKS } from './overview-links';

/**
 * The redesigned Overview (18 Nov, overview-desktop.png), rendered with its loaders
 * answering. Every link on the page is collected and checked against where it must go:
 * the eight KPIs still open their own filtered datasets, every card keeps its See all,
 * the hero opens the Action Center, and nothing on the page is a dead end.
 */

const h = vi.hoisted(() => ({
  store: new Map<string, any[]>(), path: 'root', idx: 0, effects: [] as { run: () => any }[],
  overview: vi.fn(), actions: vi.fn(), params: new URLSearchParams(),
}));
vi.mock('react', async original => {
  const real = await original<typeof import('react')>();
  const slot = () => { const list = h.store.get(h.path) ?? []; h.store.set(h.path, list); return { list, i: h.idx++ }; };
  return { ...real,
    useState: (initial: any) => { const { list, i } = slot(); if (!(i in list)) list[i] = typeof initial === 'function' ? initial() : initial;
      return [list[i], (value: any) => { list[i] = typeof value === 'function' ? value(list[i]) : value; }]; },
    useRef: (initial: any) => { const { list, i } = slot(); if (!(i in list)) list[i] = { current: initial }; return list[i]; },
    useEffect: (run: () => any) => { h.idx++; h.effects.push({ run }); },
    useMemo: (make: () => any) => { h.idx++; return make(); },
    useCallback: (callback: any) => { h.idx++; return callback; },
  };
});
vi.mock('react-router', () => ({ Link: 'a', useSearchParams: () => [h.params, (next: URLSearchParams) => { h.params = new URLSearchParams(next); }] }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'ruth' } }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, values: Record<string, unknown> = {}) => {
  const source = lookup(en as never, key);
  return typeof source === 'string' ? source.replace(/\{(\w+)\}/g, (_m, name) => String(values[name] ?? '')) : key;
} }));
vi.mock('@/lib/format', () => ({ formatRelative: (value: string) => `rel(${value})` }));
vi.mock('@/lib/supabase/admin-overview', () => ({ loadAdminOverview: h.overview }));
vi.mock('@/lib/supabase/action-center', () => ({ loadActionCenter: h.actions }));
vi.mock('@/components/ui/EmptyState', () => ({ EmptyState: 'mock-empty' }));
import AdminOverview from '@/app/routes/admin/index';
import AdminActionCenter from '@/app/routes/admin/action-center';

type Node = { type: any; props: Record<string, any>; key?: string | null };
function expand(value: any, path: string): Node[] {
  if (Array.isArray(value)) return value.flatMap((child, i) => expand(child, `${path}.${child?.key ?? i}`));
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  if (typeof value.type === 'function') {
    const saved = [h.path, h.idx] as const; h.path = `${path}/${value.type.name}`; h.idx = 0;
    const out = value.type(value.props); const inner = h.path; [h.path, h.idx] = saved;
    return [value, ...expand(out, inner)];
  }
  return [value, ...expand(value.props?.children, path)];
}
const text = (value: any): string => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
let Page: any = AdminOverview;
function render(): Node[] { h.effects = []; h.path = 'root'; h.idx = 0; return expand({ type: Page, props: {}, key: null }, 'root'); }
async function settle() { render(); for (const e of h.effects) e.run(); await flush(); return render(); }
const links = (view: Node[]) => view.filter(n => n.type === 'a').map(n => ({ to: n.props.to as string, label: text(n.props.children) }));

const project = (id: string, band: string) => ({ id, name: `Project ${id}`, health: { band }, ownerName: '', ownerEmail: '', lastActivityAt: null, stagesComplete: 1, stagesTotal: 10 });
const DATA = {
  viewerName: 'Ruth Operations', totalUsers: 312, quoteRequests: 4, needsReply: 3, openConversations: 7, activityAvailable: true,
  funnel: [{ key: 'waitlist', count: 38, to: '/admin/waitlist' }, { key: 'accepted', count: 12, to: '/admin/applications?status=approved' }],
  contractorsByTrade: [{ label: 'General contractor', count: 14 }, { label: 'Mason', count: 6 }],
  projects: [project('a', 'at_risk'), project('b', 'on_track'), project('c', 'at_risk')], pipeline: new Map(),
  backlog: { pendingReviews: 6, pendingBudgets: 1, pendingApplications: 9, openSupport: 2, openInquiries: 4, newAgentRequests: 0 },
  recent: [{ id: 'e1', projectId: 'a', projectName: 'Mbala Residence', action: 'stage.approved', actorName: 'Ruth', personName: '', entityType: 'stage', createdAt: '2026-11-18T08:00:00Z' },
    { id: 'e2', projectId: '', projectName: '', action: 'client.provisioned', actorName: 'Favour', personName: 'Ama', entityType: 'profile', createdAt: '2026-11-17T08:00:00Z' }],
  locations: [{ country: 'CM', city: 'Douala', count: 2 }, { country: 'NG', city: 'Lagos', count: 1 }],
  tickets: [{ id: 't1', subject: 'Cannot upload receipt', who: 'Joseph Tabe', status: 'in_progress', createdAt: '2026-11-17T08:00:00Z' }],
  crm: { status: { apiToken: true, locationId: true, conversationProvider: true, inboundSecret: true, stageMapValid: false }, backlog: 0, failures: 0, lastInboundAt: '2026-11-18T09:00:00Z', lastOutboundAt: null },
};
const item = (key: string, priority: string, to: string) => ({ key, kind: 'verification_overdue', priority, since: '2026-11-12T08:00:00Z', to, projectName: 'Mbala Residence', personName: 'Claire Mbala', stageNumber: 4 });
const ACTIONS = {
  items: [item('i1', 'critical', '/admin/projects/a?tab=stages'), item('i2', 'high', '/admin/reviews'), item('i3', 'high', '/admin/budgets'), item('i4', 'medium', '/admin/applications?status=pending')],
  available: { verifications: true, siteUpdates: true, ledger: true, conversations: true }, loadedAt: '',
};

beforeEach(() => {
  h.store = new Map(); Page = AdminOverview; h.params = new URLSearchParams();
  h.overview.mockReset().mockResolvedValue(DATA);
  h.actions.mockReset().mockResolvedValue(ACTIONS);
});

describe('the redesigned Overview keeps every road', () => {
  it('every KPI still opens the dataset it counted, with the number it counted', async () => {
    const view = await settle();
    const all = links(view);
    const kpi = (to: string) => all.find(l => l.to === to)?.label ?? '';
    expect(kpi(KPI_LINKS.totalProjects)).toContain('3');
    expect(kpi(KPI_LINKS.atRisk)).toContain('2');
    expect(kpi(KPI_LINKS.pendingReviews)).toContain('6');
    expect(kpi(KPI_LINKS.pendingBudgets)).toContain('1');
    expect(kpi(KPI_LINKS.conversations)).toContain('3');
    expect(kpi(KPI_LINKS.applications)).toContain('9');
    expect(kpi(KPI_LINKS.quoteRequests)).toContain('4');
    expect(kpi(KPI_LINKS.totalUsers)).toContain('312');
  });

  it('every card keeps its See all, and the hero opens the Action Center', async () => {
    const all = links(await settle()).map(l => l.to);
    for (const to of Object.values(SEE_ALL_LINKS)) if (to) expect(all, to).toContain(to);
    const hero = links(await settle()).find(l => l.label.includes('Open Action Center'));
    expect(hero?.to).toBe('/admin/action-center');
  });

  it('attention rows open where the work is; activity opens the project workspace', async () => {
    const all = links(await settle()).map(l => l.to);
    for (const i of ACTIONS.items) expect(all).toContain(i.to);
    expect(all).toContain('/admin/projects/a');
    // A person-level activity row has no project, so it is not a link.
    expect(all.filter(to => to === '/admin/projects/')).toHaveLength(0);
  });

  it('no link on the page is empty', async () => {
    for (const l of links(await settle())) expect(l.to, l.label).toMatch(/^\/admin/);
  });

  it('the hero counts the Action Center by priority, and shows nothing until it knows', async () => {
    h.actions.mockReturnValue(new Promise(() => {}));
    const loading = render().map(n => text(n.props?.children)).join(' ');
    expect(loading).not.toMatch(/\d critical/);
    h.store = new Map(); h.actions.mockResolvedValue(ACTIONS);
    const view = (await settle()).filter(n => n.type === 'span').map(n => text(n.props.children)).join(' | ');
    expect(view).toContain('1 critical'); expect(view).toContain('2 high'); expect(view).toContain('1 medium');
  });

  it('an empty Action Center says so instead of chips of zero', async () => {
    h.actions.mockResolvedValue({ ...ACTIONS, items: [] });
    const strings = (await settle()).map(n => typeof n.props?.children === 'string' ? n.props.children : '');
    expect(strings).toContain('Nothing is waiting on you.');
    expect(strings.join(' ')).not.toMatch(/0 critical/);
  });

  it('a source that could not be read still shows a dash, not 0', async () => {
    h.overview.mockResolvedValue({ ...DATA, totalUsers: null, needsReply: null });
    const users = links(await settle()).find(l => l.to === KPI_LINKS.totalUsers)!;
    expect(users.label).toContain('—');
  });

  it('the GoHighLevel summary counts the four settings it lists', async () => {
    const strings = (await settle()).map(n => typeof n.props?.children === 'string' ? n.props.children : '');
    expect(strings).toContain('3 of 4 configured');
    expect(strings).toContain('Outbox 0');
  });

  it('the new strings exist in both languages and differ', () => {
    for (const k of ['admin.hero.openActionCenter', 'admin.hero.nothingWaiting', 'admin.hero.bandBuilding', 'admin.hero.bandPeople', 'admin.ghl.summary', 'admin.ghl.failuresTag']) {
      expect(lookup(en as never, k), k).toBeTypeOf('string');
      expect(lookup(fr as never, k), k).not.toBe(lookup(en as never, k));
    }
  });
});

describe('the redesigned Action Center', () => {
  const tabs = (view: Node[]) => view.filter(n => n.type === 'button');
  const heads = (view: Node[]) => view.filter(n => n.props?.role === 'presentation').map(n => text(n.props.children));

  it('heads the queue by priority, with each group\'s count, in severity order', async () => {
    Page = AdminActionCenter;
    expect(heads(await settle())).toEqual(['Critical · 1', 'High · 2', 'Medium · 1']);
  });

  it('every tab narrows the queue through ?priority=, and All clears it', async () => {
    Page = AdminActionCenter;
    let view = await settle();
    expect(tabs(view).map(b => text(b.props.children))).toEqual(['All 4', 'Critical 1', 'High 2', 'Medium 1', 'Low 0']);
    tabs(view).find(b => text(b.props.children).startsWith('High'))!.props.onClick();
    expect(h.params.get('priority')).toBe('high');
    view = render();
    expect(heads(view)).toEqual(['High · 2']);
    expect(links(view).map(l => l.to)).toEqual(['/admin/reviews', '/admin/budgets']);
    tabs(view)[0].props.onClick();
    expect(h.params.get('priority')).toBeNull();
  });

  it('every row opens where the work is', async () => {
    Page = AdminActionCenter;
    expect(links(await settle()).map(l => l.to)).toEqual(ACTIONS.items.map(i => i.to));
  });

  it('the Overview preview stays ungrouped', async () => {
    expect(heads(await settle())).toEqual([]);
  });
});
