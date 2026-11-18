import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { lookup } from '@/lib/i18n/translate';

/**
 * The redesigned Homeowners page (18 Nov, homeowners-desktop.png): one list, the signup
 * details docked beside it. Every control is pressed and must still go where it did.
 */

const h = vi.hoisted(() => ({
  store: new Map<string, any[]>(), path: 'root', idx: 0, effects: [] as { run: () => any }[],
  params: new URLSearchParams(), list: vi.fn(),
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
vi.mock('react-router', () => ({ Link: 'a', useSearchParams: () => [h.params, (next: any) => {
  h.params = new URLSearchParams(typeof next === 'function' ? next(h.params) : next);
}] }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, values: Record<string, unknown> = {}) => {
  const source = lookup(en as never, key);
  return typeof source === 'string' ? source.replace(/\{(\w+)\}/g, (_m, name) => String(values[name] ?? '')) : key;
} }));
vi.mock('@/lib/format', () => ({ formatRelative: (value: string) => `rel(${value})` }));
vi.mock('@/lib/domain-labels', () => ({ useDomainLabels: () => ({ tier: (v: string) => v }) }));
vi.mock('@/lib/supabase/admin-clients', () => ({ listClients: h.list }));
vi.mock('@/components/ui/EmptyState', () => ({ EmptyState: 'mock-empty' }));
vi.mock('@/components/admin/PersonPreview', async original => ({
  ...(await original<typeof import('@/components/admin/PersonPreview')>()), PersonPreview: 'mock-person',
}));
import AdminClients from '@/app/routes/admin/clients';

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
function render(): Node[] { h.effects = []; h.path = 'root'; h.idx = 0; return expand({ type: AdminClients, props: {}, key: null }, 'root'); }
async function settle() { render(); for (const e of h.effects) e.run(); await flush(); return render(); }

const client = (id: string, name: string, projects: any[]) => ({ id, name, email: `${id}@x.cm`, createdAt: '2026-10-30', lastSignInAt: null, conversations: 2, openTickets: 0, projects });
const DIR = { conversationsAvailable: true, ticketsAvailable: false, rows: [
  client('claire', 'Claire Mbala', [{ id: 'p1', name: 'Mbala Residence', currentStage: 5, stagesTotal: 10, tier: 'jalla_verify', status: 'active', city: 'Douala', country: 'CM' }]),
  client('amina', 'Amina Ndi', []),
] };

beforeEach(() => { h.store = new Map(); h.params = new URLSearchParams(); h.list.mockReset().mockResolvedValue(DIR); });

describe('Homeowners, redesigned', () => {
  it('every project opens its admin workspace', async () => {
    const view = await settle();
    expect(view.filter(n => n.type === 'a').map(n => n.props.to)).toEqual(['/admin/projects/p1']);
  });

  it('a name opens the signup details docked beside the list, and marks the row', async () => {
    let view = await settle();
    expect(view.find(n => n.type === 'mock-person')?.props.reference).toBeNull();
    view.find(n => n.type === 'button' && text(n.props.children) === 'Claire Mbala')!.props.onClick();
    expect(h.params.get('person')).toBeTruthy();
    view = render();
    const panel = view.find(n => n.type === 'mock-person')!;
    expect(panel.props.docked).toBe(true);
    expect(panel.props.reference).toMatchObject({ userId: 'claire' });
    expect(view.find(n => n.type === 'button' && text(n.props.children) === 'Claire Mbala')!.props['aria-pressed']).toBe(true);
    panel.props.onClose();
    expect(h.params.get('person')).toBeNull();
  });

  it('search and the Building now chip filter through the URL', async () => {
    let view = await settle();
    view.find(n => n.type === 'input')!.props.onChange({ target: { value: 'amina' } });
    expect(h.params.get('q')).toBe('amina');
    view = render();
    expect(view.filter(n => n.type === 'button' && n.props.title).map(n => text(n.props.children))).toEqual(['Amina Ndi']);
    h.params = new URLSearchParams();
    view = render();
    const chip = view.find(n => n.type === 'button' && n.props['aria-pressed'] === false && text(n.props.children).startsWith(lookup(en as never, 'admin.clients.building') as string))!;
    chip.props.onClick();
    expect(h.params.get('projects')).toBe('with');
    view = render();
    expect(view.filter(n => n.type === 'button' && n.props.title).map(n => text(n.props.children))).toEqual(['Claire Mbala']);
  });

  it('unavailable is still n/a, not zero', async () => {
    const strings = (await settle()).map(n => typeof n.props?.children === 'string' ? n.props.children : '');
    expect(strings).toContain(lookup(en as never, 'admin.clients.notAvailable'));
  });
});
