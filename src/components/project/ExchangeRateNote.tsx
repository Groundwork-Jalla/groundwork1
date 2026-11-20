import { useLanguage, useT } from '@/lib/i18n';
import { useProjectMoneyContext } from '@/lib/budget/project-money-context';
import type { ProjectMoney } from '@/lib/budget/use-project-money';
import type { UsdQuote } from '@/lib/budget/live-fx';
import type { StagePaymentReceipt } from '@/lib/supabase/verifications';

function rateDate(value: string | null | undefined, lang: string) {
  const stamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(stamp) ? new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  }).format(stamp) + ' UTC' : null;
}
function ProviderLink() {
  return <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer" className="underline">ExchangeRate-API</a>;
}

/** Budget conversions stay fixed; this note never requests a market rate. */
export function ProjectExchangeRateNote({ money, className = 'text-xs text-brand-mid-grey' }: { money?: ProjectMoney; className?: string }) {
  const context = useProjectMoneyContext();
  const currency = money ?? context;
  const t = useT(); const { lang } = useLanguage();
  if (!currency || currency.code === 'USD') return null;
  const rate = currency.budgetRate.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 12 });
  return <p className={className}>
    {t('project.fx.budgetRateFixed', { rate, currency: currency.code })}
  </p>;
}

/** The two saved conversion legs explain a receipt without revaluing it. */
export function ReceiptExchangeRateNote({ receipt }: { receipt: StagePaymentReceipt }) {
  const t = useT(); const { lang } = useLanguage();
  const number = (value: number) => value.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 12 });
  const date = rateDate(receipt.fxAsOf, lang);
  const savedAt = rateDate(receipt.projectFxRecordedAt, lang);
  const market = receipt.fxSource === 'ExchangeRate-API';
  const foreign = receipt.currency !== 'USD' && receipt.currency !== receipt.projectCurrency;
  if (receipt.fxRate == null || receipt.projectFxRate == null || !receipt.fxSource) {
    return <p className="mt-1 text-brand-mid-grey">{t('project.fx.receiptRateUnknown')}</p>;
  }
  return <details className="mt-2 text-brand-mid-grey">
    <summary className="flex min-h-11 cursor-pointer items-center text-xs font-medium underline underline-offset-4">{t('project.fx.details')}</summary>
    <div className="space-y-1 pb-2">
    {foreign && <p>{t('project.fx.receiptRate', { rate: number(receipt.fxRate), currency: receipt.currency ?? '' })}
      {market && <>{' · '}<ProviderLink/>{' · '}{date ? t('project.fx.quoteAsOf', { date }) : t('project.fx.quoteDateUnknown')}</>}
    </p>}
    {receipt.projectCurrency !== 'USD' && <p>{t('project.fx.receiptBudgetRate', { rate: number(receipt.projectFxRate), currency: receipt.projectCurrency ?? '' })}
      {' · '}{savedAt ? t('project.fx.savedAt', { date: savedAt }) : t('project.fx.budgetDateUnknown')}</p>}
    {!market && date && <p>{t('project.fx.receiptSavedAt', { date })}</p>}
    <p>{t(receipt.currency === receipt.projectCurrency ? 'project.fx.sameCurrencyReceipt' : 'project.fx.savedReceiptNote')}</p>
    </div>
  </details>;
}

/** Indicative quotes in the creation wizard retain the provider's own date. */
export function UsdQuoteNote({ quote }: { quote: UsdQuote }) {
  const t = useT(); const { lang } = useLanguage();
  if (!quote.code || quote.code === 'USD' || quote.rate == null) return null;
  const date = rateDate(quote.asOf, lang);
  return <p className="mt-2 text-xs text-brand-mid-grey">
    {t('project.fx.previewRate', { rate: quote.rate.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 12 }), currency: quote.code })}{' · '}
    {quote.source === 'ExchangeRate-API' ? <><ProviderLink/>{' · '}{date ? t('project.fx.quoteAsOf', { date }) : t('project.fx.quoteDateUnknown')}</> : t('project.fx.configuredFallback')}
  </p>;
}
