import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { lookup } from '@/lib/i18n/translate';
import { projectMoneyPair } from './project-money';
import type { ProjectMoney } from './use-project-money';
import type { StagePaymentReceipt } from '@/lib/supabase/verifications';
import type { ProjectRow } from '@/types/project';

const h = vi.hoisted(() => ({ lang: 'en', money: null as any }));
vi.mock('@/lib/i18n', () => ({ useLanguage: () => ({ lang: h.lang }), useT: () => (key: string, values: Record<string, unknown> = {}) => {
  const source = lookup((h.lang === 'fr' ? fr : en) as never, key) as string;
  return source.replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ''));
} }));
vi.mock('@/lib/budget/project-money-context', () => ({ useProjectMoneyContext: () => h.money }));
import { ProjectExchangeRateNote, ReceiptExchangeRateNote, UsdQuoteNote } from '@/components/project/ExchangeRateNote';

const receipt = (patch: Partial<StagePaymentReceipt> = {}): StagePaymentReceipt => ({
  id: 'receipt', amount: 2000, currency: 'USD', fxRate: 1, amountUsd: 2000, projectAmount: 1172736.168,
  projectCurrency: 'XAF', projectFxRate: 586.368084, fxSource: 'USD', fxAsOf: '2026-11-13T13:45:41Z', ...patch,
} as StagePaymentReceipt);
beforeEach(() => { h.lang = 'en'; h.money = null; });
describe('saved budget and receipt conversion explanations', () => {
  it('reproduces the reported $2,000 receipt without revaluing its project', () => {
    const project = { country: 'CM', budget_source: 'boq', budget_currency: 'XAF', budget_fx_rate: 586.368084 } as ProjectRow;
    expect(projectMoneyPair(project, 2000, 593.594, 1172736.168)?.local).toBe('1,172,736.168 XAF');
    expect(projectMoneyPair(project, 2000, 625)).toEqual(projectMoneyPair(project, 2000, 593.594));
    const html = renderToStaticMarkup(<ReceiptExchangeRateNote receipt={receipt()}/>);
    expect(html).toContain('586.368084 XAF'); expect(html).toContain('original rate date was not recorded');
    expect(html).toContain('Receipt conversion recorded 13 Nov 2026'); expect(html).not.toContain('Market quote');
  });
  it('shows both conversion legs and the actual provider date for a foreign receipt', () => {
    const html = renderToStaticMarkup(<ReceiptExchangeRateNote receipt={receipt({ currency: 'EUR', fxRate: 0.8,
      fxSource: 'ExchangeRate-API', fxAsOf: '2026-11-13T00:00:00Z', projectFxRecordedAt: '2026-11-11T12:53:42Z' })}/>);
    expect(html).toContain('0.8 EUR'); expect(html).toContain('586.368084 XAF');
    expect(html).toContain('Market quote as of 13 Nov 2026'); expect(html).toContain('saved 11 Nov 2026');
    expect(html).toContain('href="https://www.exchangerate-api.com"');
  });
  it('does not describe a same-currency receipt as a fresh market conversion', () => {
    const html = renderToStaticMarkup(<ReceiptExchangeRateNote receipt={receipt({ currency: 'XAF', fxRate: 586.368084, fxSource: 'project' })}/>);
    expect(html).toContain('original receipt amount counts directly'); expect(html).not.toContain('Market quote');
  });
  it('does not invent metadata for older receipts', () => {
    expect(renderToStaticMarkup(<ReceiptExchangeRateNote receipt={receipt({ fxSource: null, fxRate: null })}/>)).toContain('no recorded conversion details');
  });
  it('identifies saved versus configured budget rates in both project views', () => {
    h.money = { code: 'XAF', rate: 586.368084, budgetRate: 586.368084, rateSource: 'saved_budget' };
    const client = renderToStaticMarkup(<ProjectExchangeRateNote/>);
    expect(client).toEqual(renderToStaticMarkup(<ProjectExchangeRateNote money={h.money}/>));
    expect(client).toContain('Source: saved project budget'); expect(client).not.toContain('Today');
    expect(renderToStaticMarkup(<ProjectExchangeRateNote money={{ ...h.money, rateSource: 'configured_budget' } as ProjectMoney}/>)).toContain('Groundwork country estimate');
  });
  it('labels fallback quotes and supplies provider attribution for current quotes', () => {
    const quote = { code: 'XAF', rate: 593.594, source: 'ExchangeRate-API' as const, asOf: '2026-11-13T00:00:00Z' };
    expect(renderToStaticMarkup(<UsdQuoteNote quote={quote}/>)).toContain('Market quote as of 13 Nov 2026');
    expect(renderToStaticMarkup(<UsdQuoteNote quote={{ ...quote, source: 'configured', asOf: null }}/>)).toContain('market quote currently unavailable');
  });
  it('renders conversion explanations in French without missing translation keys', () => {
    h.lang = 'fr'; const html = renderToStaticMarkup(<ReceiptExchangeRateNote receipt={receipt()}/>);
    expect(html).toContain('Conversion du budget'); expect(html).not.toContain('project.fx.');
  });
});
