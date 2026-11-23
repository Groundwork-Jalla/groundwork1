import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('./client', () => ({ supabase: {} }));
const { breakdownDraft, splitBreakdownEvenly } = await import('./stage-breakdown');

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

  it('splits an integer XAF stage amount evenly across 8 substages with zero remainder', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ substageId: `s${i + 1}`, name: `Sub ${i + 1}`, amount: '' }));
    const split = splitBreakdownEvenly('30042309', rows);
    const check = breakdownDraft('30042309', split);
    expect(check.ready).toBe(true);
    expect(check.remaining).toBe('0');
    expect(split[0].amount).toBe('3755288');
    expect(split[7].amount).toBe('3755293');
  });

  it('splits a 2-decimal USD stage amount evenly with zero floating-point drift', () => {
    const rows = [
      { substageId: 'a', name: 'A', amount: '' },
      { substageId: 'b', name: 'B', amount: '' },
      { substageId: 'c', name: 'C', amount: '' },
    ];
    const split = splitBreakdownEvenly('100.25', rows);
    const check = breakdownDraft('100.25', split);
    expect(check.ready).toBe(true);
    expect(check.remaining).toBe('0');
    expect(split.map(r => r.amount)).toEqual(['33.41', '33.41', '33.43']);
  });
});

describe('strict role separation on inline substage pricing', () => {
  const panel = readFileSync(resolve(__dirname, '../../components/project/StageBreakdownPanel.tsx'), 'utf8');
  const tracker = readFileSync(resolve(__dirname, '../../components/project/StageTracker.tsx'), 'utf8');

  it('keeps editing, split-evenly, and withdraw strictly contractor-only', () => {
    expect(panel).toContain('const editing = isContractor && draft?.stage === stageId ? draft : null;');
    expect(panel).toContain('canPropose: isContractor && context.can_propose,');
    expect(panel).toContain('canDecide: !isContractor && context.can_decide,');
    expect(panel).toContain('{isContractor && pending.can_withdraw &&');
    expect(panel).toContain('{!isContractor && context.can_decide && <>');
  });

  it('never renders contractor price inputs or add-substage buttons inside Homeowner StageTracker', () => {
    expect(tracker).not.toContain('data-action="add-substage"');
    expect(tracker).not.toContain('data-action="split-stage"');
    expect(tracker).not.toContain('data-inline-substage-price');
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
  it('on the contractor\'s own stage view too, since each part must be priced before it is paid (18 Nov)', () => {
    const work = readFileSync(resolve(__dirname, '../../app/routes/work/projects.detail.tsx'), 'utf8');
    expect(work).toContain("import { StageBreakdownPanel } from '@/components/project/StageBreakdownPanel';");
    expect(work).toContain("const priceable = !stage.pre_existing && stage.status !== 'complete' && stagePayableUsd(stage, basis) > 0;");
    // The redesigned Work tab shows one stage at a time, so the panel sits in that
    // stage's detail, open or upcoming; there is no per-row toggle any more.
    expect(work).toMatch(/const breakdown = priceable\s*\?\s*<div[\s\S]{0,200}<StageBreakdownPanel/);
    expect(work.match(/\{breakdown\}/g)).toHaveLength(1);
  });
});
