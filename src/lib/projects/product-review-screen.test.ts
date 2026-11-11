import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRow, ProjectStageRow } from '@/types/project';
import type { StagePayment } from '@/lib/supabase/verifications';
import { projectMoneyPair } from '@/lib/budget/project-money';

const h = vi.hoisted(() => ({ project: {} as ProjectRow, data: {} as any, update: vi.fn() }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/lib/stage-labels', () => ({ useStageLabels: () => ({ stageLabel: (stage: ProjectStageRow) => stage.name }) }));
vi.mock('@/lib/domain-labels', () => ({ useDomainLabels: () => ({ projectType: (value: string) => value, buildingType: (value: string) => value }) }));
vi.mock('@/lib/budget/project-money-context', () => ({
  useMoney: () => (usd: number, amount?: number) => projectMoneyPair(h.project, usd, undefined, amount)?.local,
  useProjectMoneyContext: () => ({ pair: (usd: number, amount?: number) => projectMoneyPair(h.project, usd, undefined, amount) }),
}));
vi.mock('@/contexts/WizardContext', () => ({ useWizard: () => ({ data: h.data, update: h.update }) }));
import BudgetView from '@/components/project/BudgetView';
import { StageSchedule } from '@/components/project/StageSchedule';
import { BuildingTypeField } from '@/components/wizard/BuildingTypeField';
import { useResources } from '@/lib/resources-labels';
import { RESOURCE_META } from '@/lib/resources-data';

beforeEach(() => {
  vi.clearAllMocks();
  h.project = { id: 'project', country: 'CM', budget_source: 'boq', budget_amount: 1000.125,
    budget_currency: 'XAF', budget_fx_rate: 5, budget_precision: 3, budget_usd: 200.025 } as ProjectRow;
  h.data = { projectType: 'residential', buildingType: 'single_family', boqBudget: { amount: '141407337.524',
    currency: 'XAF', fxRate: 600, confirmed: true }, sqm: 200, numFloors: 2 };
  h.update.mockImplementation(patch => { h.data = { ...h.data, ...patch }; });
});
const stage = (id: string, number: number, patch: Partial<ProjectStageRow> = {}): ProjectStageRow => ({
  id, project_id: 'project', name: id, stage_number: number, status: 'locked', budget_pct: 10,
  payment_milestone_usd: 20, milestone_amount: 100, ...patch,
} as ProjectStageRow);
const receipt = (stageId: string, state: StagePayment['state'], actual?: number): StagePayment => ({
  id: `payment-${stageId}`, stageId, state, amount: 20,
  receiptAmount: actual, receiptCurrency: actual ? 'XAF' : undefined,
  receiptFxRate: actual ? 5 : undefined, receiptAmountUsd: actual ? actual / 5 : undefined,
  receiptPath: actual ? 'project/receipt.pdf' : null, receiptUploadedAt: actual ? '2026-11-12' : null,
});
const schedule = (stages: ProjectStageRow[], payments: StagePayment[]) => renderToStaticMarkup(createElement(StageSchedule, {
  project: h.project, stages, basis: { wholeProject: true, base: h.project.budget_usd }, payments: new Map(payments.map(row => [row.stageId, row])),
}));

describe('the unified stage and payment schedule', () => {
  it('shows the schedule and the actual receipt separately, in native currency and USD', () => {
    const html = schedule([stage('Foundation', 2, { status: 'active' })], [receipt('Foundation', 'funded', 80.125)]);
    expect(html).toContain('100 XAF'); expect(html).toContain('$20');
    expect(html).toContain('80.125 XAF'); expect(html).toContain('$16.03');
    expect(html).toContain('project.review.scheduledAmount');
    expect(html).toContain('project.review.receiptConfirmed');
    expect(html).not.toContain('Released');
  });

  it('retains a historical allocation and zero-weight stage without inventing payments', () => {
    const html = schedule([stage('Free', 2, { budget_pct: 0, milestone_amount: 0, payment_milestone_usd: 0 }),
      stage('Built', 1, { status: 'complete', pre_existing: true, milestone_amount: 300.025, payment_milestone_usd: 60.005 })],
    [receipt('Built', 'funded', 300.025)]);
    expect(html.indexOf('Built')).toBeLessThan(html.indexOf('Free'));
    expect(html).toContain('300.025 XAF'); expect(html).toContain('0 XAF');
    expect(html).toContain('project.costing.completedBeforeTracking');
    expect(html).toContain('project.review.freeStage');
    expect(html).not.toContain('project.review.receiptConfirmed');
  });

  it('does not substitute the planned amount for a missing legacy receipt', () => {
    const html = schedule([stage('Wall', 1)], [receipt('Wall', 'reconciled')]);
    expect(html).toContain('project.costing.receiptAmountsMissing');
    expect(html.match(/100 XAF/g)).toHaveLength(1);
  });

  it('keeps a submitted receipt pending and an unpaid complete stage approved', () => {
    const html = schedule([stage('Roof', 1, { status: 'complete' })], [receipt('Roof', 'receipt_submitted', 60)]);
    expect(html).toContain('project.review.approved');
    expect(html).toContain('project.review.receiptSubmitted');
    expect(html).not.toContain('project.review.receiptConfirmed');
  });
});

describe('the final building classification correction', () => {
  it('can change an extracted house to an office while keeping the confirmed BOQ and dimensions', () => {
    const original = { ...h.data }, budget = h.data.boqBudget;
    const field = BuildingTypeField();
    field.props.onChange({ target: { value: 'office' } });
    expect(h.data).toEqual({ ...original, projectType: 'commercial', buildingType: 'office' });
    expect(h.data.boqBudget).toBe(budget);
    expect(h.data.boqBudget.amount).toBe('141407337.524');
  });
  it('refuses invalid classifications', () => {
    BuildingTypeField().props.onChange({ target: { value: 'unknown' } });
    expect(h.update).not.toHaveBeenCalled();
  });
});

describe('available resources', () => {
  it('hides unpublished videos both from the catalogue and direct slug lookup', () => {
    let resources!: ReturnType<typeof useResources>;
    function Probe() { resources = useResources(); return null; }
    renderToStaticMarkup(createElement(Probe));
    expect(resources.all.length).toBeGreaterThan(0);
    const unpublished = RESOURCE_META.filter(row => row.available === false);
    expect(unpublished.length).toBeGreaterThan(0);
    for (const row of unpublished) expect(resources.bySlug(row.slug)).toBeUndefined();
    expect(resources.all.some(row => row.category === 'videos')).toBe(false);
  });
});


it('labels a confirmed BOQ as the agreed bill total, without estimate or extra-fee wording', () => {
  const html = renderToStaticMarkup(createElement(BudgetView, { project: h.project, stages: [], showMilestoneBuckets: false }));
  expect(html).toContain('1,000.125 XAF');
  expect(html).toContain('project.review.confirmedBillTotal');
  expect(html).toContain('project.review.confirmedBillNote');
  expect(html).not.toContain('project.costing.disclaimer');
  expect(html).not.toContain('project.costing.budgetEstimate');
});


it('does not claim that a receipt is unconfirmed when no payment ledger was supplied', () => {
  const html = renderToStaticMarkup(createElement(StageSchedule, { project: h.project, stages: [stage('Wall', 1)],
    basis: { wholeProject: true, base: h.project.budget_usd } }));
  expect(html).toContain('100 XAF');
  expect(html).not.toContain('project.review.receiptExpected');
  expect(html).not.toContain('project.review.receiptConfirmed');
});
