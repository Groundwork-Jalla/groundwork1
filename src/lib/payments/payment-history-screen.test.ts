import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StagePayment, StagePaymentReceipt } from '@/lib/supabase/verifications';
import { en } from '@/lib/i18n/en';
import { lookup } from '@/lib/i18n/translate';

const h = vi.hoisted(() => ({ state: [] as any[], si: 0, sign: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = h.si++; if (!(i in h.state)) h.state[i] = typeof initial === 'function' ? initial() : initial;
    return [h.state[i], (value: any) => { h.state[i] = typeof value === 'function' ? value(h.state[i]) : value; }]; },
  useRef: (initial: any) => ({ current: initial }),
  useMemo: (make: () => any) => make(),
}));
vi.mock('@/lib/i18n', () => ({ useLanguage: () => ({ lang: 'en' }), useT: () => (key: string, values: Record<string, unknown> = {}) => {
  const source = lookup(en as never, key) as string;
  return source.replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ''));
} }));
vi.mock('@/lib/supabase/verifications', () => ({ signReceiptUrl: h.sign }));
vi.mock('@/components/project/DocumentViewer', () => ({ DocumentViewer: () => null }));
vi.mock('@/lib/supabase/documents', () => ({ signedUrlIn: vi.fn() }));
import { ProjectPaymentHistory } from '@/components/project/ProjectPaymentHistory';
import { ReceiptThumb } from '@/components/project/ReceiptThumb';
import { DocumentViewer } from '@/components/project/DocumentViewer';

type Node = { type: any; props: Record<string, any> };
function nodes(value: any): Node[] { return Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []; }
function text(value: any): string { return Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : ''; }

const receipt = (patch: Partial<StagePaymentReceipt>): StagePaymentReceipt => ({ id: 'r', stageId: 's3', path: 'p/receipts/a.pdf', submittedAt: '2026-11-14T10:00:00Z',
  amount: 1000, currency: 'XAF', fxRate: null, amountUsd: null, decision: 'received', allowsWork: true, requestedTopUp: null, decisionNote: null, decidedAt: null,
  projectCurrency: 'XAF', ...patch, projectAmount: patch.projectAmount ?? patch.amount ?? 1000 });
const tranche = (stageId: string, receipts: StagePaymentReceipt[], state: StagePayment['state'] = 'funded'): StagePayment =>
  ({ id: `pay-${stageId}`, stageId, state, amount: 100, receiptPath: null, receiptUploadedAt: null, receipts });
const stages = [
  { id: 's3', stage_number: 3, milestone_amount: 1200000, name: 'Site preparation' },
  { id: 's4', stage_number: 4, milestone_amount: 6000000, name: 'Foundation' },
  { id: 's5', stage_number: 5, milestone_amount: 10000000, name: 'Structure & walls' },
  { id: 's6', stage_number: 6, milestone_amount: 8400000, name: 'Roofing' },
];
const payments = new Map<string, StagePayment>([
  ['s3', tranche('s3', [
    receipt({ id: 'flag', amount: 1200000, decision: 'flagged', submittedAt: '2026-10-15T10:00:00Z', decisionNote: 'The amount on this receipt reads 1,100,000.' }),
    receipt({ id: 'old', amount: 1100000, replacedBy: 'flag', submittedAt: '2026-10-12T10:00:00Z' })])],
  ['s4', tranche('s4', [
    receipt({ id: 'usd', stageId: 's4', amount: 2500, currency: 'USD', projectAmount: 1500000, submittedAt: '2026-11-06T10:00:00Z' }),
    receipt({ id: 'xaf', stageId: 's4', amount: 4500000, submittedAt: '2026-10-28T10:00:00Z' })])],
  ['s5', tranche('s5', [receipt({ id: 'wait', stageId: 's5', amount: 3000000, decision: 'pending', substageId: 'sub-1' })], 'receipt_submitted')],
  ['s6', tranche('s6', [], 'expected')],
]);
const openStage = vi.fn(); const addReceipt = vi.fn();
const props = { stagePayments: payments, projectCurrency: 'XAF', stages, projectRate: 600,
  substages: [{ id: 'sub-1', substage_number: 1, substage_key: null, name: 'Columns and ring beam' }],
  stageName: (id: string) => stages.find(stage => stage.id === id)?.name ?? '' };
function render(overrides: Record<string, unknown> = {}) {
  h.si = 0;
  const tree = ProjectPaymentHistory({ ...props, ...overrides } as never);
  return { all: nodes(tree), html: renderToStaticMarkup(tree) };
}
const homeowner = { audience: 'client', layout: 'full', onOpenStage: openStage, onAddReceipt: addReceipt, canReplace: true } as const;
const button = (view: Node[], label: string) => view.find(node => node.type === 'button' && text(node.props.children).startsWith(label));
const items = (view: Node[]) => view.filter(node => node.type === 'li' && node.props['data-status']).map(node => node.props['data-status']);

describe('the homeowner payment history, built to the 18 Nov mock-up', () => {
  beforeEach(() => { h.state = []; openStage.mockReset(); addReceipt.mockReset(); });

  it('opens on what is confirmed, what is waiting and what is still to pay, from the stage balances', () => {
    const { all } = render(homeowner);
    const figure = (key: string) => text(all.find(node => node.props['data-figure'] === key)!.props.children);
    expect(figure('confirmed')).toContain('6,000,000 XAF');
    expect(figure('awaiting')).toContain('3,000,000 XAF');
    expect(figure('awaiting')).toContain('Receipts waiting: 1');
    expect(figure('remaining')).toContain('19,600,000 XAF');
    expect(figure('remaining')).toContain('Of 25,600,000 XAF across the stages');
  });

  it('lists every receipt newest first, with the part, the franc equivalent and the replaced one kept', () => {
    const { all, html } = render(homeowner);
    expect(items(all)).toEqual(['pending', 'received', 'received', 'flagged', 'replaced']);
    expect(html).toContain('5 · Structure &amp; walls');
    expect(html).toContain('Part 1 · Columns and ring beam');
    expect(html).toContain('2,500 USD');
    expect(html).toContain('Project equivalent: 1,500,000 XAF');
    expect(html).toContain('Replaced by a newer receipt');
    expect(html).not.toMatch(/\d,\d{3}\.\d+ XAF/);
  });

  it('puts the contractor’s note under the flagged receipt and sends the homeowner to its stage', () => {
    const { all, html } = render(homeowner);
    expect(html).toContain('Your contractor:</b> The amount on this receipt reads 1,100,000.');
    const link = all.filter(node => node.type === 'button' && text(node.props.children) === 'Open stage 3 to replace it');
    expect(link.length).toBeGreaterThan(0);
    link[0].props.onClick();
    expect(openStage).toHaveBeenCalledWith('s3');
  });

  it('filters by status, with the counts on the chips', () => {
    let { all } = render(homeowner);
    expect(text(button(all, 'All')!.props.children)).toBe('All5');
    expect(text(button(all, 'To review')!.props.children)).toBe('To review1');
    expect(button(all, 'All')!.props['aria-pressed']).toBe(true);
    button(all, 'To review')!.props.onClick();
    ({ all } = render(homeowner));
    expect(items(all)).toEqual(['flagged']);
    expect(button(all, 'To review')!.props['aria-pressed']).toBe(true);
    button(all, 'Received')!.props.onClick();
    expect(items(render(homeowner).all)).toEqual(['received', 'received']);
  });

  it('shows each stage’s price and standing, and adds a receipt through the stages', () => {
    const { all, html } = render(homeowner);
    const standing = all.filter(node => node.type === 'li' && node.props['data-standing']).map(node => node.props['data-standing']);
    expect(standing).toEqual(['flagged', 'paid', 'pending', 'unpaid']);
    expect(html).toContain('6,000,000 confirmed');
    expect(html).toContain('3,000,000 awaiting');
    expect(html).toContain('Nothing paid yet');
    button(all, 'Add a payment receipt')!.props.onClick();
    expect(addReceipt).toHaveBeenCalled();
  });

  it('offers no replacement to someone who cannot upload, and no summary outside the Costing tab', () => {
    const viewer = render({ ...homeowner, canReplace: false, onAddReceipt: undefined });
    expect(viewer.html).not.toContain('to replace it');
    expect(viewer.html).not.toContain('Add a payment receipt');
    const list = render({ audience: 'client' });
    expect(list.all.some(node => node.props['data-figure'])).toBe(false);
    expect(list.html).not.toContain('By stage');
  });

  it('shows a small preview of every receipt, and a tap opens it large on the same page', async () => {
    for (const audience of [homeowner, {}]) {
      h.state = []; h.sign.mockReset().mockResolvedValue('https://files.test/signed/a.pdf');
      let { all, html } = render(audience);
      const thumbs = all.filter(node => node.type === ReceiptThumb);
      expect(thumbs.map(node => node.props.path)).toHaveLength(5);
      expect(thumbs.find(node => node.props.muted)).toBeTruthy();
      expect(html).toContain('data-receipt-thumb="p/receipts/a.pdf"');
      expect(all.some(node => node.type === DocumentViewer)).toBe(false);
      thumbs[0].props.onOpen();
      await Promise.resolve(); await Promise.resolve();
      expect(h.sign).toHaveBeenCalledWith('p/receipts/a.pdf');
      ({ all } = render(audience));
      expect(all.find(node => node.type === DocumentViewer)!.props).toMatchObject({ name: 'a.pdf', url: 'https://files.test/signed/a.pdf' });
    }
  });

  it('gives the contractor the same list, their own note, and no homeowner actions', () => {
    const { html } = render({});
    expect(html).toContain('Your note:</b>');
    expect(html).not.toContain('to replace it');
    expect(html).toContain('Confirmed received: 6,000,000 XAF');
  });
});
