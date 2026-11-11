import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StagePayment } from '@/lib/supabase/verifications';

const h = vi.hoisted(() => ({
  index: 0, hooks: [] as unknown[], lang: 'en' as 'en' | 'fr',
  upload: vi.fn(), confirm: vi.fn(), changed: vi.fn(), sign: vi.fn(),
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
  uploadStagePaymentReceipt: h.upload, confirmStagePayment: h.confirm, signReceiptUrl: h.sign,
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
  elements.find(e => e.type === 'input' && e.props.type === 'file')!.props.onChange({ target: { files: [receipt] } });
}
function enterAmount(elements: Element[], amount: string) {
  elements.find(e => e.props.name === 'receipt-amount')!.props.onChange({ target: { value: amount } });
}
function submit(elements: Element[]) {
  return elements.find(e => e.type === 'form')!.props.onSubmit({ preventDefault() {} });
}
beforeEach(() => {
  h.index = 0; h.hooks = []; h.lang = 'en'; vi.clearAllMocks();
  h.upload.mockResolvedValue(undefined); h.changed.mockResolvedValue(undefined);
});

describe('the actual amount on a payment receipt', () => {
  it('starts blank instead of turning a scheduled milestone into a claimed payment', () => {
    expect(render().find(e => e.props.name === 'receipt-amount')?.props.value).toBe('');
  });

  it('requires explicit amount and submit; choosing a file alone does not upload', async () => {
    chooseFile(render());
    expect(h.upload).not.toHaveBeenCalled();
    await submit(render());
    expect(h.upload).not.toHaveBeenCalled();
    expect(render().some(e => e.props.role === 'alert')).toBe(true);
  });

  it.each(['-25', '0', '12.1234567', '1000000000001'])('refuses invalid amount %s before upload', async value => {
    enterAmount(render(), value); chooseFile(render()); await submit(render());
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('requires a receipt file as well as an amount', async () => {
    enterAmount(render(), '750.125'); await submit(render());
    expect(h.upload).not.toHaveBeenCalled();
    expect(render().some(e => text(e).includes('receiptFileRequired'))).toBe(true);
  });

  it('submits the French receipt amount and snapshot rather than the scheduled amount', async () => {
    h.lang = 'fr'; enterAmount(render(), '750,125'); chooseFile(render());
    await submit(render());
    expect(h.upload).toHaveBeenCalledWith('project', 'stage', receipt,
      { amount: '750.125', currency: 'XAF', fxRate: 600 });
    expect(h.changed).toHaveBeenCalledOnce();
  });

  it('retains amount and selected receipt after a failed upload for retry', async () => {
    h.upload.mockRejectedValueOnce(new Error('offline'));
    enterAmount(render(), '750.125'); chooseFile(render()); await submit(render());
    expect(render().find(e => e.props.name === 'receipt-amount')?.props.value).toBe('750.125');
    expect(render().some(e => text(e) === 'proof.png')).toBe(true);
    await submit(render()); expect(h.upload).toHaveBeenCalledTimes(2);
  });

  it('blocks duplicate submission while a receipt is in flight', async () => {
    let finish!: () => void;
    h.upload.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    enterAmount(render(), '750.125'); chooseFile(render());
    const form = render(); const first = submit(form); await submit(form);
    expect(h.upload).toHaveBeenCalledOnce(); finish(); await first;
  });

  it('does not apply an old upload result to a newly selected stage', async () => {
    let finish!: () => void;
    h.upload.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    enterAmount(render(), '750.125'); chooseFile(render()); const pending = submit(render());
    const next = render({ stageId: 'next-stage' });
    expect(next.find(e => e.props.name === 'receipt-amount')?.props.value).toBe('');
    finish(); await pending;
    expect(h.changed).not.toHaveBeenCalled();
  });

  it('allows the client to repair a legacy receipt whose amount was never recorded', () => {
    expect(render({ payment: { ...payment, state: 'receipt_submitted', receiptPath: 'old' } })
      .some(e => e.type === 'form')).toBe(true);
  });

  it('does not ask the contractor to confirm an amount that was never recorded', () => {
    expect(render({ isContractor: true, payment: { ...payment, state: 'receipt_submitted', receiptPath: 'old' } })
      .some(e => e.type === 'button')).toBe(false);
  });

  it('shows both parties the actual submitted native amount and its saved USD equivalent', () => {
    const sent: StagePayment = { ...payment, state: 'receipt_submitted', receiptPath: 'proof',
      receiptUploadedAt: '2026-11-12T01:00:00.123456+00:00', receiptAmount: 750.125,
      receiptCurrency: 'XAF', receiptFxRate: 600, receiptAmountUsd: 1.250208333 };
    for (const isContractor of [false, true]) {
      const elements = render({ payment: sent, isContractor });
      expect(elements.some(e => text(e) === '750.125 XAF')).toBe(true);
      expect(elements.some(e => text(e) === '$1.25')).toBe(true);
      expect(elements.some(e => e.type === 'button' && e.props.onClick?.name === 'handleConfirm')).toBe(isContractor);
    }
  });

  it('confirms only the receipt snapshot the contractor actually reviewed', async () => {
    const sent: StagePayment = { ...payment, state: 'receipt_submitted', receiptPath: 'proof',
      receiptUploadedAt: '2026-11-12T01:00:00.123456+00:00', receiptAmount: 750.125, receiptCurrency: 'XAF' };
    const elements = render({ payment: sent, isContractor: true });
    await elements.find(e => e.type === 'button' && e.props.onClick?.name === 'handleConfirm')!.props.onClick();
    expect(h.confirm).toHaveBeenCalledWith('stage', undefined,
      { path: 'proof', uploadedAt: '2026-11-12T01:00:00.123456+00:00' });
  });

  it('refreshes and explains a replaced receipt before asking the contractor to confirm again', async () => {
    h.confirm.mockRejectedValueOnce({ message: 'stale_receipt: changed while open' });
    const sent: StagePayment = { ...payment, state: 'receipt_submitted', receiptPath: 'proof',
      receiptUploadedAt: '2026-11-12T01:00:00.123456+00:00', receiptAmount: 750.125, receiptCurrency: 'XAF' };
    const elements = render({ payment: sent, isContractor: true });
    await elements.find(e => e.type === 'button' && e.props.onClick?.name === 'handleConfirm')!.props.onClick();
    expect(h.changed).toHaveBeenCalledOnce();
    expect(render({ payment: sent, isContractor: true }).some(e => text(e) === 'project.stages.receiptChanged')).toBe(true);
  });
});
