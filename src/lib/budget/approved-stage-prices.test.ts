import { describe, expect, it } from 'vitest';
import { projectBudget } from './index';
import { projectMoneyPair } from './project-money';
import { stageBasisFor, stageScheduleUsd } from './stage-amounts';
import type { ProjectRow, ProjectStageRow } from '@/types/project';
const project = { country:'CM',budget_source:'estimate',pricing_revision:1,budget_usd:340,budget_amount:204000,budget_currency:'XAF',budget_fx_rate:600,budget_precision:3,
  pricing_budget_breakdown:{total:340,construction:320,material:192,labor:128,design:0,permit:0,professional:20,verification:0,contingency:0} } as ProjectRow;
describe('approved project prices use one budget in every view',()=>{
  it('uses approved construction and saved fees instead of recomputing estimator charges',()=>{
    const budget=projectBudget(project);expect(budget.total).toBe(340);expect(budget.professional).toBe(20);
    expect(budget.construction+budget.design+budget.permit+budget.professional+budget.verification+budget.contingency).toBe(budget.total);
    expect(budget.material+budget.labor).toBe(budget.construction);
  });
  it('keeps BOQ fees zero after a client-approved price variation',()=>{
    const budget=projectBudget({...project,budget_source:'boq'});expect(budget.total).toBe(340);expect(budget.construction).toBe(340);
    expect([budget.design,budget.permit,budget.professional,budget.verification,budget.contingency]).toEqual([0,0,0,0,0]);
  });
  it('locks the agreed native total independently of a later live quote',()=>{
    expect(projectMoneyPair(project,340,700)).toMatchObject({local:'204,000 XAF',usd:'$340'});
  });
  it('retains recorded historical prices rather than deriving new values from changed percentages',()=>{
    const stage={pre_existing:true,budget_pct:25,payment_milestone_usd:100} as ProjectStageRow;
    const basis=stageBasisFor(project,[stage],false);expect(stageScheduleUsd(stage,basis)).toBe(100);
  });
});
