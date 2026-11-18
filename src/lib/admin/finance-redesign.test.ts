import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { lookup } from '@/lib/i18n/translate';
import { monthlyFlows, shares } from './finance-trend';
import { totalsFor, type LedgerLine } from './finance-ledger';

/**
 * The redesigned Finance page (18 Nov, finance-desktop.png). The new chart counts what the
 * cards count; every card, banner and movement still opens where it did.
 */

const h = vi.hoisted(() => ({
  store: new Map<string, any[]>(), path: 'root', idx: 0, effects: [] as { run: () => any }[],
  ledger: vi.fn(), payments: vi.fn(),
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
vi.mock('react-router', () => ({ Link: 'a' }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, values: Record<string, unknown> = {}) => {
  const source = lookup(en as never, key);
  return typeof source === 'string' ? source.replace(/\{(\w+)\}/g, (_m, name) => String(values[name] ?? '')) : key;
} }));
vi.mock('@/lib/supabase/finance-ledger', () => ({ loadFinanceLedger: h.ledger }));
vi.mock('@/lib/supabase/payments', () => ({ listAllPayments: h.payments }));
vi.mock('@/lib/lifecycle/stage', () => ({ availableFunds: () => 32000 }));
import AdminFinance from '@/app/routes/admin/finance';

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
function render(): Node[] { h.effects = []; h.path = 'root'; h.idx = 0; return expand({ type: AdminFinance, props: {}, key: null }, 'root'); }
async function settle() { render(); for (const e of h.effects) e.run(); await flush(); return render(); }

const now = new Date();
const ym = (back: number) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 10)); return d.toISOString(); };
const line = (id: string, direction: 'in' | 'out', state: string, amount: number, at: string): LedgerLine => ({
  id, direction, state: state as LedgerLine['state'], amount, currency: 'USD', projectId: `proj-${id}`, projectName: 'Mbala Residence',
  stage: { number: 5, name: 'Structure & walls' } as never, partyId: 'u1', partyName: 'Claire Mbala', at, atMeans: 'confirmed',
} as unknown as LedgerLine);
const LINES = [
  line('a', 'in', 'funded', 3000, ym(0)), line('b', 'in', 'reconciled', 2000, ym(1)), line('c', 'in', 'expected', 9999, ym(0)),
  line('d', 'out', 'disbursed', 1500, ym(0)), line('e', 'out', 'release_authorised', 800, ym(0)), line('f', 'out', 'failed', 400, ym(2)),
  line('old', 'in', 'funded', 7000, ym(20)),
];

beforeEach(() => {
  h.store = new Map();
  h.ledger.mockReset().mockResolvedValue({ available: true, lines: LINES });
  h.payments.mockReset().mockResolvedValue({ available: true, rows: [] });
});

describe('the month-by-month chart counts what the cards count', () => {
  it('only settled money is drawn, each in its own month', () => {
    const m = monthlyFlows(LINES, 6, now);
    expect(m).toHaveLength(6);
    expect(m[5]).toMatchObject({ inflow: 3000, disbursed: 1500 });
    expect(m[4]).toMatchObject({ inflow: 2000, disbursed: 0 });
    expect(m.reduce((a, r) => a + r.inflow, 0)).toBe(5000);       // expected 9999 and the old 7000 are not drawn
  });

  it('over the whole history the chart and the cards agree', () => {
    const all = monthlyFlows(LINES, 30, now);
    expect(all.reduce((a, r) => a + r.inflow, 0)).toBe(totalsFor(LINES, 'in').settled);
    expect(all.reduce((a, r) => a + r.disbursed, 0)).toBe(totalsFor(LINES, 'out').settled);
  });

  it('shares never divide by zero', () => {
    expect(shares([0, 0])).toEqual([0, 0]);
    expect(shares([1, 3])).toEqual([25, 75]);
  });
});

describe('Finance, redesigned', () => {
  it('cards and the attention banner open their ledgers; every movement opens its project financials', async () => {
    const to = (await settle()).filter(n => n.type === 'a').map(n => n.props.to);
    expect(to).toContain('/admin/finance/inflows');
    expect(to.filter(x => x === '/admin/finance/disbursements').length).toBeGreaterThanOrEqual(3); // 2 cards + banner
    expect(to).toContain('/admin/projects/proj-a?tab=financials');
  });

  it('the period buttons redraw the chart over 3, 6 or 12 months', async () => {
    let view = await settle();
    const bars = () => render().filter(n => n.props?.role === 'img').length;
    expect(bars()).toBe(6);
    view.find(n => n.type === 'button' && text(n.props.children) === '3 months')!.props.onClick();
    expect(bars()).toBe(3);
    view = render();
    view.find(n => n.type === 'button' && text(n.props.children) === '12 months')!.props.onClick();
    expect(bars()).toBe(12);
  });

  it('an empty period says so instead of drawing nothing', async () => {
    h.ledger.mockResolvedValue({ available: true, lines: [line('old', 'in', 'funded', 7000, ym(20))] });
    const strings = (await settle()).map(n => typeof n.props?.children === 'string' ? n.props.children : '');
    expect(strings).toContain(lookup(en as never, 'admin.finance.noFlow'));
  });

  it('without the payments read, available funding is not invented', async () => {
    h.payments.mockResolvedValue({ available: false, rows: [] });
    const strings = (await settle()).map(n => typeof n.props?.children === 'string' ? n.props.children : '');
    expect(strings).toContain(lookup(en as never, 'admin.finance.notAvailable'));
  });

  it('the new strings are translated', () => {
    for (const k of ['inflowsNote', 'approvedNote', 'disbursedNote', 'flowTitle', 'standsTitle', 'months', 'noFlow', 'openDisbursements']) {
      expect(lookup(fr as never, `admin.finance.${k}`), k).not.toBe(lookup(en as never, `admin.finance.${k}`));
    }
  });
});
