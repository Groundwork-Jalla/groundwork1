import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { lookup } from '@/lib/i18n/translate';
import type { LedgerLine } from './finance-ledger';

/**
 * Inflows and Disbursements, redesigned (18 Nov, disbursements-desktop.png). Every chip,
 * the banner, Refresh, the detail panel and the filing form are pressed.
 */

const h = vi.hoisted(() => ({
  store: new Map<string, any[]>(), path: 'root', idx: 0, effects: [] as { run: () => any }[],
  ledger: vi.fn(), attach: vi.fn(),
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
vi.mock('@/lib/supabase/payout-attach', () => ({ attachPayoutReference: h.attach }));
import { FinanceLedger } from '@/components/admin/FinanceLedger';

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
let direction: 'in' | 'out' = 'out';
function render(): Node[] { h.effects = []; h.path = 'root'; h.idx = 0; return expand({ type: FinanceLedger, props: { direction }, key: null }, 'root'); }
async function settle() { render(); for (const e of h.effects) e.run(); await flush(); return render(); }
const L = (k: string) => lookup(en as never, k) as string;
const chip = (view: Node[], label: string) => view.find(n => n.type === 'button' && n.props['aria-pressed'] !== undefined && text(n.props.children).startsWith(label))!;
const rows = (view: Node[]) => view.filter(n => n.type === 'button' && n.props['aria-expanded'] !== undefined);

const line = (id: string, direction: 'in' | 'out', state: string, amount: number, extra: Partial<LedgerLine> = {}): LedgerLine => ({
  id, direction, state: state as LedgerLine['state'], amount, currency: 'USD', projectId: `proj-${id}`, projectName: 'Fon duplex',
  stage: { id: 's3', number: 3, name: 'Site preparation' }, partyId: 'u', partyName: 'Grace Fon', at: '2026-11-17T08:00:00Z', atMeans: 'authorised',
  via: null, actorId: 'ruth', actorName: 'Ruth Achu', initiatedAt: null, providerRef: null, failureReason: null, note: null, local: '1,200,000 XAF', ...extra,
});
const LINES = [
  line('a', 'out', 'release_authorised', 2000), line('b', 'out', 'release_authorised', 6000),
  line('c', 'out', 'initiated', 3700, { providerRef: 'SW-PO-55120' }), line('d', 'out', 'failed', 4200, { providerRef: 'SW-PO-55093', failureReason: 'Wallet closed' }),
  line('e', 'out', 'disbursed', 10000, { providerRef: 'SW-PO-54871' }),
  line('f', 'in', 'funded', 3333), line('g', 'in', 'expected', 5000),
];

beforeEach(() => {
  h.store = new Map(); direction = 'out';
  h.ledger.mockReset().mockResolvedValue({ available: true, degraded: [], lines: LINES });
  h.attach.mockReset().mockResolvedValue(undefined);
});

describe('Disbursements, redesigned', () => {
  it('Refresh re-reads the ledger', async () => {
    const view = await settle();
    expect(h.ledger).toHaveBeenCalledTimes(1);
    await view.find(n => n.type === 'button' && text(n.props.children).includes(L('admin.finance.refresh')))!.props.onClick();
    expect(h.ledger).toHaveBeenCalledTimes(2);
  });

  it('every status chip narrows to its own rows, with its own count', async () => {
    let view = await settle();
    expect(rows(view)).toHaveLength(5);
    for (const [key, n] of [['admin.finance.state.authorised', 2], ['admin.finance.state.initiated', 1], ['admin.finance.state.disbursed', 1], ['admin.finance.state.failed', 1], ['admin.finance.state.reconciling', 0]] as const) {
      const c = chip(view, L(key));
      expect(text(c.props.children)).toContain(String(n));
      c.props.onClick(); view = render();
      expect(rows(view), key).toHaveLength(n);
    }
    chip(view, L('admin.finance.all')).props.onClick(); view = render();
    expect(rows(view)).toHaveLength(5);
  });

  it('the banner counts releases still waiting for a transaction ID, and Show them lists exactly those', async () => {
    let view = await settle();
    const strings = view.map(n => typeof n.props?.children === 'string' ? n.props.children : '');
    expect(strings).toContain('2 approved releases need their SwyChr transaction ID');
    view.find(n => n.type === 'button' && text(n.props.children) === L('admin.finance.showThem'))!.props.onClick();
    view = render();
    expect(rows(view)).toHaveLength(2);
  });

  it('opening a row shows its detail, the filing form when it can take a reference, and the project link', async () => {
    let view = await settle();
    rows(view)[0].props.onClick(); view = render();
    const form = view.find(n => n.type === 'form')!;
    expect(form).toBeTruthy();
    view.find(n => n.type === 'input' && n.props.id === 'ref-a')!.props.onChange({ target: { value: 'SW-PO-55188' } });
    view = render();
    await view.find(n => n.type === 'form')!.props.onSubmit({ preventDefault() {} });
    expect(h.attach).toHaveBeenCalledWith('a', 'SW-PO-55188');
    expect(view.filter(n => n.type === 'a').map(n => n.props.to)).toContain('/admin/projects/proj-a?tab=financials');
  });

  it('a paid row has no filing form', async () => {
    let view = await settle();
    rows(view).find(r => text(r.props.children).includes('SW-PO-54871'))!.props.onClick(); view = render();
    expect(view.find(n => n.type === 'form')).toBeUndefined();
  });

  it('amounts show in USD and in the project currency', async () => {
    const strings = (await settle()).map(n => typeof n.props?.children === 'string' ? n.props.children : '');
    expect(strings).toContain('1,200,000 XAF');
  });

  it('the breadcrumb returns to Finance', async () => {
    expect((await settle()).filter(n => n.type === 'a').map(n => n.props.to)).toContain('/admin/finance');
  });
});

describe('Inflows keep received and expected apart', () => {
  it('two chips, and expected is never in the received list', async () => {
    direction = 'in';
    let view = await settle();
    expect(rows(view)).toHaveLength(1);
    chip(view, L('admin.finance.tab.expected')).props.onClick(); view = render();
    expect(rows(view)).toHaveLength(1);
    expect(text(rows(view)[0].props.children)).toContain('$5,000');
  });
});

describe('copy', () => {
  it('the new strings are translated, and no money-flow leg points at Groundwork', () => {
    for (const k of ['refresh', 'needsRef', 'showThem', 'noRef', 'approvedDecision', 'paidNote']) {
      expect(lookup(fr as never, `admin.finance.${k}`), k).not.toBe(lookup(en as never, `admin.finance.${k}`));
    }
    expect(lookup(en as never, 'admin.budgetsTitle')).toBe('Budgets & fees');
    expect(lookup(fr as never, 'admin.rework.send')).toBeTypeOf('string');
  });
});
