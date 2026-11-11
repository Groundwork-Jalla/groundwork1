import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractBqTotal } from './extract-bq';
import { allocateBill, billTotalSuggestion, confirmedBillAmount, normaliseBudgetInput, sumBillAmounts } from './bill-budget';
import { planSeed } from '@/lib/projects/plan-answer';
import { readWizardDraft, writeWizardDraft } from '@/lib/projects/wizard-draft';
import { WIZARD_DEFAULT_DATA } from '@/types/project';

afterEach(() => vi.unstubAllGlobals());

describe('the supplied BoQ through project confirmation', () => {
  it('retains the final source total, currency and decimals after a draft reload, and allocates it exactly', async () => {
    const name = '1793973807289_Devis_R4_Penthouse_Simplifie_Corrige.xlsx';
    const file = new File([readFileSync(resolve(__dirname, '../../../docs/testcases', name))], name);
    const out = await extractBqTotal(file);
    expect(out.reading?.total).toBe(1414073374.524);
    expect(out.reading?.source).toMatchObject({ sheet: '2-Devis', cell: 'E65' });
    const seed = planSeed({ hasPlan: true, bq: file, floorPlans: [], floorPlanFacts: [],
      lineItems: out.lineItems, reading: out.reading, bqStatedFloors: out.statedFloors },
    { localCurrencyCode: 'XAF', approxFxRate: 600 });
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    writeWizardDraft('bill-project', { version: 1, step: 8, direction: 'forward',
      data: { ...WIZARD_DEFAULT_DATA, ...seed }, planDocumentsAttached: true });
    const restored = readWizardDraft('bill-project')!;
    expect(restored.data.boqBudget).toMatchObject({ amount: '1414073374.524', currencyCode: 'XAF', fileName: name });
    expect(billTotalSuggestion(restored.data.boqBudget, null)).toBe(1414073374.524);
    const allocations = allocateBill(restored.data.boqBudget!.amount!, [0, 0, 2, 8, 30, 8, 17, 30, 0, 5]
      .map((pct, i) => ({ id: String(i), pct })));
    expect(sumBillAmounts([...allocations.values()].map(Number), 3)).toBe(1414073374.524);
    expect(allocations.get('0')).toBe('0.000');
    expect(allocations.get('2')).toBe('28281467.491');
  });

  it('leaves an unreadable bill or largest-number guess for explicit manual entry', () => {
    const bill = { amount: null, currencyCode: 'XAF', sourceLabel: null, fileName: 'bill.pdf' };
    expect(billTotalSuggestion(bill, null)).toBeNull();
    expect(billTotalSuggestion(bill, { total: 250000750000, confidence: 'sum', label: 'Gravel' })).toBeNull();
    expect(billTotalSuggestion(bill, { total: 1414073374.524, confidence: 'grand', label: 'TOTAL TTC' })).toBe(1414073374.524);
  });

  it.each([
    ['1,414,073,374.524', 'en', '1414073374.524'],
    ['1 414 073 374,524', 'fr', '1414073374.524'],
    ['1.414.073.374,524', 'fr', '1414073374.524'],
    ['1414073374,', 'fr', '1414073374.'],
    ['1,234', 'fr', '1.234'],
    ['1,234', 'en', '1234'],
  ] as const)('accepts source-currency entry %s (%s)', (typed, lang, expected) => {
    expect(normaliseBudgetInput(typed, lang)).toBe(expected);
  });

  it.each(['', '0', '-1', '100.1.2', 'Infinity', '1000000000001', '1.1234567'])('rejects invalid confirmation %s', amount => {
    expect(confirmedBillAmount(amount)).toBeNull();
  });
});
