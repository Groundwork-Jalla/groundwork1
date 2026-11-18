import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { lookup } from '@/lib/i18n/translate';

/**
 * Every button on the redesigned contractor project screen (18 Nov), pressed.
 *
 * The page is rendered whole — header, tabs, Work, Money, the "Did this payment arrive?"
 * dialog and the payment history — with React's hooks kept per component, so a click
 * changes state the way it would in the browser and the next render shows the result.
 * Each test presses a button and checks where it went: which tab, which stage, which
 * dialog, which decision was sent to the database.
 */

const h = vi.hoisted(() => ({
  store: new Map<string, any[]>(), path: 'root', idx: 0, effects: [] as { path: string; run: () => any }[],
  params: new URLSearchParams(), setParams: vi.fn(),
  access: {} as any, project: {} as any, stages: [] as any[], substages: [] as any[], payments: new Map<string, any>(),
  parts: null as any, decide: vi.fn(), sign: vi.fn(), load: vi.fn(), scrolled: [] as string[],
}));

vi.mock('react', async original => {
  const real = await original<typeof import('react')>();
  const slot = () => { const list = h.store.get(h.path) ?? []; h.store.set(h.path, list); return { list, i: h.idx++ }; };
  return { ...real,
    useState: (initial: any) => { const { list, i } = slot(); if (!(i in list)) list[i] = typeof initial === 'function' ? initial() : initial;
      return [list[i], (value: any) => { list[i] = typeof value === 'function' ? value(list[i]) : value; }]; },
    useRef: (initial: any) => { const { list, i } = slot(); if (!(i in list)) list[i] = { current: initial }; return list[i]; },
    useEffect: (run: () => any) => { h.idx++; h.effects.push({ path: h.path, run }); },
    useMemo: (make: () => any) => { h.idx++; return make(); },
    useCallback: (callback: any) => { h.idx++; return callback; },
  };
});
vi.mock('react-router', () => ({ Navigate: 'navigate', Link: 'a', useParams: () => ({ projectId: 'project' }),
  useSearchParams: () => [h.params, (next: any) => { h.setParams(next); h.params = typeof next === 'function' ? next(h.params) : next; }] }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'contractor' } }) }));
vi.mock('@/hooks/useProjectTeamAccess', () => ({ useProjectTeamAccess: () => ({ access: h.access, error: false, refresh: vi.fn() }) }));
vi.mock('@/hooks/useProjectNotificationFocus', () => ({ useProjectNotificationFocus: vi.fn() }));
vi.mock('@/lib/i18n', () => ({ useLanguage: () => ({ lang: 'en' }), useT: () => (key: string, values: Record<string, unknown> = {}) => {
  const source = lookup(en as never, key);
  return typeof source === 'string' ? source.replace(/\{(\w+)\}/g, (_m, name) => String(values[name] ?? '')) : key;
} }));
vi.mock('@/lib/stage-labels', () => ({ useStageLabels: () => ({ stageLabel: (s: any) => s.name, substageLabel: (s: any) => s.name }), substageLabelWith: (_t: unknown, s: any) => s.name }));
vi.mock('@/lib/supabase/client', () => { const chain: any = { on: () => chain, subscribe: () => chain }; return { supabase: { channel: () => chain, removeChannel: vi.fn() } }; });
vi.mock('@/lib/supabase/contractor-work', () => ({
  fetchAssignedProject: async () => { h.load(); return { project: h.project, stages: h.stages, activeStage: null, completedStages: h.stages.filter(s => s.status === 'complete').length, totalStages: h.stages.length }; },
  fetchSubstages: async () => h.substages, fetchProjectDocuments: async () => [], fetchRework: async () => [],
  fetchMyPayments: async () => ({ rows: [], available: true }), submitSiteUpdate: vi.fn() }));
vi.mock('@/lib/supabase/verifications', () => ({ fetchStagePayments: async () => h.payments, decideStagePaymentReceipt: h.decide, signReceiptUrl: h.sign }));
vi.mock('@/lib/supabase/substage-payments', async original => ({ ...await original<object>(),
  useSubstagePayments: (stageId: string | undefined) => stageId && h.parts?.stage_id === stageId ? h.parts : null }));
vi.mock('@/lib/budget/use-project-money', () => ({ useProjectMoney: () => ({ code: 'XAF', rate: 600, budgetRate: 600,
  pair: (usd: number | null | undefined, source?: number | null) => usd == null && source == null ? null : { local: `${(source ?? Math.round((usd ?? 0) * 600)).toLocaleString('en-US')} XAF`, usd: null, rate: null },
  local: (usd: number) => `${Math.round(usd * 600).toLocaleString('en-US')} XAF` }) }));
vi.mock('@/lib/budget/project-money-context', () => ({ ProjectMoneyProvider: ({ children }: any) => children, useProjectMoneyContext: () => null, useMoney: () => String }));
vi.mock('@/lib/supabase/project-viewers', () => ({ fetchProjectViewers: async () => [] }));
vi.mock('@/lib/supabase/documents', () => ({ getSignedDocumentUrl: vi.fn(), signedUrlIn: vi.fn() }));
vi.mock('@/lib/supabase/certificates', () => ({ fetchProjectCertificates: async () => [] }));
for (const [path, name] of [
  ['@/components/project/ProjectBackLink', 'ProjectBackLink'], ['@/components/project/ProjectCloseoutPanel', 'ProjectCloseoutPanel'],
  ['@/components/project/ProjectDocuments', 'ProjectDocuments'], ['@/components/project/ProjectConversations', 'ProjectConversations'],
  ['@/components/project/ProjectSharing', 'ProjectSharing'], ['@/components/project/StagePaymentGate', 'StagePaymentGate'],
  ['@/components/project/StageBreakdownPanel', 'StageBreakdownPanel'], ['@/components/project/StagePricingPanel', 'StagePricingPanel'],
  ['@/components/project/EvidenceThumbs', 'EvidenceThumbs'], ['@/components/project/ReceiptThumb', 'ReceiptThumb'],
  ['@/components/project/DocumentViewer', 'DocumentViewer'],
] as const) vi.doMock(path, () => ({ [name]: `mock-${name}` }));
vi.mock('@/components/project/ExchangeRateNote', () => ({ ProjectExchangeRateNote: 'mock-rate', ReceiptExchangeRateNote: 'mock-rate' }));

type Node = { type: any; props: Record<string, any>; key?: string | null };

/** Render a tree, calling every function component with its own hook slots. */
function expand(value: any, path: string): Node[] {
  if (Array.isArray(value)) return value.flatMap((child, i) => expand(child, `${path}.${child?.key ?? i}`));
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  if (typeof value.type === 'function') {
    const saved = [h.path, h.idx] as const;
    h.path = `${path}/${value.type.name}`; h.idx = 0;
    const out = value.type(value.props);
    const inner = h.path; [h.path, h.idx] = saved;
    return [value, ...expand(out, inner)];
  }
  return [value, ...expand(value.props?.children, path)];
}
let Page: () => any;
function render(): Node[] { h.effects = []; h.path = 'root'; h.idx = 0; return expand({ type: Page, props: {}, key: null }, 'root'); }
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const text = (value: any): string => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const buttons = (view: Node[]) => view.filter(node => node.type === 'button');
const button = (view: Node[], label: string | RegExp) => {
  const hit = buttons(view).find(node => typeof label === 'string' ? text(node.props.children).trim() === label : label.test(text(node.props.children)));
  if (!hit) throw new Error(`no button "${label}" among: ${buttons(view).map(node => JSON.stringify(text(node.props.children).trim())).join(', ')}`);
  return hit;
};
const press = async (view: Node[], label: string | RegExp) => { await button(view, label).props.onClick?.({ preventDefault() {} }); await flush(); return render(); };
const find = (view: Node[], test: (node: Node) => boolean) => view.find(test);
const dialog = (view: Node[]) => find(view, node => node.props?.['data-receipt-decision']);
const activeTab = (view: Node[]) => find(view, node => node.type === 'button' && node.props['aria-current'] === 'page')?.props['data-tab'];
const detailTitle = (view: Node[]) => text(find(view, node => node.props?.id === 'work-stage-detail-title')?.props.children);

const stage = (n: number, status: string, extra: Record<string, unknown> = {}) => ({ id: `s${n}`, project_id: 'project', stage_number: n, name: `Stage name ${n}`,
  stage_key: null, status, budget_pct: 10, fixed_amount_usd: null, payment_milestone_usd: 1000 * n, milestone_amount: 600000 * n, payment_status: 'paid',
  completed_at: null, planned_start: null, planned_end: null, notes: null, created_at: '', ...extra });
const receipt = (id: string, stageId: string, decision: string, extra: Record<string, unknown> = {}) => ({ id, stageId, path: `p/receipts/${id}.pdf`, submittedAt: '2026-11-18T09:00:00Z',
  amount: 1000000, currency: 'XAF', fxRate: null, amountUsd: null, decision, allowsWork: decision === 'received', requestedTopUp: null, decisionNote: null, decidedAt: null,
  projectAmount: 1000000, projectCurrency: 'XAF', ...extra });
const item = (n: number, status: string, evidence: string[] = []) => ({ id: `i${n}`, stage_id: 's5', project_id: 'project', substage_number: n, substage_key: null,
  name: `Part name ${n}`, status, evidence_urls: evidence, approved_by: null, approved_at: null, completed_at: null, created_at: '' });

function scenario(kind: 'receipt' | 'upload' | 'invite' | 'review') {
  h.project = { id: 'project', name: 'Mbala Residence', user_id: 'client', country: 'CM', city: 'Douala', status: 'active', workflow_origin: 'client', budget_source: 'boq', budget_usd: 100000, budget_amount: 60000000 };
  h.stages = [stage(1, 'complete'), stage(2, 'complete'), stage(3, 'complete'), stage(4, 'complete'),
    stage(5, 'active', { paid_by_part: true }), stage(6, 'locked')];
  const third = kind === 'receipt' ? 'pending' : 'received';
  h.substages = [item(1, 'complete', ['a.jpg']), item(2, 'complete', ['b.jpg']), item(3, 'pending', kind === 'review' ? ['c.jpg'] : []), item(4, 'pending', kind === 'review' ? ['d.jpg'] : [])];
  h.payments = new Map<string, any>([
    ['s4', { id: 'pay4', stageId: 's4', state: 'funded', amount: 4000, receiptPath: null, receiptUploadedAt: null, receipts: [receipt('r4', 's4', 'received', { amount: 2400000, projectAmount: 2400000 })] }],
    ['s5', { id: 'pay5', stageId: 's5', state: 'funded', amount: 5000, receiptPath: null, receiptUploadedAt: null, receipts: [
      receipt('r1', 's5', 'received', { substageId: 'i1' }), receipt('r2', 's5', 'received', { substageId: 'i2' }), receipt('r3', 's5', third, { substageId: 'i3', amount: 600000, projectAmount: 600000 })] }],
  ]);
  const paid = (n: number) => n < 3 || (n === 3 && third === 'received');
  h.parts = { stage_id: 's5', split: true, currency: 'XAF', next_payable: kind === 'receipt' ? null : 'i4', parts: [1, 2, 3, 4].map(n => ({ id: `i${n}`, number: n, name: `Part name ${n}`, key: null,
    status: n < 3 ? 'complete' : 'pending', price: String([1000000, 1000000, 600000, 400000][n - 1]), covered: '0', remaining: '0', pending: n === 3 && third === 'pending' ? '600000' : '0',
    paid: paid(n), payable: n === 4, work_ready: paid(n) })) };
  h.access = { assignedContractor: true, primaryContractor: true, canInviteClient: true, hasClientInvitation: kind !== 'invite' };
}

async function open(kind: Parameters<typeof scenario>[0] = 'receipt') {
  scenario(kind);
  render();
  const load = h.effects.find(effect => effect.path === 'root/ContractorProjectDetail');
  load?.run(); await flush();
  return render();
}

beforeEach(async () => {
  h.store = new Map(); h.params = new URLSearchParams(); h.setParams.mockReset(); h.decide.mockReset().mockResolvedValue({}); h.load.mockReset();
  h.sign.mockReset().mockResolvedValue('https://files.test/r3.pdf'); h.scrolled = [];
  (globalThis as any).window = { setTimeout: (run: () => void) => run(), location: { search: '' }, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() };
  (globalThis as any).document = { body: { style: {} }, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    getElementById: (id: string) => ({ scrollIntoView: () => h.scrolled.push(id) }) };
  Page = (await import('@/app/routes/work/projects.detail')).default;
});

describe('the contractor project header and tabs', () => {
  it('opens on Work, and every tab button shows its own tab', async () => {
    let view = await open();
    expect(activeTab(view)).toBe('work');
    for (const [tab, label, marker] of [['money', 'Money', 'MoneyTab'], ['documents', 'Documents', 'mock-ProjectDocuments'], ['messages', 'Messages', 'mock-ProjectConversations'], ['people', 'People', 'PeopleTab'], ['work', 'Work', 'WorkTab']] as const) {
      view = await press(view, new RegExp(`^${label}`));
      expect(activeTab(view), label).toBe(tab);
      expect(view.some(node => node.type === marker || node.type?.name === marker), `${label} shows ${marker}`).toBe(true);
    }
  });

  it('"Message homeowner" goes to Messages', async () => {
    const view = await press(await open(), 'Message homeowner');
    expect(activeTab(view)).toBe('messages');
    expect(view.some(node => node.type === 'mock-ProjectConversations')).toBe(true);
  });
});

describe('the Work tab', () => {
  it('leads with the receipt to confirm, and its button opens "Did this payment arrive?" on that receipt', async () => {
    let view = await open();
    expect(find(view, node => node.props?.['data-next-step'])?.props['data-next-step']).toBe('receipt');
    expect(text(find(view, node => node.props?.['data-next-step']))).toContain('Confirm the homeowner’s payment for Part 3 · Part name 3');
    view = await press(view, 'Review receipt');
    expect(dialog(view)?.props['data-receipt-decision']).toBe('r3');
    expect(text(dialog(view))).toContain('Did this payment arrive?');
  });

  it('every stage row opens that stage', async () => {
    let view = await open();
    expect(detailTitle(view)).toBe('Stage name 5');
    for (const n of [1, 4, 6, 5]) {
      await find(view, node => node.props?.['data-stage-row'] === n)!.props.onClick();
      view = render();
      expect(detailTitle(view), `row ${n}`).toBe(`Stage name ${n}`);
    }
  });

  it('the part waiting for confirmation has its own Review button, and no Upload until it is confirmed', async () => {
    let view = await open();
    const row = find(view, node => node.props?.id === 'substage-i3')!;
    const inRow = expand(row, 'x');
    expect(inRow.some(node => node.props?.['data-action'] === 'upload')).toBe(false);
    await find(inRow, node => node.props?.['data-action'] === 'review-part-receipt')!.props.onClick();
    view = render();
    expect(dialog(view)?.props['data-receipt-decision']).toBe('r3');
  });

  it('the stage payment panel hands its Review button to the same dialog', async () => {
    let view = await open();
    const gate = find(view, node => node.type === 'mock-StagePaymentGate')!;
    expect(gate.props).toMatchObject({ stageId: 's5', isContractor: true, readOnly: false, hideParts: true });
    gate.props.onReviewReceipt('r3');
    view = render();
    expect(dialog(view)?.props['data-receipt-decision']).toBe('r3');
  });

  it('when the part is paid, the next step is its upload, and both Upload buttons open the upload form on that part', async () => {
    let view = await open('upload');
    expect(find(view, node => node.props?.['data-next-step'])?.props['data-next-step']).toBe('upload');
    view = await press(view, 'Upload updates');
    expect(h.scrolled).toContain('substage-i3');
    expect(view.some(node => node.type?.name === 'SubmitWork' && node.props.fixedSubstageId === 'i3')).toBe(true);
    // Cancel closes it; the row's own Upload opens it again.
    await find(view, node => node.type?.name === 'SubmitWork')!.props.onCancel();
    view = render();
    expect(view.some(node => node.type?.name === 'SubmitWork')).toBe(false);
    const upload = expand(find(view, node => node.props?.id === 'substage-i3')!, 'x').find(node => node.props?.['data-action'] === 'upload')!;
    await upload.props.onClick(); view = render();
    expect(view.some(node => node.type?.name === 'SubmitWork' && node.props.fixedSubstageId === 'i3')).toBe(true);
    // The unpaid part offers no Upload; it says when it can be paid instead.
    const locked = expand(find(view, node => node.props?.id === 'substage-i4')!, 'x');
    expect(locked.some(node => node.props?.['data-action'] === 'upload')).toBe(false);
    expect(text(locked[0])).toContain('Paid after Part 3 is approved');
  });

  it('with no homeowner yet, "Invite" goes to the invitation on the Work tab', async () => {
    const view = await open('invite');
    expect(find(view, node => node.props?.['data-next-step'])?.props['data-next-step']).toBe('invite');
    expect(view.some(node => node.props?.id === 'work-invite')).toBe(true);
    await press(view, 'Invite');
    expect(h.scrolled).toContain('work-invite');
  });

  it('when the move is the homeowner\'s, the card offers a message instead of a task', async () => {
    const view = await open('review');
    expect(find(view, node => node.props?.['data-next-step'])?.props['data-next-step']).toMatch(/await/);
    const next = expand(find(view, node => node.props?.['data-next-step'])!, 'x');
    await find(next, node => node.type === 'button')!.props.onClick(); await flush();
    expect(activeTab(render())).toBe('messages');
  });

  it('the close-out panel\'s "view stage" opens that stage on Work', async () => {
    let view = await press(await open(), /^Money/);
    // The panel only renders on Work; switching back and asking it for stage 2.
    view = await press(view, /^Work/);
    find(view, node => node.type === 'mock-ProjectCloseoutPanel')!.props.onViewStage('s2');
    view = render();
    expect(activeTab(view)).toBe('work');
    expect(detailTitle(view)).toBe('Stage name 2');
    expect(h.scrolled).toContain('work-stage-detail');
  });
});

describe('"Did this payment arrive?"', () => {
  async function openDialog() { return press(await open(), 'Review receipt'); }

  it('"Yes, it arrived" allows work with the receipt as read, reloads, and closes', async () => {
    const view = await press(await openDialog(), 'Yes, it arrived · allow work');
    expect(h.decide).toHaveBeenCalledWith('r3', 'accept', undefined, undefined, { stageAmount: 3000000, decision: 'pending' });
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(dialog(view)).toBeUndefined();
  });

  it('"The amount is different" offers allow anyway, record only, and ask for the rest', async () => {
    let view = await press(await openDialog(), 'The amount is different');
    const radios = () => view.filter(node => node.type === 'input' && node.props.type === 'radio');
    expect(radios().map(node => node.props.value)).toEqual(['accept', 'record', 'needs_top_up']);
    radios()[1].props.onChange(); view = render();
    await find(view, node => node.type === 'form' && node.props['data-step'] === 'different')!.props.onSubmit({ preventDefault() {} }); await flush();
    expect(h.decide).toHaveBeenLastCalledWith('r3', 'record', undefined, undefined, { stageAmount: 3000000, decision: 'pending' });
  });

  it('"Ask for the rest" sends the amount still due, prefilled', async () => {
    let view = await press(await openDialog(), 'The amount is different');
    view.filter(node => node.type === 'input' && node.props.type === 'radio')[2].props.onChange(); view = render();
    const amount = find(view, node => node.type === 'input' && node.props.inputMode === 'decimal')!;
    // Stage 5 is 3,000,000; parts 1 and 2 (2,000,000) are confirmed and this receipt is 600,000.
    expect(amount.props.value).toBe('400000');
    await find(view, node => node.type === 'form' && node.props['data-step'] === 'different')!.props.onSubmit({ preventDefault() {} }); await flush();
    expect(h.decide).toHaveBeenLastCalledWith('r3', 'needs_top_up', undefined, '400000', { stageAmount: 3000000, decision: 'pending' });
  });

  it('"It hasn\'t arrived" needs a reason, then flags the receipt with it', async () => {
    let view = await press(await openDialog(), 'It hasn’t arrived');
    const form = () => find(view, node => node.type === 'form' && node.props['data-step'] === 'missing')!;
    await form().props.onSubmit({ preventDefault() {} }); await flush(); view = render();
    expect(h.decide).not.toHaveBeenCalled();
    find(view, node => node.type === 'textarea')!.props.onChange({ target: { value: 'Not in my MoMo account' } }); view = render();
    await form().props.onSubmit({ preventDefault() {} }); await flush();
    expect(h.decide).toHaveBeenCalledWith('r3', 'flag', 'Not in my MoMo account', undefined, { stageAmount: 3000000, decision: 'pending' });
  });

  it('Back returns to the question; the close button and Cancel close it', async () => {
    let view = await press(await openDialog(), 'The amount is different');
    view = await press(view, 'Back');
    expect(find(view, node => node.props?.['data-step'] === 'ask')).toBeTruthy();
    view = await press(view, 'Cancel');
    expect(dialog(view)).toBeUndefined();
    view = await press(view, 'Review receipt');
    await find(view, node => node.type === 'button' && node.props['aria-label'] === 'Close')!.props.onClick(); await flush();
    expect(dialog(render())).toBeUndefined();
  });

  it('tapping the receipt opens it large on the same page', async () => {
    let view = await openDialog();
    await find(view, node => node.type === 'mock-ReceiptThumb')!.props.onOpen(); await flush(); view = render();
    expect(h.sign).toHaveBeenCalledWith('p/receipts/r3.pdf');
    expect(find(view, node => node.type === 'mock-DocumentViewer')?.props).toMatchObject({ name: 'r3.pdf', url: 'https://files.test/r3.pdf' });
  });

  it('a refusal stays in the dialog, in words', async () => {
    h.decide.mockRejectedValueOnce({ message: 'receipt_decided' });
    const view = await press(await openDialog(), 'Yes, it arrived · allow work');
    expect(dialog(view)).toBeTruthy();
    expect(text(find(view, node => node.props?.role === 'alert'))).toBe(en.project.receiptFlow.refreshReceipt);
  });
});

describe('the Money tab', () => {
  async function money() { return press(await open(), /^Money/); }

  it('shows the three figures from the schedule and the confirmed receipts', async () => {
    const view = await money();
    const figure = (key: string) => text(find(view, node => node.props?.['data-figure'] === key));
    expect(figure('confirmed')).toContain('4,400,000 XAF');
    expect(figure('toCome')).toContain('6,600,000 XAF');
  });

  it('"Review receipt" under Needs you opens the waiting receipt', async () => {
    const view = await money();
    const card = expand(find(view, node => node.props?.['data-needs-you'] !== undefined)!, 'x');
    await find(card, node => node.type === 'button')!.props.onClick(); await flush();
    expect(dialog(render())?.props['data-receipt-decision']).toBe('r3');
  });

  it('the payment history filters work and its Review button opens the same dialog', async () => {
    let view = await money();
    const rows = () => view.filter(node => node.type === 'li' && node.props['data-status']).map(node => node.props['data-status']);
    expect(rows()).toHaveLength(4);
    view = await press(view, /^To confirm/); expect(rows()).toEqual(['pending']);
    view = await press(view, /^Received/); expect(rows()).toEqual(['received', 'received', 'received']);
    view = await press(view, /^All/); expect(rows()).toHaveLength(4);
    await find(view, node => node.props?.['data-review-receipt'] === 'r3')!.props.onClick(); await flush();
    expect(dialog(render())?.props['data-receipt-decision']).toBe('r3');
  });

  it('a stage name in "By stage" opens that stage on Work', async () => {
    let view = await money();
    view = await press(view, '4 · Stage name 4');
    expect(activeTab(view)).toBe('work');
    expect(detailTitle(view)).toBe('Stage name 4');
  });
});
