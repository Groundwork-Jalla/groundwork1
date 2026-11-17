import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('./client', () => ({ supabase: {} }));
const { breakdownDraft } = await import('./stage-breakdown');

describe('a stage price breakdown adds up exactly', () => {
  it('is ready only when the parts equal the stage price', () => {
    const rows = [{ substageId: 'a', name: 'Walls', amount: '20000' }, { substageId: 'b', name: 'Slab', amount: '30000' }];
    expect(breakdownDraft('60000.000000', rows)).toMatchObject({ allocated: '50000', remaining: '10000', ready: false, lines: null });
    const done = breakdownDraft('60000.000000', [...rows, { name: '  Fence  ', amount: '10000' }]);
    expect(done).toMatchObject({ allocated: '60000', remaining: '0', ready: true });
    expect(done.lines).toEqual([{ substage_id: 'a', amount: '20000' }, { substage_id: 'b', amount: '30000' }, { name: 'Fence', amount: '10000' }]);
  });

  it('reports going over the stage price, never as ready', () => {
    expect(breakdownDraft('100', [{ substageId: 'a', name: 'A', amount: '70' }, { substageId: 'b', name: 'B', amount: '40' }]))
      .toMatchObject({ remaining: '-10', ready: false });
  });

  it('adds decimals without floating-point drift', () => {
    expect(breakdownDraft('0.3', [{ substageId: 'a', name: 'A', amount: '0.1' }, { substageId: 'b', name: 'B', amount: '0.2' }]).ready).toBe(true);
  });

  it('refuses a blank amount, a negative amount, or a new part with no name', () => {
    expect(breakdownDraft('100', [{ substageId: 'a', name: 'A', amount: '' }, { substageId: 'b', name: 'B', amount: '100' }]).ready).toBe(false);
    expect(breakdownDraft('100', [{ substageId: 'a', name: 'A', amount: '-1' }, { substageId: 'b', name: 'B', amount: '101' }]).ready).toBe(false);
    expect(breakdownDraft('100', [{ substageId: 'a', name: 'A', amount: '50' }, { name: ' ', amount: '50' }]).ready).toBe(false);
    expect(breakdownDraft('100', []).ready).toBe(false);
  });
});

describe('where the breakdown appears', () => {
  const tracker = readFileSync(resolve(__dirname, '../../components/project/StageTracker.tsx'), 'utf8');
  it('on priced stages of a project with a primary contractor, never on a stage built before joining', () => {
    expect(tracker).toContain('{!stage.pre_existing && hasPrimaryContractor && (stage.payment_milestone_usd ?? 0) > 0 && <StageBreakdownPanel');
  });
  it('the client confirms approval with the same final words as every other approval', () => {
    const panel = readFileSync(resolve(__dirname, '../../components/project/StageBreakdownPanel.tsx'), 'utf8');
    expect(panel).toContain("review?.kind === 'approved' ? 'project.clientUi.confirmApproval'");
  });
});
