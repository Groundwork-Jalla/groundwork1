import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { lookup } from '@/lib/i18n/translate';

/**
 * The redesigned All Projects page (18 Nov, projects-desktop.png), every control pressed.
 * Hooks are kept per component instance, so a click changes state the way it does in the
 * browser and the next render shows where it led.
 */

const h = vi.hoisted(() => ({
  store: new Map<string, any[]>(), path: 'root', idx: 0, effects: [] as { run: () => any }[],
  params: new URLSearchParams(), rpc: vi.fn(), del: vi.fn(), rows: [] as any[],
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
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, values: Record<string, unknown> = {}) => {
  const source = lookup(en as never, key);
  return typeof source === 'string' ? source.replace(/\{(\w+)\}/g, (_m, name) => String(values[name] ?? '')) : key;
} }));
vi.mock('@/lib/domain-labels', () => ({ useDomainLabels: () => ({ tier: (v: string) => ({ jalla_verify: 'Jalla Verify', self_verify: 'Self Verify' } as Record<string, string>)[v] ?? v }) }));
vi.mock('@/lib/supabase/client', () => {
  const chain = (table: string): any => { const c: any = { select: () => c, order: () => c,
    then: (ok: any) => Promise.resolve(ok({ data: table === 'projects' ? h.rows : [], error: null })) }; return c; };
  return { supabase: { from: chain, rpc: (name: string, args: unknown) => (name === 'admin_project_activity' ? Promise.resolve({ data: [], error: null }) : h.rpc(name, args)) } };
});
vi.mock('@/lib/supabase/admin-users', () => ({ ownerLookup: async () => new Map([
  ['u1', { email: 'claire@x.cm', name: 'Claire Mbala', roles: '' }], ['u2', { email: 'bob@x.cm', name: 'Benoit Nkeng', roles: 'contractor' }]]) }));
vi.mock('@/lib/supabase/admin-projects', () => ({ deleteProjectAsAdmin: h.del }));
vi.mock('@/lib/supabase/admin-project-status', () => ({ fetchBusinessStatuses: async () => new Map() }));
vi.mock('@/components/admin/team/AssignVerifierModal', () => ({ AssignVerifierModal: 'mock-verifier-modal' }));
vi.mock('@/components/ui/ConfirmDelete', () => ({ ConfirmDelete: 'mock-confirm-delete' }));
vi.mock('@/components/admin/RoleBadge', () => ({ RoleBadge: 'mock-role' }));
import AdminProjects from '@/app/routes/admin/projects';

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
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function render(): Node[] { h.effects = []; h.path = 'root'; h.idx = 0; return expand({ type: AdminProjects, props: {}, key: null }, 'root'); }
async function settle() { render(); for (const e of h.effects) e.run(); await flush(); return render(); }
const byLabel = (view: Node[], label: string) => view.filter(n => typeof n.props?.['aria-label'] === 'string' && n.props['aria-label'].startsWith(label));

const row = (id: string, name: string, owner: string, status: string, stage: number, city: string | null) => ({
  id, name, user_id: owner, tier: 'jalla_verify', status, current_stage: stage, country: 'CM', city, created_at: '2026-10-30T08:00:00Z',
  tracking_started_at: null, updated_at: '2026-11-18T08:00:00Z', workflow_origin: 'client' });

beforeEach(() => {
  h.store = new Map(); h.params = new URLSearchParams();
  h.rows = [row('p1', 'Mbala Residence', 'u1', 'active', 5, 'Douala'), row('p2', 'Nkeng villa', 'u2', 'on_hold', 3, null)];
  h.rpc.mockReset().mockResolvedValue({ error: null });
  h.del.mockReset().mockResolvedValue({ name: 'Mbala Residence', stages: 10, documents: 0, messages: 0, filesRemoved: 0, filesOrphaned: 0 });
});

describe('All Projects, redesigned — every control still goes where it did', () => {
  it('the project name opens the workspace; the outward icon opens the homeowner view in a new tab', async () => {
    const view = await settle();
    const links = view.filter(n => n.type === 'a');
    expect(links.filter(l => l.props.to === '/admin/projects/p1').length).toBeGreaterThanOrEqual(2); // table + phone card
    const outward = byLabel(view, `${lookup(en as never, 'admin.viewProject')} Mbala`)[0];
    expect(outward.props.to).toBe('/projects/p1');
    expect(outward.props.target).toBe('_blank');
    expect(links.find(l => l.props.to === '/admin/projects/new')).toBeTruthy();
  });

  it('shows the city, the plan, the health band and the stage', async () => {
    const view = await settle();
    const all = view.map(n => typeof n.props?.children === 'string' ? n.props.children : '');
    expect(all).toContain('Douala');
    expect(all).toContain('Jalla Verify');
    const bands = ['atRisk', 'attention', 'onTrack', 'planning', 'completed'].map(k => lookup(en as never, `admin.healthCard.${k}`));
    expect(all.some(x => bands.includes(x))).toBe(true);
    expect(view.filter(n => n.type === 'span').map(n => text(n.props.children))).toContain('5 / 10');
  });

  it('assign contractor opens its dialog and calls the RPC with the typed email', async () => {
    let view = await settle();
    byLabel(view, `${lookup(en as never, 'admin.assignContractor')} Mbala`)[0].props.onClick();
    view = render();
    const input = view.find(n => n.type === 'input' && n.props.type === 'email')!;
    input.props.onChange({ target: { value: 'bob@x.cm' } });
    view = render();
    await view.find(n => n.type === 'button' && text(n.props.children) === lookup(en as never, 'admin.assign'))!.props.onClick();
    expect(h.rpc).toHaveBeenCalledWith('admin_assign_contractor', { p_project_id: 'p1', p_email: 'bob@x.cm' });
  });

  it('assign verifier opens the verifier modal for that project', async () => {
    let view = await settle();
    byLabel(view, `${lookup(en as never, 'admin.verifier.assign')} Nkeng`)[0].props.onClick();
    view = render();
    expect(view.find(n => n.type === 'mock-verifier-modal')?.props.project.id).toBe('p2');
  });

  it('delete asks first, then deletes that project and drops the row', async () => {
    let view = await settle();
    byLabel(view, `${lookup(en as never, 'admin.del.deleteProject')} Mbala`)[0].props.onClick();
    view = render();
    const confirm = view.find(n => n.type === 'mock-confirm-delete')!;
    expect(confirm.props.open).toBe(true);
    await confirm.props.onConfirm(); await flush();
    expect(h.del).toHaveBeenCalledWith('p1');
    view = render();
    expect(view.filter(n => n.type === 'a' && n.props.to === '/admin/projects/p1')).toHaveLength(0);
  });

  it('search, every filter and Clear filters write the URL', async () => {
    let view = await settle();
    view.find(n => n.type === 'input' && n.props.type === 'text')!.props.onChange({ target: { value: 'mbala' } });
    expect(h.params.get('q')).toBe('mbala');
    view = render();
    const dates = view.filter(n => n.type === 'input' && n.props.type === 'date');
    dates[0].props.onChange({ target: { value: '2026-10-01' } }); view = render();
    view.filter(n => n.type === 'input' && n.props.type === 'date')[1].props.onChange({ target: { value: '2026-11-30' } }); view = render();
    const selects = view.filter(n => n.type === 'select');
    selects[0].props.onChange({ target: { value: 'client' } }); view = render();
    view.filter(n => n.type === 'select')[1].props.onChange({ target: { value: 'u1' } }); view = render();
    expect(Object.fromEntries(h.params)).toEqual({ q: 'mbala', from: '2026-10-01', through: '2026-11-30', origin: 'client', owner: 'u1' });
    view.find(n => n.type === 'button' && text(n.props.children) === lookup(en as never, 'communications.filters.clear'))!.props.onClick();
    expect([...h.params.keys()]).toEqual([]);
  });

  it('a status tile narrows the list to exactly its count', async () => {
    let view = await settle();
    const onHold = view.find(n => n.type === 'button' && text(n.props.children).startsWith(lookup(en as never, 'admin.tiles.onHold') as string))!;
    onHold.props.onClick();
    view = render();
    const names = view.filter(n => n.type === 'a' && String(n.props.to).startsWith('/admin/projects/p')).map(n => n.props.to);
    expect(new Set(names)).toEqual(new Set(['/admin/projects/p2']));
  });

  it('the new column names are translated', () => {
    for (const k of ['plan', 'status', 'created', 'actions']) {
      expect(lookup(en as never, `admin.projectsTable.${k}`)).toBeTypeOf('string');
      expect(lookup(fr as never, `admin.projectsTable.${k}`)).toBeTypeOf('string');
    }
    expect(lookup(fr as never, 'admin.projectsTable.plan')).not.toBe(lookup(en as never, 'admin.projectsTable.plan'));
  });
});
