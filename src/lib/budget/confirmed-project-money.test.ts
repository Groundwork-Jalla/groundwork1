import { describe, expect, it } from 'vitest';
import type { ProjectRow, ProjectStageRow } from '@/types/project';
import { projectMoneyPair } from './project-money';
import { stageBasisFor, stageScheduleUsd, stagePayableUsd, sumPayableUsd } from './stage-amounts';
import { allocateBill, billBudget } from './bill-budget';
import { projectBudget } from './index';

const project = {
  country: 'CM', budget_source: 'boq', budget_amount: 1414073374.524,
  budget_currency: 'XAF', budget_fx_rate: 600, budget_precision: 3,
  budget_usd: 2356788.95754, sqm: 200, num_floors: 5,
} as ProjectRow;

describe('one confirmed bill across client and contractor views', () => {
  it('keeps the source total and decimals even when two browsers fetch different live rates', () => {
    const client = projectMoneyPair(project, project.budget_usd, 580);
    const contractor = projectMoneyPair(project, project.budget_usd, 625);
    expect(client).toEqual(contractor);
    expect(client?.local).toBe('1,414,073,374.524 XAF');
  });

  it('keeps legacy estimate displays on the same configured basis as receipt balances', () => {
    const estimate = { ...project, budget_source: 'estimate' as const, budget_amount: null, budget_currency: null, budget_fx_rate: null };
    expect(projectMoneyPair(estimate, 2000, 586)?.local).toBe('1,200,000 XAF');
    expect(projectMoneyPair(estimate, 2000, 586)).toEqual(projectMoneyPair(estimate, 2000, 594));
    expect(projectMoneyPair('CM', 2000, 594)?.local).toBe('1,188,000 XAF');
  });

  it('uses the document currency for a bill priced differently from its build country', () => {
    const usdBill = { ...project, budget_amount: 10000.125, budget_currency: 'USD',
      budget_fx_rate: 1, budget_usd: 10000.125 };
    expect(projectMoneyPair(usdBill, usdBill.budget_usd, 600)?.local).toBe('$10,000.125');
  });

  it('never creates estimator fees inside a confirmed bill', () => {
    const budget = projectBudget(project);
    expect(budget).toEqual(billBudget(project.budget_usd!));
    expect(budget.construction).toBe(budget.total);
    expect(budget.design + budget.professional + budget.verification + budget.permit + budget.contingency).toBe(0);
  });

  it('reads the same saved stage amount even when document loading fails', () => {
    const stage = { budget_pct: 30, payment_milestone_usd: 3000.08 } as ProjectStageRow;
    const basis = stageBasisFor({ ...project, budget_usd: 10000.25 }, [stage], false);
    expect(basis.wholeProject).toBe(true);
    expect(stageScheduleUsd(stage, basis)).toBe(3000.08);
    expect(stagePayableUsd(stage, basis)).toBe(3000.08);
  });

  it('reconciles all ten allocations while completed stages retain their original values', () => {
    const percentages = [0, 0, 2, 8, 30, 8, 17, 30, 0, 5];
    const allocation = allocateBill('1414073374.524', percentages.map((pct, i) => ({ id: String(i), pct })));
    const amounts = [...allocation.values()];
    const sourceUnits = amounts.map(amount => BigInt(amount.replace('.', '')));
    expect(sourceUnits.reduce((a, n) => a + n, 0n)).toBe(1414073374524n);
    expect([amounts[0], amounts[1], amounts[8]]).toEqual(['0.000', '0.000', '0.000']);
    const stages = percentages.map((budget_pct, i) => ({ id: String(i), budget_pct,
      status: i < 4 ? 'complete' : 'locked', pre_existing: i < 4,
      milestone_amount: Number(amounts[i]), payment_milestone_usd: Number(amounts[i]) / 600,
    } as ProjectStageRow));
    const basis = stageBasisFor(project, stages, false);
    expect(stagePayableUsd(stages[2], basis)).toBeGreaterThan(0);
    const full = sumPayableUsd(stages, basis);
    const completed = sumPayableUsd(stages.filter(s => s.status === 'complete'), basis);
    const remaining = sumPayableUsd(stages.filter(s => s.status !== 'complete'), basis);
    expect(full).toBeCloseTo(project.budget_usd!, 8);
    expect(completed + remaining).toBeCloseTo(full, 8);
    expect(projectMoneyPair(project, full)?.local).toBe('1,414,073,374.524 XAF');
  });
});
