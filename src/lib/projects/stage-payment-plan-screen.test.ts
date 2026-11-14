import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StagePaymentPlanContext } from '@/lib/supabase/stage-payment-plans';
import { en } from '@/lib/i18n/en';
import { lookup } from '@/lib/i18n/translate';

const h = vi.hoisted(() => ({
  state: [] as any[], refs: [] as any[], deps: [] as any[], cleanups: [] as any[],
  effects: [] as { index: number; effect: () => any }[], si: 0, ri: 0, ei: 0,
  fetch: vi.fn(), save: vi.fn(), decide: vi.fn(), progress: vi.fn(), changed: vi.fn(), installment: vi.fn(),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = h.si++; if (!(i in h.state)) h.state[i] = typeof initial === 'function' ? initial() : initial;
    return [h.state[i], (value: any) => { h.state[i] = typeof value === 'function' ? value(h.state[i]) : value; }]; },
  useRef: (initial: any) => h.refs[h.ri++] ?? (h.refs[h.ri - 1] = { current: initial }),
  useEffect: (effect: () => any, deps: any[]) => { const i = h.ei++; if (!h.deps[i] || deps.some((v, k) => !Object.is(v, h.deps[i][k]))) {
    h.deps[i] = deps; h.effects.push({ index: i, effect }); } },
}));
vi.mock('@/lib/i18n', () => ({ useLanguage: () => ({ lang: 'en' }), useT: () => (key: string, values: Record<string, unknown> = {}) => {
  const source = lookup(en as never, key) as string;
  return source.replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ''));
} }));
vi.mock('@/lib/supabase/stage-payment-plans', () => ({ fetchStagePaymentPlan: h.fetch, saveStagePaymentPlan: h.save,
  decideStagePaymentPlan: h.decide, authorizeStageProgression: h.progress }));
import { StagePaymentPlanPanel } from '@/components/project/StagePaymentPlanPanel';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

type Node = { type: any; props: Record<string, any> };
function nodes(value: any): Node[] { return Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []; }
function text(value: any): string { return Array.isArray(value) ? value.map(text).join(' ') : value?.props ? text(value.props.children) : typeof value === 'string' ? value : ''; }
const base: StagePaymentPlanContext = { stage_id: 'stage', project_id: 'project', currency: 'XAF', fx_rate: '600',
  stage_amount: '60000', received: '0', pending: '0', remaining: '60000', hash: 'reviewed-version',
  work_authorized: false, progression_authorized: false, can_edit: true, can_decide: false, can_authorize_progression: false,
  plan: null, receipts: [] };
const split: StagePaymentPlanContext = { ...base, can_edit: false, can_decide: true,
  plan: { id: 'plan', mode: 'two_installments', currency: 'XAF', stage_amount: '60000', first_amount: '30000', status: 'proposed', proposed_at: '', decided_at: null } };
const props = { stageId: 'stage', isContractor: false, readOnly: false, canUpload: true, refreshKey: 'payment', onChanged: h.changed, onInstallmentChange: h.installment };
function render(overrides: Partial<typeof props> = {}) {
  h.si = h.ri = h.ei = 0;
  const tree = StagePaymentPlanPanel({ ...props, ...overrides });
  for (const { index, effect } of h.effects.splice(0)) { h.cleanups[index]?.(); h.cleanups[index] = effect(); }
  return nodes(tree);
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
async function load(context = base, overrides: Partial<typeof props> = {}) { h.fetch.mockResolvedValue(structuredClone(context)); render(overrides); await flush(); return render(overrides); }
const button = (view: Node[], label: string) => view.find(node => node.type === 'button' && text(node) === label)!;
const dialog = (view: Node[]) => view.find(node => node.type === ConfirmModal && node.props.open)!;
beforeEach(() => {
  vi.clearAllMocks(); h.state = []; h.refs = []; h.deps = []; h.cleanups = []; h.effects = [];
  vi.stubGlobal('window', new EventTarget()); h.save.mockResolvedValue(split); h.decide.mockResolvedValue({ ...split, can_decide: false });
  h.progress.mockResolvedValue({ ...base, progression_authorized: true }); h.changed.mockResolvedValue(undefined);
});
afterEach(() => { h.cleanups.forEach(cleanup => cleanup?.()); vi.unstubAllGlobals(); });

describe('stage payment plans and separate progression permission', () => {
  it('reviews the full stage and both installment amounts before saving; cancellation writes nothing', async () => {
    let view = await load();
    view.find(node => node.type === 'select')!.props.onChange({ target: { value: 'two_installments' } });
    render().find(node => node.type === 'input')!.props.onChange({ target: { value: '20000' } });
    button(render(), 'Review payment plan').props.onClick();
    expect(h.save).not.toHaveBeenCalled();
    expect(dialog(render()).props.description).toContain('Stage budget: 60,000 XAF. First payment: 20,000 XAF. Second payment: 40,000 XAF');
    dialog(render()).props.onCancel(); expect(h.save).not.toHaveBeenCalled();
    button(render(), 'Review payment plan').props.onClick();
    await dialog(render()).props.onConfirm();
    expect(h.save).toHaveBeenCalledWith(base, 'two_installments', '20000'); expect(h.changed).toHaveBeenCalledOnce();
  });

  it.each(['0', '-1', '60000', '60000.000001'])('rejects a split with invalid first installment %s', async first => {
    const view = await load(); view.find(node => node.type === 'select')!.props.onChange({ target: { value: 'two_installments' } });
    render().find(node => node.type === 'input')!.props.onChange({ target: { value: first } });
    button(render(), 'Review payment plan').props.onClick();
    expect(dialog(render())).toBeUndefined(); expect(h.save).not.toHaveBeenCalled();
    expect(text(render())).toContain('greater than zero and less than the full stage budget');
  });

  it('requires the contractor’s second confirmation and retains the reviewed snapshot after a refresh', async () => {
    const contractor = { isContractor: true };
    await load(split, contractor); button(render(contractor), 'Review and accept plan').props.onClick();
    expect(h.decide).not.toHaveBeenCalled();
    h.fetch.mockResolvedValue({ ...split, stage_amount: '90000', hash: 'new-version' }); window.dispatchEvent(new Event('focus')); await flush();
    h.decide.mockRejectedValueOnce(new Error('payment_plan_stale'));
    await dialog(render(contractor)).props.onConfirm();
    expect(h.decide).toHaveBeenCalledWith(split, true);
    expect(dialog(render(contractor)).props.description).toContain('60,000 XAF');
    expect(text(render(contractor))).toContain('stage price, receipts or plan changed');
  });

  it('keeps money confirmation separate from the explicit progression-with-balance confirmation', async () => {
    const model = { ...split, received: '30000', remaining: '30000', can_decide: false, can_authorize_progression: true,
      plan: { ...split.plan!, status: 'accepted' as const } };
    const contractor = { isContractor: true };
    await load(model, contractor); button(render(contractor), 'Review progression with an outstanding balance').props.onClick();
    expect(h.progress).not.toHaveBeenCalled();
    expect(dialog(render(contractor)).props.description).toContain('Outstanding balance: 30,000 XAF');
    expect(dialog(render(contractor)).props.description).toContain('does not mark the stage fully paid or confirm any pending receipt');
    await dialog(render(contractor)).props.onConfirm(); expect(h.progress).toHaveBeenCalledWith(model);
    expect(h.decide).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled();
  });

  it.each([{ readOnly: true, isContractor: true }, { canUpload: false, isContractor: true }])('offers no mutation controls for restricted project access: %j', async access => {
    const model = { ...split, can_edit: true, can_decide: true, can_authorize_progression: true };
    const view = await load(model, access);
    expect(view.some(node => node.type === 'button' || node.type === 'input' || node.type === 'select')).toBe(false);
    expect(h.save).not.toHaveBeenCalled(); expect(h.progress).not.toHaveBeenCalled();
  });

  it('retains installment 2 across receipt refreshes and focus, then resets for a genuinely new plan', async () => {
    const model = { ...split, can_decide: false, plan: { ...split.plan!, status: 'accepted' as const } };
    await load(model);
    render().find(node => node.type === 'select')!.props.onChange({ target: { value: '2' } });
    h.fetch.mockResolvedValue({ ...model, received: '5000', receipts: [{ id: 'proof', amount: '5000', decision: 'received', allows_work: false, installment: 2, plan_id: 'plan' }] });
    window.dispatchEvent(new Event('focus')); await flush();
    expect(render().find(node => node.type === 'select')!.props.value).toBe(2);
    expect(h.installment).toHaveBeenLastCalledWith(2);
    render({ refreshKey: 'new-payment' }); await flush(); expect(h.installment).toHaveBeenLastCalledWith(2);
    h.fetch.mockResolvedValue({ ...model, plan: { ...model.plan, id: 'new-plan' } });
    window.dispatchEvent(new Event('focus')); await flush();
    expect(render({ refreshKey: 'new-payment' }).find(node => node.type === 'select')!.props.value).toBe(1);
    expect(h.installment).toHaveBeenLastCalledWith(1);
  });

  it('counts several confirmed vendor receipts within each installment and keeps pending proof separate', async () => {
    const receipts = [
      { id: 'one', amount: '20000', decision: 'received', allows_work: true, installment: 1, plan_id: 'plan' },
      { id: 'two', amount: '10000', decision: 'received', allows_work: true, installment: 1, plan_id: 'plan' },
      { id: 'three', amount: '15000', decision: 'pending', allows_work: false, installment: 2, plan_id: 'plan' },
    ];
    const view = await load({ ...split, receipts }, { isContractor: true });
    expect(text(view)).toContain('Confirmed received: 30,000 XAF'); expect(text(view)).toContain('Confirmed received: 0 XAF');
    expect(text(view)).not.toContain('Confirmed received: 15,000 XAF');
  });

  it('discards a completed save after navigation instead of refreshing another project', async () => {
    let finish!: (context: StagePaymentPlanContext) => void;
    await load(); h.save.mockReturnValue(new Promise<StagePaymentPlanContext>(resolve => { finish = resolve; }));
    button(render(), 'Review payment plan').props.onClick(); const saving = dialog(render()).props.onConfirm();
    h.fetch.mockResolvedValue({ ...base, stage_id: 'other-stage', stage_amount: '99999' });
    render({ stageId: 'other-stage' }); await flush(); finish(split); await saving;
    expect(h.changed).not.toHaveBeenCalled(); expect(text(render({ stageId: 'other-stage' }))).not.toContain('30,000 XAF');
  });
});
