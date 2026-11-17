import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StagePaymentPlanContext } from '@/lib/supabase/stage-payment-plans';
import { en } from '@/lib/i18n/en';
import { lookup } from '@/lib/i18n/translate';

const h = vi.hoisted(() => ({
  state: [] as any[], refs: [] as any[], deps: [] as any[], cleanups: [] as any[],
  effects: [] as { index: number; effect: () => any }[], si: 0, ri: 0, ei: 0,
  fetch: vi.fn(), save: vi.fn(), decide: vi.fn(), progress: vi.fn(), credit: vi.fn(), changed: vi.fn(), installment: vi.fn(), editing: vi.fn(),
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
  decideStagePaymentPlan: h.decide, authorizeStageProgression: h.progress, confirmStageCredit: h.credit }));
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
const props = { stageId: 'stage', isContractor: false, readOnly: false, canUpload: true, refreshKey: 'payment', onChanged: h.changed, onInstallmentChange: h.installment, onEditingChange: h.editing, clientPresentation: false };
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
  const openSplit = async (context = base, overrides: Partial<typeof props> = {}) => {
    await load(context, overrides);
    button(render(overrides), 'Pay in two installments instead').props.onClick();
    return render(overrides);
  };
  const input = (view: Node[]) => view.find(node => node.type === 'input')!;

  it('assumes full payment when no plan exists, with no plan fields and the split one link away', async () => {
    const view = await load();
    expect(text(view)).toContain('Full stage payment. You can attach several vendor receipts.');
    expect(view.some(node => node.type === 'input' || node.type === 'select')).toBe(false);
    expect(button(view, 'Pay in two installments instead')).toBeTruthy();
    expect(h.installment).toHaveBeenLastCalledWith(undefined);
  });

  it('opens the split on its own, asks the receipt form to step aside, and puts everything back on cancel', async () => {
    const view = await openSplit();
    expect(input(view)).toBeTruthy();
    expect(h.editing).toHaveBeenLastCalledWith(true);
    expect(text(view)).not.toContain('This receipt is for');
    button(render(), 'Cancel').props.onClick();
    expect(render().some(node => node.type === 'input')).toBe(false);
    expect(h.editing).toHaveBeenLastCalledWith(false);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('asks for an amount only: no percentage buttons and no percentage arithmetic (17 Nov stand-up)', async () => {
    await openSplit();
    input(render()).props.onChange({ target: { value: '20000' } });
    const view = render();
    expect(view.some(node => node.type === 'button' && /%/.test(text(node)))).toBe(false);
    expect(text(view)).not.toMatch(/%/);
    expect(text(view)).toContain('Second installment: 40,000 XAF');
  });

  it('reviews the full stage and both installment amounts before saving; cancellation writes nothing', async () => {
    await openSplit();
    input(render()).props.onChange({ target: { value: '20000' } });
    button(render(), 'Review payment plan').props.onClick();
    expect(h.save).not.toHaveBeenCalled();
    expect(dialog(render()).props.description).toContain('Stage budget: 60,000 XAF. First payment: 20,000 XAF. Second payment: 40,000 XAF');
    dialog(render()).props.onCancel(); expect(h.save).not.toHaveBeenCalled();
    button(render(), 'Review payment plan').props.onClick();
    await dialog(render()).props.onConfirm();
    expect(h.save).toHaveBeenCalledWith(base, 'two_installments', '20000'); expect(h.changed).toHaveBeenCalledOnce();
    expect(h.editing).toHaveBeenLastCalledWith(false);
  });

  it.each(['0', '-1', '60000', '60000.000001', ''])('rejects a split with invalid first installment %j', async first => {
    await openSplit();
    input(render()).props.onChange({ target: { value: first } });
    button(render(), 'Review payment plan').props.onClick();
    expect(dialog(render())).toBeUndefined(); expect(h.save).not.toHaveBeenCalled();
    expect(text(render())).toContain('greater than zero and less than the full stage budget');
  });

  it('shows a split as one line per installment, which the client can change or turn back into full payment', async () => {
    const proposed = { ...split, can_edit: true, can_decide: false };
    const view = await load(proposed);
    expect(text(view)).toContain('Installment 1 of 2: 30,000 XAF');
    expect(text(view)).toContain('Installment 2 of 2: 30,000 XAF');
    expect(view.some(node => node.type === 'input')).toBe(false);
    button(view, 'Change the payment plan').props.onClick();
    expect(input(render()).props.value).toBe('30000');
    button(render(), 'Pay in full instead').props.onClick();
    expect(dialog(render()).props.description).toContain('Stage budget: 60,000 XAF, paid in full.');
    await dialog(render()).props.onConfirm();
    expect(h.save).toHaveBeenCalledWith(proposed, 'full', null);
  });

  it('offers to revise a plan the contractor sent back', async () => {
    const view = await load({ ...split, can_edit: true, can_decide: false, plan: { ...split.plan!, status: 'declined' as const } });
    expect(text(view)).toContain('The contractor requested a revised payment plan.');
    expect(button(view, 'Revise the payment plan')).toBeTruthy();
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

  it('files the next receipt under the installment it most likely belongs to, and says so', async () => {
    const accepted = { ...split, can_decide: false, plan: { ...split.plan!, status: 'accepted' as const } };
    const view = await load(accepted);
    expect(text(view)).toContain('This receipt is for installment 1.');
    expect(h.installment).toHaveBeenLastCalledWith(1);
    // Receipts already filed (confirmed or still waiting) cover the first installment.
    h.fetch.mockResolvedValue({ ...accepted, receipts: [
      { id: 'a', amount: '20000', decision: 'received', allows_work: true, installment: 1, plan_id: 'plan' },
      { id: 'b', amount: '10000', decision: 'pending', allows_work: false, installment: 1, plan_id: 'plan' },
    ] });
    window.dispatchEvent(new Event('focus')); await flush();
    expect(text(render())).toContain('This receipt is for installment 2.');
    expect(h.installment).toHaveBeenLastCalledWith(2);
  });

  it('keeps a hand-picked installment across refreshes, and lets it go for a genuinely new plan', async () => {
    const accepted = { ...split, can_decide: false, plan: { ...split.plan!, status: 'accepted' as const } };
    await load(accepted);
    expect(render().some(node => node.type === 'select')).toBe(false);
    button(render(), 'Change').props.onClick();
    render().find(node => node.type === 'select')!.props.onChange({ target: { value: '2' } });
    expect(h.installment).toHaveBeenLastCalledWith(2);
    expect(text(render())).toContain('This receipt is for installment 2.');
    window.dispatchEvent(new Event('focus')); await flush();
    expect(h.installment).toHaveBeenLastCalledWith(2);
    h.fetch.mockResolvedValue({ ...accepted, plan: { ...accepted.plan, id: 'new-plan' } });
    window.dispatchEvent(new Event('focus')); await flush();
    expect(h.installment).toHaveBeenLastCalledWith(1);
  });

  it('asks nothing about installments while a plan is sent back, or for a contractor', async () => {
    await load({ ...split, can_decide: false, plan: { ...split.plan!, status: 'declined' as const } });
    expect(text(render())).not.toContain('This receipt is for');
    expect(h.installment).toHaveBeenLastCalledWith(undefined);
    h.state = []; h.refs = []; h.deps = []; h.effects = [];
    const contractor = await load({ ...split, can_decide: false, plan: { ...split.plan!, status: 'accepted' as const } }, { isContractor: true });
    expect(text(contractor)).not.toContain('This receipt is for');
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
    await openSplit(); h.save.mockReturnValue(new Promise<StagePaymentPlanContext>(resolve => { finish = resolve; }));
    input(render()).props.onChange({ target: { value: '30000' } });
    button(render(), 'Review payment plan').props.onClick(); const saving = dialog(render()).props.onConfirm();
    h.fetch.mockResolvedValue({ ...base, stage_id: 'other-stage', stage_amount: '99999' });
    render({ stageId: 'other-stage' }); await flush(); finish(split); await saving;
    expect(h.changed).not.toHaveBeenCalled(); expect(text(render({ stageId: 'other-stage' }))).not.toContain('30,000 XAF');
  });
});

describe('money paid above one stage is shown where it was carried to', () => {
  // Stage 4 of a project whose stage 3 was overpaid by 12,000 XAF and confirmed.
  const carried: StagePaymentPlanContext = { ...base, can_edit: false, received: '12000', remaining: '48000',
    own_received: '0', carried_in: '12000', carried_out: '0', unused_credit: '0', can_confirm_credit: true };

  it('shows nothing extra on a stage with no carried money, exactly as before', async () => {
    const view = text(await load(base));
    expect(view).not.toContain('carried');
    expect(view).not.toContain('held as credit');
  });

  it('tells the client how much was carried in and what is still to pay, without offering the contractor decision', async () => {
    const view = await load(carried);
    expect(text(view)).toContain('12,000 XAF carried forward from your other stage payments counts toward this stage. Still to pay: 48,000 XAF.');
    expect(view.some(node => node.type === 'button' && text(node) === 'Review the carried payment for this stage')).toBe(false);
  });

  it('lets the primary contractor accept carried money behind a confirmation that states every figure', async () => {
    h.credit.mockResolvedValue({ ...carried, can_confirm_credit: false, work_authorized: true });
    await load(carried, { isContractor: true });
    button(render({ isContractor: true }), 'Review the carried payment for this stage').props.onClick();
    expect(h.credit).not.toHaveBeenCalled();
    const description = dialog(render({ isContractor: true })).props.description;
    expect(description).toContain('Stage budget: 60,000 XAF. Carried forward from earlier payments: 12,000 XAF. Still to pay: 48,000 XAF.');
    expect(description).toContain('moving past this stage with a balance remains a separate decision');
    await dialog(render({ isContractor: true })).props.onConfirm();
    expect(h.credit).toHaveBeenCalledWith(carried);
    expect(h.changed).toHaveBeenCalledTimes(1);
    expect(render({ isContractor: true }).some(node => node.type === 'button' && text(node) === 'Review the carried payment for this stage')).toBe(false);
  });

  it('does not offer the decision when the database does not, or on a read-only project', async () => {
    const view = await load({ ...carried, can_confirm_credit: false }, { isContractor: true });
    expect(view.some(node => node.type === 'button' && text(node) === 'Review the carried payment for this stage')).toBe(false);
    h.state = []; h.refs = []; h.deps = []; h.effects = [];
    const locked = await load(carried, { isContractor: true, readOnly: true });
    expect(locked.some(node => node.type === 'button' && text(node) === 'Review the carried payment for this stage')).toBe(false);
  });

  it('says where an overpaid stage\u2019s excess went, and what is still held', async () => {
    const view = text(await load({ ...base, can_edit: false, received: '90000', remaining: '0', own_received: '90000', carried_in: '0', carried_out: '18000', unused_credit: '12000' }));
    expect(view).toContain('18,000 XAF paid above this stage\u2019s price was carried to another stage.');
    expect(view).toContain('12,000 XAF paid above this stage\u2019s price is held as credit.');
  });
});

