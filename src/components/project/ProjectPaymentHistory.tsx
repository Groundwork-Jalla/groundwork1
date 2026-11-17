import { useRef, useState } from 'react';
import { useLanguage, useT } from '@/lib/i18n';
import { signReceiptUrl, type StagePayment } from '@/lib/supabase/verifications';
import { confirmedInProjectCurrency, paymentHistoryRows, type PaymentHistoryStatus } from '@/lib/payments/payment-history';
import { DocumentViewer } from './DocumentViewer';

const STATUS_KEY = {
  received: 'project.receiptFlow.received', pending: 'project.receiptFlow.pending',
  flagged: 'project.receiptFlow.flagged', replaced: 'project.receiptFlow.replaced',
} as const satisfies Record<PaymentHistoryStatus, string>;

/**
 * The receipts on this project, newest first, with the proof one tap away.
 * Read-only: decisions about a receipt are made on its stage, where its balance is.
 */
export function ProjectPaymentHistory({ stagePayments, stageName, projectCurrency }: {
  stagePayments: Map<string, StagePayment>;
  stageName: (stageId: string) => string;
  projectCurrency: string;
}) {
  const t = useT(); const { lang } = useLanguage();
  const request = useRef(0);
  const [viewer, setViewer] = useState<{ name: string; url: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const rows = paymentHistoryRows(stagePayments);
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US';
  const money = (value: number | null, code: string | null) => value == null ? '\u2014'
    : `${value.toLocaleString(locale, { maximumFractionDigits: 2 })} ${code ?? ''}`.trim();
  const date = (value: string | null) => { const at = value ? new Date(value) : null;
    return at && !Number.isNaN(at.getTime()) ? at.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : '\u2014'; };
  const confirmed = confirmedInProjectCurrency(rows, projectCurrency);

  async function open(path: string) {
    const mine = ++request.current; setFailed(false);
    const name = path.split('/').pop() ?? 'receipt';
    setViewer({ name, url: null });
    const url = await signReceiptUrl(path).catch(() => null);
    if (mine !== request.current) return;
    if (url) setViewer({ name, url }); else { setViewer(null); setFailed(true); }
  }

  return (
    <section aria-labelledby="payment-history-title">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="payment-history-title" className="text-sm font-semibold text-brand-near-black dark:text-white">{t('contractorMoney.paymentHistory')}</h2>
        {rows.length > 0 && <p className="font-mono text-xs text-brand-mid-grey">{t('contractorMoney.paymentHistoryConfirmed', { amount: money(confirmed, projectCurrency) })}</p>}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-brand-mid-grey">{t('contractorMoney.paymentHistoryHelp')}</p>
      {rows.length === 0
        ? <p className="rounded-2xl border border-dashed border-brand-border-grey px-4 py-8 text-center text-xs text-brand-mid-grey">{t('contractorMoney.paymentHistoryEmpty')}</p>
        : <ol className="divide-y divide-brand-border-grey rounded-2xl border border-brand-border-grey bg-white dark:divide-[#2c2c2c] dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            {rows.map(row => (
              <li key={row.id} data-status={row.status} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 px-4 py-3 text-xs">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold tabular-nums text-brand-near-black dark:text-white">{money(row.amount, row.currency)}</p>
                  {row.projectAmount != null && row.projectCurrency && row.projectCurrency !== row.currency
                    && <p className="font-mono text-brand-mid-grey">{t('project.receiptFlow.projectEquivalent', { amount: money(row.projectAmount, row.projectCurrency) })}</p>}
                  <p className="mt-1 text-brand-mid-grey">{stageName(row.stageId)}{row.installment ? ` \u00b7 ${t('project.paymentPlan.installment', { n: row.installment })}` : ''} \u00b7 {date(row.submittedAt)}</p>
                  {row.note && <p className="mt-1 whitespace-pre-wrap text-brand-mid-grey">{row.note}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className={row.status === 'received' ? 'font-semibold text-state-complete' : row.status === 'flagged' ? 'font-semibold text-state-alert' : 'text-brand-mid-grey'}>{t(STATUS_KEY[row.status])}</span>
                  {row.path && <button type="button" onClick={() => void open(row.path!)} className="font-semibold text-brand-green underline">{t('project.stages.confirmView')}</button>}
                </div>
              </li>
            ))}
          </ol>}
      {failed && <p role="alert" className="mt-2 text-xs text-state-alert">{t('project.receiptFlow.openReceipt')}</p>}
      {viewer && <DocumentViewer name={viewer.name} url={viewer.url} loading={!viewer.url} onClose={() => { ++request.current; setViewer(null); }} />}
    </section>
  );
}
