import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('./client', () => ({ supabase: {} }));
const { partWorkReady } = await import('./substage-payments');
const { stageStartsWithEvidence } = await import('@/lib/projects/stage-progression');

const part = (id: string, work_ready: boolean) => ({ id, number: 1, name: id, key: null, status: 'pending', price: '1', covered: '0', remaining: '1', pending: '0', paid: work_ready, payable: false, work_ready });
const context = { stage_id: 's', split: true, currency: 'XAF', parts: [part('a', true), part('b', false)], next_payable: null };

describe('work on a stage paid by part', () => {
  it('only the covered part takes work', () => {
    expect(partWorkReady(context, true, 'a')).toBe(true);
    expect(partWorkReady(context, true, 'b')).toBe(false);
  });
  it('nothing is assumed paid before the parts have been read', () => {
    expect(partWorkReady(null, true, 'a')).toBe(false);
  });
  it('a stage that is not split is never held back by parts', () => {
    expect(partWorkReady(null, false, 'anything')).toBe(true);
  });
});

describe('who pays first', () => {
  const stage = (paid_by_part: boolean) => ({ id: 's', pre_existing: false, paid_by_part }) as never;
  it('a contractor-created stage still starts with evidence when it is paid as one', () => {
    expect(stageStartsWithEvidence(stage(false), [], 'contractor')).toBe(true);
  });
  it('a stage paid by part is paid ahead, whoever created the project', () => {
    expect(stageStartsWithEvidence(stage(true), [], 'contractor')).toBe(false);
    expect(stageStartsWithEvidence(stage(true), [], 'client')).toBe(false);
  });
});

describe('the payment screen on a stage paid by part', () => {
  const gate = readFileSync(resolve(__dirname, '../../components/project/StagePaymentGate.tsx'), 'utf8');
  it('shows the parts instead of the installment plan', () => {
    expect(gate).toMatch(/\{split && parts\?\.parts \? <section[\s\S]*: <StagePaymentPlanPanel/);
  });
  it('files the receipt under the part being paid', () => {
    expect(gate).toContain('...(split && payingPart ? { substageId: payingPart.id }');
    expect(gate).toContain('&& (!split || !!payingPart);');
  });
});
