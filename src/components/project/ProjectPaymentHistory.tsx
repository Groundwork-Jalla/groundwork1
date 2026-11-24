import { useMemo, useRef, useState } from 'react';
import { useLanguage, useT } from '@/lib/i18n';
import { currencyFractionDigits } from '@/lib/format';
import { substageLabelWith } from '@/lib/stage-labels';
import { signReceiptUrl, type StagePayment } from '@/lib/supabase/verifications';
import { confirmedInProjectCurrency, paymentHistoryRows, paymentOverview,
  type PaymentHistoryStatus, type StagePaymentStanding } from '@/lib/payments/payment-history';
import type { ProjectStageRow, ProjectSubstageRow } from '@/types/project';
import { DocumentViewer } from './DocumentViewer';
import { ReceiptThumb } from './ReceiptThumb';

const STATUS_KEY = {
  received: 'project.receiptFlow.received', pending: 'project.receiptFlow.pending',
  flagged: 'project.receiptFlow.flagged', replaced: 'project.receiptFlow.replaced',
} as const satisfies Record<PaymentHistoryStatus, string>;

const STANDING_KEY = {
  flagged: 'project.receiptFlow.flagged', pending: 'project.historyView.pending',
  paid: 'project.historyView.paid', partial: 'project.historyView.partial', unpaid: 'project.historyView.unpaid',
} as const satisfies Record<StagePaymentStanding, string>;

/** One colour per meaning, from the state tokens, so dark mode follows the theme. */
const TONE: Record<PaymentHistoryStatus, string> = {
  received: 'bg-state-complete/10 text-state-complete',
  pending: 'bg-state-held/10 text-state-held',
  flagged: 'bg-state-alert/10 text-state-alert',
  replaced: 'bg-brand-light-grey text-brand-mid-grey',
};
const DOT: Record<PaymentHistoryStatus, string> = {
  received: 'bg-state-complete', pending: 'bg-state-held', flagged: 'bg-state-alert', replaced: 'bg-brand-muted-grey',
};
const STANDING_TONE: Record<StagePaymentStanding, PaymentHistoryStatus | null> = {
  paid: 'received', partial: 'received', pending: 'pending', flagged: 'flagged', unpaid: null,
};

type Filter = 'all' | 'received' | 'pending' | 'flagged';
const FILTERS: Filter[] = ['all', 'received', 'pending', 'flagged'];

function Pill({ status, label, small = false }: { status: PaymentHistoryStatus; label: string; small?: boolean }) {
  return <span className={`inline-flex items-baseline gap-1.5 rounded-full px-2.5 py-0.5 text-left font-semibold leading-snug ${small ? 'text-[11px]' : 'text-xs'} ${TONE[status]}`}>
    <span aria-hidden className={`h-1.5 w-1.5 shrink-0 translate-y-[-1px] self-center rounded-full ${DOT[status]}`} />{label}
  </span>;
}

/**
 * The receipts on this project, newest first, with the proof one tap away.
 * Read-only: decisions about a receipt are made on its stage, where its balance is.
 *
 * `layout="full"` is the homeowner's Costing tab, built to the approved 18 Nov mock-up
 * (docs/mockups/2026-11-18-payment-history): what is confirmed, what is awaiting review
 * and what is still to pay, then the receipts, then where each stage stands. Elsewhere
 * (the Documents tab, the contractor's Money tab, which has its own figures) it is the list.
 */
export function ProjectPaymentHistory({ stagePayments, stageName, projectCurrency, audience = 'contractor', titleId = 'payment-history-title',
  stages = [], substages = [], projectRate = 1, layout = 'list', onOpenStage, onAddReceipt, canReplace = false, summary = true, onReview }: {
  stagePayments: Map<string, StagePayment>;
  stageName: (stageId: string) => string;
  projectCurrency: string;
  /** The homeowner uploaded these receipts, so the help line speaks to them. */
  audience?: 'client' | 'contractor';
  titleId?: string;
  stages?: Pick<ProjectStageRow, 'id' | 'stage_number' | 'milestone_amount' | 'pre_existing'>[];
  substages?: Pick<ProjectSubstageRow, 'id' | 'substage_number' | 'substage_key' | 'name'>[];
  /** The project's budget rate, for stage prices kept in dollars. */
  projectRate?: number;
  layout?: 'full' | 'list';
  /** Takes the homeowner to a stage, where a receipt is added or replaced. */
  onOpenStage?: (stageId: string) => void;
  onAddReceipt?: () => void;
  /** Only the homeowner who pays replaces a receipt; an invited viewer is not offered it. */
  canReplace?: boolean;
  /** The figure strip above the list. The contractor's Money tab shows its own figures (18 Nov). */
  summary?: boolean;
  /** The contractor reviews a waiting receipt from here; offered only to someone who may decide. */
  onReview?: (receiptId: string) => void;
}) {
  const t = useT(); const { lang } = useLanguage();
  const request = useRef(0);
  const [viewer, setViewer] = useState<{ name: string; url: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const rows = useMemo(() => paymentHistoryRows(stagePayments), [stagePayments]);
  const full = layout === 'full';
  const overview = useMemo(() => full ? paymentOverview(stages, stagePayments, projectCurrency, projectRate) : null,
    [full, stages, stagePayments, projectCurrency, projectRate]);
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US';
  const money = (value: number | null, code: string | null) => value == null ? '—'
    : `${value.toLocaleString(locale, { maximumFractionDigits: currencyFractionDigits(code) })} ${code ?? ''}`.trim();
  const bare = (value: number | null) => value == null ? '\u2014'
    : value.toLocaleString(locale, { maximumFractionDigits: currencyFractionDigits(projectCurrency) });
  const date = (value: string | null) => { const at = value ? new Date(value) : null;
    return at && !Number.isNaN(at.getTime()) ? at.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
  const confirmed = confirmedInProjectCurrency(rows, projectCurrency);
  const numberOf = (stageId: string) => stages.find(stage => stage.id === stageId)?.stage_number ?? null;
  const stageTitle = (stageId: string) => { const n = numberOf(stageId); const name = stageName(stageId);
    return n == null ? name : name ? `${n} · ${name}` : String(n); };
  const partName = (id: string | null) => { const part = id ? substages.find(row => row.id === id) : null;
    return part ? t('project.historyView.part', { n: part.substage_number, name: substageLabelWith(t, part) }) : null; };
  const counts: Record<Filter, number> = { all: rows.length, received: 0, pending: 0, flagged: 0 };
  for (const row of rows) if (row.status !== 'replaced') counts[row.status] += 1;
  const shown = filter === 'all' ? rows : rows.filter(row => row.status === filter);
  const client = audience === 'client';
  const statusLabel = (status: PaymentHistoryStatus) => !client && status === 'pending' ? t('contractorView.toConfirm') : t(STATUS_KEY[status]);

  async function open(path: string) {
    const mine = ++request.current; setFailed(false);
    const name = path.split('/').pop() ?? 'receipt';
    setViewer({ name, url: null });
    const url = await signReceiptUrl(path).catch(() => null);
    if (mine !== request.current) return;
    if (url) setViewer({ name, url }); else { setViewer(null); setFailed(true); }
  }

  const card = 'rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]';

  const list = <section aria-labelledby={titleId} className={full ? `${card} min-w-0` : 'min-w-0'}>
    <div className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5 ${full ? 'px-4 pb-3 pt-4 sm:px-5' : 'mb-3'}`}>
      <div className="min-w-0 max-w-xl">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id={titleId} className={`${full ? 'text-base' : 'text-sm'} font-semibold text-brand-near-black dark:text-white`}>{t('contractorMoney.paymentHistory')}</h2>
          {!full && rows.length > 0 && <p className="font-mono text-xs text-brand-mid-grey">{t('contractorMoney.paymentHistoryConfirmed', { amount: money(confirmed, projectCurrency) })}</p>}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-brand-mid-grey">{t(client ? 'project.clientUi.paymentHistoryHelp' : 'contractorMoney.paymentHistoryHelp')}</p>
      </div>
      {rows.length > 0 && <div role="group" aria-label={t('project.historyView.filters')} className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-0.5">
        {FILTERS.map(key => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
          className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${filter === key
            ? 'border-brand-green bg-brand-green text-white'
            : 'border-brand-border-grey bg-white text-brand-mid-grey hover:text-brand-near-black dark:border-[#2c2c2c] dark:bg-transparent dark:hover:text-white'}`}>
          {!client && key === 'pending' ? t('contractorView.toConfirm') : t(`project.historyView.${key}`)}<span className="font-mono opacity-75">{counts[key]}</span>
        </button>)}
      </div>}
    </div>

    {rows.length === 0
      ? <p className={`rounded-2xl border border-dashed border-brand-border-grey px-4 py-8 text-center text-xs text-brand-mid-grey dark:border-[#2c2c2c] ${full ? 'mx-4 mb-4 sm:mx-5' : ''}`}>{t('contractorMoney.paymentHistoryEmpty')}</p>
      : <div className={`${full ? '' : card} overflow-x-auto`}>
          <div className="md:min-w-[540px]">
          {/* Column headings for the table layout; on a phone each receipt is a card. */}
          <div aria-hidden className={`hidden grid-cols-[minmax(8.5rem,1.2fr)_minmax(0,1.35fr)_6.25rem_minmax(7.5rem,1fr)_auto] gap-4 border-b border-brand-border-grey bg-brand-off-white px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-brand-muted-grey md:grid dark:border-[#2c2c2c] ${full ? 'border-t' : 'rounded-t-2xl'}`}>
            <span>{t('project.historyView.amount')}</span><span>{t('project.historyView.stage')}</span><span>{t('project.historyView.uploaded')}</span>
            <span>{t('project.historyView.status')}</span><span className="text-right">{t('project.historyView.proof')}</span>
          </div>
          {shown.length === 0
            ? <p className="px-5 py-6 text-center text-xs text-brand-mid-grey">{t('project.historyView.noMatches')}</p>
            : <ol className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
              {shown.map(row => {
                const replaced = row.status === 'replaced';
                const n = numberOf(row.stageId);
                const detail = replaced ? t('project.historyView.replacedBy')
                  : partName(row.substageId) ?? (row.installment ? t('project.paymentPlan.installment', { n: row.installment }) : null);
                const replaceLink = client && canReplace && row.status === 'flagged' && onOpenStage
                  ? <button type="button" onClick={() => onOpenStage(row.stageId)} className="text-left text-xs font-semibold text-brand-green underline underline-offset-2 dark:text-state-complete">
                      {n == null ? t('project.receiptFlow.replaceReceipt') : t('project.historyView.openStage', { n })}</button>
                  : null;
                const reviewButton = !client && onReview && row.status === 'pending'
                  ? <button type="button" onClick={() => onReview(row.id)} data-review-receipt={row.id} className="text-left text-xs font-semibold text-brand-green underline underline-offset-2 dark:text-state-complete">{t('contractorView.reviewReceipt')}</button>
                  : null;
                return <li key={row.id} data-status={row.status} className="px-4 py-3 text-xs sm:px-5">
                  {/* Phone: the receipt's preview on the left, its details beside it. Desktop: the preview is the Proof column. */}
                  <div className="grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-x-3 gap-y-1 md:grid-cols-[minmax(8.5rem,1.2fr)_minmax(0,1.35fr)_6.25rem_minmax(7.5rem,1fr)_auto] md:items-start md:gap-4">
                    <div className="col-start-1 row-span-2 row-start-1 md:col-start-5 md:row-span-1 md:justify-self-end">
                      {row.path && <ReceiptThumb path={row.path} label={t('project.stages.confirmView')} muted={replaced} onOpen={() => void open(row.path!)} />}
                    </div>
                    <div className="col-start-2 row-start-1 min-w-0 md:col-start-1">
                      <p className={`whitespace-nowrap font-mono text-sm font-semibold tabular-nums ${replaced ? 'text-brand-mid-grey' : 'text-brand-near-black dark:text-white'}`}>{money(row.amount, row.currency)}</p>
                      {row.projectAmount != null && row.projectCurrency && row.projectCurrency !== row.currency
                        && <p className="mt-0.5 break-words font-mono text-[11px] text-brand-mid-grey">{t('project.receiptFlow.projectEquivalent', { amount: money(row.projectAmount, row.projectCurrency) })}</p>}
                    </div>
                    <div className="col-start-3 row-start-1 max-w-[7.5rem] justify-self-end sm:max-w-[10rem] text-right md:col-start-4 md:max-w-none md:justify-self-start md:text-left">
                      <Pill status={row.status} label={statusLabel(row.status)} />
                      {replaceLink && <div className="mt-2 hidden md:block">{replaceLink}</div>}
                      {reviewButton && <div className="mt-2 hidden md:block">{reviewButton}</div>}
                    </div>
                    <div className="col-span-2 col-start-2 row-start-2 min-w-0 text-brand-mid-grey md:col-span-1 md:col-start-2 md:row-start-1">
                      <p className={`break-words md:text-[13px] ${replaced ? '' : 'md:font-semibold md:text-brand-near-black md:dark:text-white'}`}>
                        {stageTitle(row.stageId)}<span className="md:hidden">{detail ? ` · ${detail}` : ''} · {date(row.submittedAt)}</span>
                      </p>
                      {detail && <p className="mt-0.5 hidden md:block">{detail}</p>}
                    </div>
                    <p className="hidden whitespace-nowrap text-brand-mid-grey md:col-start-3 md:row-start-1 md:block md:text-[13px]">{date(row.submittedAt)}</p>
                  </div>
                  {row.note && <p className={`ml-[3.75rem] mt-2 whitespace-pre-wrap md:ml-0 rounded-r-lg border-l-[3px] px-2.5 py-2 leading-relaxed text-brand-near-black dark:text-white ${row.status === 'flagged'
                    ? 'border-state-alert bg-state-alert/5' : 'border-state-held bg-state-held/5'}`}>
                    <b className="font-semibold">{t(client ? 'project.historyView.contractorNote' : 'project.historyView.yourNote')}</b> {row.note}
                  </p>}
                  {replaceLink && <div className="ml-[3.75rem] mt-2 md:hidden">{replaceLink}</div>}
                  {reviewButton && <div className="ml-[3.75rem] mt-2 md:hidden">{reviewButton}</div>}
                </li>;
              })}
            </ol>}
          </div>
        </div>}
  </section>;

  const viewerNode = <>
    {failed && <p role="alert" className="mt-2 text-xs text-state-alert">{t('project.receiptFlow.openReceipt')}</p>}
    {viewer && <DocumentViewer name={viewer.name} url={viewer.url} loading={!viewer.url} onClose={() => { ++request.current; setViewer(null); }} />}
  </>;

  if (!full || !overview) return <div className="min-w-0">{list}{viewerNode}</div>;

  const figures = [
    { key: 'confirmed', dot: 'bg-state-complete', label: t('project.historyView.confirmed'), value: money(overview.received, projectCurrency), help: t('project.historyView.confirmedHelp') },
    { key: 'awaiting', dot: 'bg-state-held', label: t('project.historyView.awaiting'), value: money(overview.pending, projectCurrency), help: t('project.historyView.awaitingHelp', { n: counts.pending }) },
    { key: 'remaining', dot: null, label: t('project.historyView.stillToPay'), value: money(overview.remaining, projectCurrency),
      help: overview.due == null ? null : t('project.historyView.stillToPayHelp', { total: money(overview.due, projectCurrency) }) },
  ];
  const pct = (part: number | null, whole: number | null) => part != null && whole ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0;

  return <div className="min-w-0 space-y-4">
    {summary && <dl className={`${card} grid divide-y divide-brand-border-grey sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-[#2c2c2c]`}>
      {figures.map(figure => <div key={figure.key} data-figure={figure.key} className="flex items-baseline justify-between gap-3 px-4 py-3 sm:block sm:px-5 sm:py-4">
        <dt className="flex items-center gap-2 text-xs text-brand-mid-grey">{figure.dot && <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${figure.dot}`} />}{figure.label}</dt>
        <dd className="text-right sm:text-left">
          <span className="font-mono text-[15px] font-semibold tabular-nums text-brand-near-black sm:mt-1.5 sm:block sm:text-xl dark:text-white">{figure.value}</span>
          {figure.help && <span className="mt-1 hidden text-[11.5px] text-brand-mid-grey sm:block">{figure.help}</span>}
        </dd>
      </div>)}
    </dl>}

    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
      {list}
      {overview.stages.length > 0 && <section aria-labelledby={`${titleId}-by-stage`} className={`${card} h-fit min-w-0`}>
        <h3 id={`${titleId}-by-stage`} className="px-4 pb-2 pt-4 text-sm font-semibold text-brand-near-black dark:text-white">{t('project.historyView.byStage')}</h3>
        <ul>
          {overview.stages.map(stage => {
            const tone = STANDING_TONE[stage.standing];
            return <li key={stage.stageId} data-standing={stage.standing} className="border-t border-brand-border-grey px-4 py-3 text-xs dark:border-[#2c2c2c]">
              <div className="flex items-start justify-between gap-2">
                {onOpenStage
                  ? <button type="button" onClick={() => onOpenStage(stage.stageId)} className="min-w-0 text-left text-[13px] font-semibold text-brand-near-black hover:underline dark:text-white">{stageTitle(stage.stageId)}</button>
                  : <span className="min-w-0 text-[13px] font-semibold text-brand-near-black dark:text-white">{stageTitle(stage.stageId)}</span>}
                {tone ? <Pill small status={tone} label={t(STANDING_KEY[stage.standing])} /> : <span className="whitespace-nowrap text-[11px] text-brand-mid-grey">{t(STANDING_KEY[stage.standing])}</span>}
              </div>
              <div aria-hidden className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-brand-light-grey">
                <i className="block h-full bg-state-complete" style={{ width: `${pct(stage.received, stage.due)}%` }} />
                <i className="block h-full bg-state-held/40" style={{ width: `${pct(stage.pending, stage.due)}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between gap-2 font-mono text-[11px] text-brand-mid-grey">
                <span>{(stage.pending ?? 0) > 0 && !stage.received
                  ? t('project.historyView.stageAwaiting', { amount: bare(stage.pending) })
                  : stage.received ? t('project.historyView.stageConfirmed', { amount: bare(stage.received) }) : '—'}</span>
                <span>{money(stage.due, projectCurrency)}</span>
              </div>
            </li>;
          })}
        </ul>
        {client && onAddReceipt && <div className="p-4 pt-1">
          <button type="button" onClick={onAddReceipt} className="w-full rounded-xl bg-brand-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-hover">{t('project.clientUi.addReceipt')}</button>
        </div>}
      </section>}
    </div>
    {viewerNode}
  </div>;
}
