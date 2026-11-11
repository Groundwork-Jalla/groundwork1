import { describe, expect, it } from 'vitest';
import type { Payment } from '@/lib/supabase/payments';
import { nextPayment } from './client-view';

describe('historical value is not a payment request', () => {
  const historical = { id: 'built', stage_number: 3, payment_milestone_usd: 2000, pre_existing: true };
  const future = { id: 'future', stage_number: 4, payment_milestone_usd: 8000 };
  const rows = [historical, future].map(stage => ({ id: stage.id, stageId: stage.id,
    direction: 'in', state: 'expected', amount: stage.payment_milestone_usd } as Payment));

  it('skips a stale historical funding row without removing the stage value', () => {
    const next = nextPayment(rows, [historical, future]);
    expect(next?.kind).toBe('due');
    if (next?.kind === 'due') expect(next.stage.id).toBe('future');
    expect(historical.payment_milestone_usd).toBe(2000);
  });

  it('does not ask for funding when every allocated stage predates Groundwork', () => {
    expect(nextPayment(rows, [historical])).toEqual({ kind: 'noMilestones' });
  });
});
