import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StagePayment } from '@/lib/supabase/verifications';

const h = vi.hoisted(() => ({
  index: 0, hooks: [] as unknown[], lang: 'en' as 'en' | 'fr',
  upload: vi.fn(), confirm: vi.fn(), changed: vi.fn(), sign: vi.fn(), decide: vi.fn(),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useRef: (initial: unknown) => {
    const at = h.index++;
    if (!(at in h.hooks)) h.hooks[at] = { current: initial };
    return h.hooks[at];
  },
  useState: (initial: unknown) => {
    const at = h.index++;
    if (!(at in h.hooks)) h.hooks[at] = typeof initial === 'function' ? initial() : initial;
    return [h.hooks[at], (value: unknown) => {
      h.hooks[at] = typeof value === 'function' ? value(h.hooks[at]) : value;
    }];
  },
}));
vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string, values?: Record<string, unknown>) => key + (values ? JSON.stringify(values) : ''),
  useLanguage: () => ({ lang: h.lang }),
}));
vi.mock('@/lib/budget/project-money-context', () => ({
  useMoney: () => (amount: number) => `${amount * 600} XAF`,
  useProjectMoneyContext: () => ({ code: 'XAF', rate: 600 }),
}));
vi.mock('@/lib/supabase/verifications', () => ({
  uploadStagePaymentReceipt: h.upload, confirmStagePayment: h.confirm, decideStagePaymentReceipt: h.decide, signReceiptUrl: h.sign,
}));

import { StagePaymentGate } from '@/components/project/StagePaymentGate';

type Element = { type: unknown; props: Record<string, any> };
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Element;
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(' ');
  if (value && typeof value === 'object' && 'props' in value) return text((value as Element).props.children);
  return typeof value === 'string' ? value : '';
}
const payment: StagePayment = { id: 'incoming', stageId: 'stage', state: 'expected', amount: 100,
  receiptPath: null, receiptUploadedAt: null };
const receipt = new File(['receipt'], 'proof.png', { type: 'image/png' });
function render(overrides: Partial<Parameters<typeof StagePaymentGate>[0]> = {}) {
  h.index = 0;
  return nodes(StagePaymentGate({ projectId: 'project', stageId: 'stage', stageNumber: 4,
    payment, isContractor: false, onChanged: h.changed, ...overrides }));
}
function chooseFile(elements: Element[]) {
  return elements.find(e => e.type === 'input' && e.props.type === 'file')!.props.onChange({ target: { files: [receipt] } });
}
function enterAmount(elements: Element[], amount: string) {
  elements.find(e => e.props.name === 'receipt-amount')!.props.onChange({ target: { value: amount } });
}
function submit(elements: Element[]) {
  return elements.find(e => e.type === 'form')!.props.onSubmit({ preventDefault() {} });
}
beforeEach(() => {
  h.index = 0; h.hooks = []; h.lang = 'en'; vi.clearAllMocks();
  h.upload.mockResolvedValue(undefined); h.changed.mockResolvedValue(undefined); h.decide.mockResolvedValue(undefined); h.confirm.mockResolvedValue(undefined);
});


describe('the receipt upload and contractor review', () => {
  it('starts blank, offers one upload entry point, then file and camera choices', async () => {
    expect(render().find(e => e.props.name === 'receipt-amount')?.props.value).toBe('');
    await submit(render());
    expect(h.upload).not.toHaveBeenCalled();
    expect(render().some(e => e.props.capture === 'environment')).toBe(true);
    expect(render().filter(e => e.type === 'button' && text(e).includes('receiptChoose'))).toHaveLength(1);
    expect(render().some(e => text(e).includes('project.receiptFlow.pickFile'))).toBe(true);
  });
  it('selecting a file without an amount retains it for later entry', async () => {
    await chooseFile(render());
    expect(h.upload).not.toHaveBeenCalled();
    enterAmount(render(), '12.5'); await submit(render());
    expect(h.upload).toHaveBeenCalledWith('project', 'stage', receipt, { amount: '12.5', currency: 'XAF', fxRate: 600 });
  });
  it.each(['-25', '0', '12.1234567', '1000000000001'])('refuses invalid amount %s before upload', async value => {
    enterAmount(render(), value); await chooseFile(render()); await submit(render());
    expect(h.upload).not.toHaveBeenCalled();
  });
  it('selecting a file after entering the French amount reads and submits it immediately', async () => {
    h.lang = 'fr'; enterAmount(render(), '750,125'); await chooseFile(render());
    expect(h.upload).toHaveBeenCalledWith('project', 'stage', receipt, { amount: '750.125', currency: 'XAF', fxRate: 600 });
    expect(h.changed).toHaveBeenCalledOnce();
  });
  it('retains the amount and file for retry after a mismatch', async () => {
    h.upload.mockRejectedValueOnce({ code: 'receipt_amount_mismatch', amount: '750', currency: 'XAF' });
    enterAmount(render(), '750.125'); await chooseFile(render());
    expect(render().find(e => e.props.name === 'receipt-amount')?.props.value).toBe('750.125');
    expect(render().some(e => e.props.role === 'alert' && text(e).includes('amountMismatch'))).toBe(true);
    await submit(render()); expect(h.upload).toHaveBeenCalledTimes(2);
  });
  it('blocks duplicate submissions while a receipt is in flight', async () => {
    let finish!: () => void; h.upload.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    enterAmount(render(), '750.125'); const pending = chooseFile(render()); await submit(render());
    expect(h.upload).toHaveBeenCalledOnce(); finish(); await pending;
  });
  it('ignores a completed upload after changing projects or stages', async () => {
    let finish!: () => void; h.upload.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    enterAmount(render(), '750.125'); const pending = chooseFile(render());
    expect(render({ stageId: 'other' }).find(e => e.props.name === 'receipt-amount')?.props.value).toBe('');
    finish(); await pending; expect(h.changed).not.toHaveBeenCalled();
  });
  it('keeps payment visible but disabled before approval, and gives observers no mutation controls', async () => {
    expect(render({ canUpload: false }).find(e => e.type === 'fieldset')?.props.disabled).toBe(true);
    await submit(render({ canUpload: false })); expect(h.upload).not.toHaveBeenCalled();
    expect(render({ readOnly: true }).some(e => e.type === 'form')).toBe(false);
  });
  it('allows a client to replace a legacy receipt with no actual amount', () => {
    expect(render({ payment: { ...payment, state: 'receipt_submitted', receiptPath: 'old' } }).some(e => e.type === 'form')).toBe(true);
    expect(render({ isContractor: true, payment: { ...payment, state: 'receipt_submitted', receiptPath: 'old' } }).some(e => e.type === 'button')).toBe(false);
  });
  it('confirms the exact legacy receipt snapshot and refreshes a stale decision', async () => {
    const sent: StagePayment = { ...payment, state: 'receipt_submitted', receiptPath: 'proof', receiptUploadedAt: '2026-11-12T01:00:00.123456+00:00', receiptAmount: 750.125, receiptCurrency: 'XAF', receiptAmountUsd: 1.250208333 };
    h.confirm.mockRejectedValueOnce({ message: 'stale_receipt' });
    const elements = render({ payment: sent, isContractor: true });
    expect(text(elements)).toContain('750.125 XAF'); expect(text(elements).replace(/\s/g, '')).toContain('$1.25');
    await elements.find(e => e.type === 'button' && text(e) === 'project.receiptFlow.accept')!.props.onClick();
    expect(h.confirm).toHaveBeenCalledWith('stage', undefined, { path: 'proof', uploadedAt: sent.receiptUploadedAt });
    expect(h.changed).toHaveBeenCalledOnce();
    expect(text(render({ payment: sent, isContractor: true }))).toContain('project.receiptFlow.refreshReceipt');
  });
  it('reviews immutable receipt IDs and retains confirmed partial payments with a top-up request', async () => {
    const first = { id: 'r1', stageId: 'stage', path: 'one', submittedAt: '', amount: 30, currency: 'XAF', fxRate: 600, amountUsd: 0.05, decision: 'received' as const, allowsWork: false, requestedTopUp: 70, decisionNote: 'More materials', decidedAt: '' };
    const sent: StagePayment = { ...payment, state: 'receipt_submitted', receipts: [first] };
    const elements = render({ payment: sent, isContractor: true });
    expect(text(elements)).toContain('30 XAF'); expect(text(elements)).toContain('topUpRequested');
    await elements.find(e => e.type === 'button' && text(e) === 'project.receiptFlow.continueWithReceived')!.props.onClick();
    expect(h.decide).toHaveBeenCalledWith('r1', 'accept', undefined, undefined);
  });
});
