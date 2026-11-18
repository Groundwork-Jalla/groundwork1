import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { lookup } from '@/lib/i18n/translate';

/** Budgets & fees, redesigned (18 Nov, budgets-desktop.png): every control pressed. */

const h = vi.hoisted(() => ({ store: new Map<string, any[]>(), path: 'root', idx: 0, effects: [] as { run: () => any }[], rows: [] as any[] }));
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
vi.mock('react-router', () => ({ Link: 'a' }));
vi.mock('framer-motion', () => ({ motion: { div: 'div' }, AnimatePresence: ({ children }: any) => children }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, values: Record<string, unknown> = {}) => {
  const source = lookup(en as never, key);
  return typeof source === 'string' ? source.replace(/\{(\w+)\}/g, (_m, name) => String(values[name] ?? '')) : key;
} }));
vi.mock('@/lib/domain-labels', () => ({ useDomainLabels: () => ({ country: (c: string) => (c === 'CM' ? 'Cameroon' : c) }) }));
vi.mock('@/lib/supabase/client', () => {
  const chain: any = { select: () => chain, in: () => chain, is: () => chain, order: () => Promise.resolve({ data: h.rows, error: null }) };
  return { supabase: { from: () => chain } };
});
vi.mock('@/lib/supabase/admin-users', () => ({ ownerLookup: async () => new Map([['u1', { email: 'esther@x.cm', name: 'Esther Ndi' }]]) }));
vi.mock('@/lib/supabase/tracking', () => ({ adminStartProjectTracking: vi.fn() }));
vi.mock('@/components/admin/LedgerPanel', () => ({ default: 'mock-ledger' }));
vi.mock('@/components/admin/FinancialOperations', () => ({ FinancialOperations: 'mock-finops' }));
import AdminBudgets from '@/app/routes/admin/budgets';

type Node = { type: any; props: Record<string, any>; key?: string | null };
function expand(value: any, path: string): Node[] {
  if (Array.isArray(value)) return value.flatMap((child, i) => expand(child, `${path}.${child?.key ?? i}`));
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  if (typeof value.type === 'function' && value.type.name !== 'ConfirmBudgetModal') {
    const saved = [h.path, h.idx] as const; h.path = `${path}/${value.type.name}`; h.idx = 0;
    const out = value.type(value.props); const inner = h.path; [h.path, h.idx] = saved;
    return [value, ...expand(out, inner)];
  }
  return [value, ...expand(value.props?.children, path)];
}
const text = (value: any): string => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function render(): Node[] { h.effects = []; h.path = 'root'; h.idx = 0; return expand({ type: AdminBudgets, props: {}, key: null }, 'root'); }
async function settle() { render(); for (const e of h.effects) e.run(); await flush(); return render(); }
const L = (k: string) => lookup(en as never, k) as string;

beforeEach(() => {
  h.store = new Map();
  h.rows = [{ id: 'p1', name: 'Ndi family home', user_id: 'u1', country: 'CM', budget_usd: 48200, sqm: 120, num_floors: 2, created_at: '2026-11-03T08:00:00Z' }];
});

describe('Budgets & fees, redesigned', () => {
  it('the sub-nav jumps to each of the three sections, which all still render', async () => {
    const view = await settle();
    const anchors = view.filter(n => n.type === 'a' && String(n.props.href).startsWith('#')).map(n => n.props.href);
    expect(anchors).toEqual(['#budget-confirmations', '#financial-operations', '#funding-releases']);
    expect(view.find(n => n.props?.id === 'budget-confirmations')).toBeTruthy();
    expect(view.find(n => n.type === 'mock-finops')).toBeTruthy();
    expect(view.find(n => n.type === 'mock-ledger')).toBeTruthy();
  });

  it('Set budget opens the confirmation for that project; the project link and breadcrumb still go where they did', async () => {
    let view = await settle();
    expect(view.filter(n => n.type === 'a').map(n => n.props.to)).toEqual(expect.arrayContaining(['/admin/finance', '/projects/p1']));
    view.find(n => n.type === 'button' && text(n.props.children) === L('admin.budgetsPage.setBudget'))!.props.onClick();
    view = render();
    expect(view.find(n => typeof n.type === 'function' && n.type.name === 'ConfirmBudgetModal')?.props.project.id).toBe('p1');
  });

  it('shows how long a project has waited, its homeowner, country and estimate', async () => {
    const strings = (await settle()).map(n => typeof n.props?.children === 'string' ? n.props.children : '');
    expect(strings.some(s => s.startsWith('Waiting since'))).toBe(true);
    expect(strings).toEqual(expect.arrayContaining(['Esther Ndi', 'Cameroon', '$48,200.00']));
  });

  it('an empty queue says all caught up', async () => {
    h.rows = [];
    const strings = (await settle()).map(n => typeof n.props?.children === 'string' ? n.props.children : '');
    expect(strings).toContain(L('admin.allCaughtUp'));
  });

  it('the title is Budgets & fees, in both languages', () => {
    expect(L('admin.budgetsTitle')).toBe('Budgets & fees');
    expect(lookup(fr as never, 'admin.budgetsTitle')).toBe('Budgets et frais');
    for (const k of ['subtitle', 'confirmations', 'setBudget', 'waitingSince']) expect(lookup(fr as never, `admin.budgetsPage.${k}`), k).not.toBe(L(`admin.budgetsPage.${k}`));
  });
});
