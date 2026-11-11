import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRow } from '@/types/project';

const h = vi.hoisted(() => ({ index: 0, state: [] as unknown[],
  confirm: vi.fn(), estimate: vi.fn(), extract: vi.fn(), upload: vi.fn(), started: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => {
    const at = h.index++;
    if (!(at in h.state)) h.state[at] = typeof initial === 'function' ? initial() : initial;
    return [h.state[at], (value: unknown) => {
      h.state[at] = typeof value === 'function' ? value(h.state[at]) : value;
    }];
  },
}));
vi.mock('framer-motion', () => ({ motion: { div: 'div' } }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/lib/budget/project-money-context', () => ({ useMoney: () => String }));
vi.mock('@/lib/budget/use-project-money', () => ({ useProjectMoney: () => ({ code: 'XAF', rate: 600 }) }));
vi.mock('@/lib/budget/live-fx', () => ({ useUsdRate: (_code: unknown, fallback: number | null) => fallback }));
vi.mock('@/lib/supabase/tracking', () => ({ confirmBoqBudget: h.confirm, startProjectTracking: h.estimate }));
vi.mock('@/lib/budget/extract-bq', () => ({ extractBqTotal: h.extract }));
vi.mock('@/lib/supabase/documents', () => ({ uploadDocument: h.upload }));

import StartTrackingGate from '@/components/project/StartTrackingGate';

type Element = { type: unknown; props: Record<string, any> };
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Element;
  return [node, ...nodes(node.props.children)];
}
const project = { id: 'same-project', country: 'CM', budget_source: 'boq',
  budget_amount: 1414073374.524, budget_currency: 'XAF', budget_fx_rate: 600,
  budget_usd: 2356788.95754, budget_precision: 3, joined_at_stage: 4,
  sqm: 100, num_floors: 5 } as ProjectRow;
function render() {
  h.index = 0;
  return nodes(StartTrackingGate({ project, userId: 'client', onStarted: h.started }));
}
function confirm(elements: Element[]) {
  return elements.find(e => e.type === 'button' && e.props.onClick?.name === 'handleConfirm')!.props.onClick();
}
beforeEach(() => { h.index = 0; h.state = []; vi.clearAllMocks(); });

describe('resuming a project whose budget confirmation was interrupted', () => {
  it('retains the full native bill and selected starting stage, and uses the BoQ RPC', async () => {
    const elements = render();
    expect(elements.find(e => e.props.id === 'final-budget')?.props.value).toBe('1414073374.524');
    await confirm(elements);
    expect(h.confirm).toHaveBeenCalledWith('same-project', expect.objectContaining({
      amount: '1414073374.524', currencyCode: 'XAF', fxRate: 600,
    }), 4);
    expect(h.estimate).not.toHaveBeenCalled();
    expect(h.started).toHaveBeenCalledOnce();
  });

  it('reads a replacement bill and converts its own currency instead of the country rate', async () => {
    h.extract.mockResolvedValue({ reading: { total: 10000.125, sourceAmount: '10000.125',
      currencyCode: 'USD', confidence: 'grand', label: 'GRAND TOTAL' } });
    const elements = render();
    const picker = elements.find(e => e.type === 'input' && e.props.type === 'file')!;
    await picker.props.onChange({ target: { files: [new File(['bill'], 'replacement.csv')] } });
    expect(h.upload).toHaveBeenCalledWith('same-project', 'client', expect.any(File), undefined, 'boq');
    await confirm(render());
    expect(h.confirm).toHaveBeenCalledWith('same-project', expect.objectContaining({
      amount: '10000.125', currencyCode: 'USD', fxRate: 1,
    }), 4);
    expect(h.estimate).not.toHaveBeenCalled();
  });
});
