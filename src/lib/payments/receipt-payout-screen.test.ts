import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRow, ProjectStageRow } from '@/types/project';
import type { StagePayment } from '@/lib/supabase/verifications';

const h = vi.hoisted(() => ({
  index: 0, refIndex: 0, state: [] as unknown[], refs: [] as { current: unknown }[],
  effects: [] as (() => void | (() => void))[], fetch: vi.fn(), remove: vi.fn(),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = h.index++;
    if (!(index in h.state)) h.state[index] = typeof initial === 'function' ? initial() : initial;
    return [h.state[index], (value: unknown) => { h.state[index] = typeof value === 'function' ? value(h.state[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = h.refIndex++;
    return h.refs[index] ?? (h.refs[index] = { current: initial });
  },
  useEffect: (effect: () => void | (() => void)) => { h.effects.push(effect); },
}));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/lib/supabase/verifications', () => ({ fetchStagePaymentsStrict: h.fetch }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: h.remove,
} }));

import { ProjectPayoutSummary } from '@/components/project/ProjectPayoutSummary';

const project = { id: 'project', country: 'CM', budget_source: 'boq', budget_amount: 100,
  budget_usd: 100, budget_currency: 'USD', budget_fx_rate: 1, budget_precision: 3 } as ProjectRow;
const stages = [{ id: 'stage', stage_number: 1, status: 'active', payment_milestone_usd: 100,
  milestone_amount: 100, budget_pct: 100 }] as ProjectStageRow[];
const receipt: StagePayment = { id: 'payment', stageId: 'stage', state: 'funded', amount: 100,
  receiptPath: 'receipt.pdf', receiptUploadedAt: '2026-11-12T00:00:00Z', receiptAmount: 80.125,
  receiptCurrency: 'USD', receiptFxRate: 1, receiptAmountUsd: 80.125 };

function render(source = project) {
  h.index = 0; h.refIndex = 0; h.effects = [];
  return renderToStaticMarkup(ProjectPayoutSummary({ project: source, stages }));
}
async function load() {
  render();
  const cleanup = h.effects[0]();
  await Promise.resolve(); await Promise.resolve();
  return cleanup;
}
beforeEach(() => {
  vi.clearAllMocks(); h.index = 0; h.refIndex = 0; h.state = []; h.refs = []; h.effects = [];
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe('actual payout figures on both project views', () => {
  it('shows the confirmed receipt amount and remaining budget instead of the stage cost', async () => {
    h.fetch.mockResolvedValue(new Map([['stage', receipt]]));
    await load();
    const html = render();
    expect(html).toContain('$80.125');
    expect(html).toContain('$19.875');
    expect(html).toContain('project.costing.payouts');
  });

  it('shows a real zero when the ledger was successfully read and has no payments', async () => {
    h.fetch.mockResolvedValue(new Map());
    await load();
    expect(render()).toContain('$0');
  });

  it('shows an error and retry, without claiming zero payments, when the ledger read fails', async () => {
    h.fetch.mockRejectedValue(new Error('ledger unavailable'));
    await load();
    const html = render();
    expect(html).toContain('project.costing.payoutsLoadFailed');
    expect(html).toContain('project.costing.retryPayouts');
    expect(html).not.toContain('$0');
    expect(html).not.toContain('$100');
  });

  it('flags missing legacy amounts rather than presenting the scheduled amount as a payout', async () => {
    h.fetch.mockResolvedValue(new Map([['stage', { ...receipt, receiptAmount: null,
      receiptCurrency: null, receiptFxRate: null, receiptAmountUsd: null }]]));
    await load();
    const html = render();
    expect(html).toContain('project.costing.receiptAmountsMissing');
    expect(html).not.toContain('$80.125');
    expect(html).not.toContain('$19.875');
  });

  it('does not expose the previous project’s money while loading another project', async () => {
    h.fetch.mockResolvedValue(new Map([['stage', receipt]]));
    await load();
    expect(render()).toContain('$80.125');
    expect(render({ ...project, id: 'different-project' })).not.toContain('$80.125');
  });

  it('shows an explicit budget overrun when a confirmed negotiated payment exceeds the budget', async () => {
    h.fetch.mockResolvedValue(new Map([['stage', { ...receipt, receiptAmount: 120, receiptAmountUsd: 120 }]]));
    await load();
    expect(render()).toContain('project.costing.overBudget');
  });

  it('ignores a read that resolves after this project view was closed', async () => {
    let finish!: (value: Map<string, StagePayment>) => void;
    h.fetch.mockReturnValue(new Promise<Map<string, StagePayment>>(resolve => { finish = resolve; }));
    const cleanup = await load();
    if (typeof cleanup === 'function') cleanup();
    finish(new Map([['stage', receipt]]));
    await Promise.resolve(); await Promise.resolve();
    expect(render()).not.toContain('$80.125');
  });
});
