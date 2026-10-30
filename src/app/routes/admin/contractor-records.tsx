import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Check, ChevronRight, FileText, Loader2, Minus, Phone, Search, ShieldCheck, UserPlus, UserRound,
} from 'lucide-react';
import {
  contractorRecordsAvailable, fetchContractorDossier, fetchContractorRecords,
  type ContractorDossier, type ContractorRecordRow,
} from '@/lib/supabase/admin-contractor-records';
import { ONBOARDING_STEPS, type OnboardingStep } from '@/lib/supabase/contractor-onboarding';
import {
  fetchPipeline, pipelineAvailable, type PipelineRow, type PipelineStage,
} from '@/lib/admin/partner-pipeline';
import { bankName } from '@/lib/payments/banks';
import { signCredentialUrl } from '@/lib/supabase/admin-applications';
import { formatDate } from '@/lib/format';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /admin/contractors/records — what each contractor actually filled in.
//
// The onboarding form (116–118) collects a date of birth, a home address, a licence
// number, three emergency contacts and the account money will be sent to. Until this
// page, none of it was readable: `admin_contractor_onboarding` returned six booleans,
// so staff could see that somebody was "5 of 5" and not who to ring if there was an
// accident on their site.
//
// ── Not the directory ───────────────────────────────────────────────────────────────
// /admin/contractors is the published list clients browse. This is every contractor
// with an account — most of whom are not published — because the people whose details
// staff need are usually the ones who have just joined.
//
// ── Read-only, and unmasked ─────────────────────────────────────────────────────────
// Nothing here edits a contractor's answers; their own submission is the record. Payout
// numbers are shown in full, which they are nowhere else in the product: somebody
// authorising a release has to check the number against what the contractor told them,
// and `admin_contractor_dossier` refuses every caller who is not an administrator.
// =========================================================

/**
 * The cards above the list, and what each one selects.
 *
 * 30 Oct 2026. These used to be a CHAIN: contractor accounts → onboarding complete →
 * partner applications → pre-qualified → sent to booking, each showing what it lost
 * from the one before as −₉. Philip asked for the negatives to go and for "completed
 * and incomplete as independent standing categories".
 *
 * The difference is not cosmetic. −50 is a gap between two numbers; "50 did not finish
 * onboarding" is a set of people, and pressing it shows you who they are. Every card
 * here counts a set, every count is positive, and every one of them filters the list
 * below — "actionable filter cards", which is what was asked for.
 *
 * The pairs are deliberate and exhaustive: complete + incomplete = all contractors,
 * applied + not applied = all contractors. A reader can add them up and check us.
 */
type CardKey =
  | 'all' | 'onboarded' | 'notOnboarded' | 'ownClient'
  | 'applied' | 'notApplied' | 'prequalified' | 'sentToBooking';

/** Stages at or past pre-qualification. Membership, not rank: `disqualified` and
 *  `rejected` sit at the front of the stage list and must not read as "further on". */
const AT_OR_PAST_PREQUALIFIED: readonly PipelineStage[] = [
  'prequalified', 'booking_shown', 'call_completed', 'reviewing', 'accepted',
  'committed', 'agreement_signed', 'client_introduced', 'activated',
];
const AT_OR_PAST_BOOKING: readonly PipelineStage[] = [
  'booking_shown', 'call_completed', 'reviewing', 'accepted',
  'committed', 'agreement_signed', 'client_introduced', 'activated',
];

/** Does this contractor belong in that card? */
function inCard(key: CardKey, r: ContractorRecordRow, p: PipelineRow | undefined): boolean {
  switch (key) {
    case 'all':           return true;
    case 'onboarded':     return r.status.complete;
    case 'notOnboarded':  return !r.status.complete;
    case 'ownClient':     return r.clientIntent === 'onboard_client';
    // Applying is having an application on file. NOT the onboarding answer: reading
    // "I have a client" as an application is the double count Philip objected to.
    case 'applied':       return !!p?.applicationId;
    case 'notApplied':    return !p?.applicationId;
    case 'prequalified':  return !!p && AT_OR_PAST_PREQUALIFIED.includes(p.stage);
    case 'sentToBooking': return !!p && AT_OR_PAST_BOOKING.includes(p.stage);
  }
}

const CARD_ORDER: CardKey[] = [
  'all', 'onboarded', 'notOnboarded', 'ownClient',
  'applied', 'notApplied', 'prequalified', 'sentToBooking',
];

export default function AdminContractorRecords() {
  const t = useT();
  const [rows, setRows] = useState<ContractorRecordRow[] | null>(null);
  const [absent, setAbsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  /** Per-person application state, so a card can FILTER and not merely count. */
  const [pipeline, setPipeline] = useState<Map<string, PipelineRow> | null>(null);
  /** Which card is pressed. Null is everybody. */
  const [filter, setFilter] = useState<CardKey | null>(null);

  const load = useCallback(async () => {
    try {
      if (!(await contractorRecordsAvailable())) { setAbsent(true); setRows([]); return; }
      setRows(await fetchContractorRecords());
      setError(null);
    } catch {
      setRows([]);
      setError(t('adminContractorRecords.loadFailed'));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  // Separate from `load`: the pipeline is a different RPC behind a different migration,
  // and a database without it must still render the table rather than an error. An
  // empty map means "no application data", which the cards read as nobody having
  // applied — true, and better than a page that will not load.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (!(await pipelineAvailable())) { if (alive) setPipeline(new Map()); return; }
        const rows = await fetchPipeline();
        if (alive) setPipeline(new Map(rows.map(r => [r.userId, r])));
      } catch { if (alive) setPipeline(new Map()); }
    })();
    return () => { alive = false; };
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows ?? [];
    // The pressed card narrows the list; the search box narrows it again. Both, not
    // either — "show me who has not onboarded, called Ngu" is the question staff
    // actually ask.
    if (filter && filter !== 'all') list = list.filter(r => inCard(filter, r, pipeline?.get(r.userId)));
    if (q) list = list.filter(r =>
      [r.fullName, r.email, r.phone].some(v => (v ?? '').toLowerCase().includes(q)));
    return list;
  }, [rows, query, filter, pipeline]);

  /** How many people each card holds, counted the same way the filter selects them. */
  const counts = useMemo(() => {
    const out = {} as Record<CardKey, number>;
    for (const key of CARD_ORDER) {
      out[key] = (rows ?? []).filter(r => inCard(key, r, pipeline?.get(r.userId))).length;
    }
    return out;
  }, [rows, pipeline]);

  if (!rows) {
    return <div className="flex justify-center p-12"><Loader2 className="size-5 animate-spin text-brand-mid-grey" /></div>;
  }

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">
          {t('adminContractorRecords.title')}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">
          {t('adminContractorRecords.subtitle')}
        </p>
      </header>

      {absent && (
        <p className="mb-6 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          {t('adminContractorRecords.notApplied')}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-6 rounded-xl border border-state-alert/30 bg-brand-off-white px-4 py-3 text-sm dark:bg-[#1e1e1e] dark:text-white">{error}</p>
      )}

      <section className="mb-5" aria-label={t('adminContractorRecords.funnelTitle')}>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-mid-grey">
          {t('adminContractorRecords.funnelTitle')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CARD_ORDER.map(key => (
            <FilterCard
              key={key}
              label={t(`adminContractorRecords.cards.${key}` as TKey)}
              value={counts[key]}
              active={filter === key || (key === 'all' && filter === null)}
              onPick={() => setFilter(key === 'all' ? null : filter === key ? null : key)}
            />
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-brand-mid-grey">
          <Link to="/admin/partners" className="font-semibold text-brand-near-black underline underline-offset-2 dark:text-white">
            {t('adminContractorRecords.funnelWorklist')}
          </Link>{' '}
          {t('adminContractorRecords.funnelBookingNote')}
        </p>
      </section>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-2.5 size-4 text-brand-mid-grey" aria-hidden />
        <input
          type="search" value={query} onChange={e => setQuery(e.target.value)}
          aria-label={t('adminContractorRecords.search')}
          placeholder={t('adminContractorRecords.search')}
          className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm dark:border-[#444] dark:bg-[#1e1e1e] dark:text-white"
        />
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-brand-border-grey px-4 py-8 text-center text-sm text-brand-mid-grey dark:border-[#2c2c2c]">
          {rows.length === 0 ? t('adminContractorRecords.empty') : t('adminContractorRecords.noMatch')}
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c]">
          {shown.map(r => (
            <Fragment key={r.userId}>
              <button
                type="button"
                onClick={() => setOpen(open === r.userId ? null : r.userId)}
                aria-expanded={open === r.userId}
                className="flex w-full items-center gap-3 border-b border-brand-border-grey px-4 py-3 text-left last:border-b-0 hover:bg-brand-off-white dark:border-[#2c2c2c] dark:hover:bg-[#1e1e1e]"
              >
                <ChevronRight className={cn('size-4 shrink-0 text-brand-mid-grey transition-transform', open === r.userId && 'rotate-90')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-brand-near-black dark:text-white">
                    {r.fullName ?? r.email ?? r.userId}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-brand-mid-grey">
                    {r.email}{r.phone ? ` · ${r.phone}` : ''}
                  </span>
                </span>
                {r.clientIntent === 'onboard_client' && (
                  <span className="hidden shrink-0 items-center gap-1 rounded-full bg-brand-off-white px-2 py-1 text-[11px] font-semibold text-brand-near-black sm:inline-flex dark:bg-[#2c2c2c] dark:text-white">
                    <UserPlus className="size-3" aria-hidden />{t('adminContractorRecords.partner')}
                  </span>
                )}
                <Pips status={r.status} />
              </button>
              {open === r.userId && <Dossier userId={r.userId} />}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One card. Pressing it filters the list; pressing it again clears the filter.
 *
 * A button, not a div with a click handler: these are controls, and staff reach this
 * page with a keyboard as often as a mouse. `aria-pressed` is what tells a screen
 * reader which slice of the list is currently on screen.
 */
function FilterCard({ label, value, active, onPick }: {
  label: string; value: number; active: boolean; onPick: () => void;
}) {
  return (
    <button
      type="button" onClick={onPick} aria-pressed={active}
      className={cn(
        'rounded-xl border px-4 py-3 text-left transition-colors',
        active
          ? 'border-brand-near-black bg-brand-off-white dark:border-white dark:bg-[#2c2c2c]'
          : 'border-brand-border-grey bg-white hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:hover:border-[#555]',
      )}
    >
      <p className="text-xs text-brand-mid-grey">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-brand-near-black dark:text-white">{value}</p>
    </button>
  );
}

/* The chained FunnelStrip — five stages each showing −₉ lost from the one before —
   was removed 30 Oct 2026. Philip: no negative numbers, and the cards must be
   "actionable filter cards". `FilterCard` above replaced it; see the CardKey header
   for why a set beats a gap. */

/** Five pips, one per required step, so the table says where somebody stopped. */
function Pips({ status }: { status: ContractorRecordRow['status'] }) {
  const t = useT();
  return (
    <span className="flex shrink-0 gap-1" title={ONBOARDING_STEPS
      .map(k => `${t(`contractorOnboarding.step.${k}.title` as TKey)}: ${status.steps[k] ? '✓' : '—'}`)
      .join('\n')}>
      {ONBOARDING_STEPS.map(k => (
        <span key={k} className={cn('size-2 rounded-full',
          status.steps[k] ? 'bg-state-success' : 'bg-brand-border-grey dark:bg-[#444]')} />
      ))}
    </span>
  );
}

function Dossier({ userId }: { userId: string }) {
  const t = useT();
  const [d, setD] = useState<ContractorDossier | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setD(undefined);
    fetchContractorDossier(userId)
      .then(x => { if (alive) setD(x); })
      .catch(() => { if (alive) setD(null); });
    return () => { alive = false; };
  }, [userId]);

  if (d === undefined) {
    return <div className="flex justify-center border-b border-brand-border-grey py-6 dark:border-[#2c2c2c]"><Loader2 className="size-4 animate-spin text-brand-mid-grey" /></div>;
  }
  if (d === null) {
    return <p role="alert" className="border-b border-brand-border-grey px-4 py-4 text-sm text-state-alert dark:border-[#2c2c2c]">{t('adminContractorRecords.dossierFailed')}</p>;
  }

  const o = d.onboarding;
  /**
   * What they have not done yet, said once at the top.
   *
   * Ruth read a half-finished record as a finished one: the Client row's LABEL is the
   * statement "Has a client to onboard" and the unanswered value is a bare dash, so it
   * scanned as the answer — and "Emergency contacts: none given" read as a step skipped
   * rather than a step never reached. Five contractors are sitting in exactly that
   * state. A blank is ambiguous; this is not.
   */
  const outstanding = ONBOARDING_STEPS.filter(k => !d.status.steps[k]);

  return (
    <div className="grid gap-5 border-b border-brand-border-grey bg-brand-off-white px-4 py-5 sm:grid-cols-2 dark:border-[#2c2c2c] dark:bg-[#141414]">
      {outstanding.length > 0 && (
        <p className="sm:col-span-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <span className="font-semibold">{t('adminContractorRecords.unfinished')}</span>{' '}
          {outstanding.map(k => t(`contractorOnboarding.step.${k}.title` as TKey)).join(' · ')}
        </p>
      )}
      <Section icon={<UserRound className="size-3.5" />} title={t('adminContractorRecords.secPersonal')}>
        <Row label={t('contractorOnboarding.dob')} value={o?.date_of_birth ? formatDate(o.date_of_birth) : null} />
        <Row label={t('contractorOnboarding.address')} value={o?.residential_address ?? null} />
      </Section>

      <Section icon={<ShieldCheck className="size-3.5" />} title={t('adminContractorRecords.secBusiness')}>
        <Row label={t('contractorOnboarding.licenseNumber')} value={o?.license_number ?? null} />
        <Row
          label={t('contractorOnboarding.businessStatus')}
          value={o?.business_status
            ? t(`contractorOnboarding.${o.business_status}` as TKey)
            : null}
        />
        {o?.business_status === 'registered' && <>
          <Row label={t('contractorOnboarding.businessName')} value={o.business_name} />
          <Row label={t('contractorOnboarding.businessReg')} value={o.business_reg_number} />
        </>}
      </Section>

      <Section icon={<Phone className="size-3.5" />} title={t('adminContractorRecords.secEmergency')}>
        {d.emergency_contacts.length === 0
          ? <Row label="" value={null} />
          : d.emergency_contacts.map(c => (
            <Row
              key={c.position}
              label={`${c.full_name} · ${c.relationship}`}
              value={c.phone}
            />
          ))}
      </Section>

      <Section icon={<Check className="size-3.5" />} title={t('adminContractorRecords.secPayout')}>
        {d.payout_destinations.length === 0
          ? <Row label="" value={null} />
          : d.payout_destinations.map(p => (
            <Row
              key={p.id}
              label={p.method === 'mobile_money'
                ? t('contractorPayout.mobileMoney')
                : `${bankName(p.bank_key)} · ${p.account_name ?? ''}`}
              // Full, not masked. Staff authorising a release must be able to check it.
              value={p.method === 'mobile_money' ? p.mobile_no : p.account_number}
            />
          ))}
      </Section>

      <Section icon={<ShieldCheck className="size-3.5" />} title={t('adminContractorRecords.secAgreement')}>
        {d.agreements.length === 0
          ? <Row label="" value={null} />
          : d.agreements.map((a, i) => (
            <Row
              key={i}
              label={`${a.signed_name} · v${a.version}`}
              value={formatDate(a.accepted_at)}
            />
          ))}
      </Section>

      <Section icon={<UserPlus className="size-3.5" />} title={t('adminContractorRecords.secIntent')}>
        <Row
          label={t('adminContractorRecords.intentLabel')}
          value={o?.client_intent
            ? t(o.client_intent === 'onboard_client'
                ? 'adminContractorRecords.intentHasClient'
                : 'adminContractorRecords.intentNoClient')
            : null}
        />
        {/* Reported but no longer asked for (118). Shown only when one exists, so it
            does not read as an outstanding requirement — and openable, because a
            filename staff cannot click is a document they cannot review. */}
        {d.documents.map((x, i) => (
          <DocLink key={i} kind={x.kind} filename={x.filename} path={x.path} />
        ))}
      </Section>
    </div>
  );
}

function Section({ icon, title, children }: {
  icon: React.ReactNode; title: string; children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">
        {icon}{title}
      </h3>
      <dl className="space-y-1.5">{children}</dl>
    </section>
  );
}

/** A missing answer shows a dash, never a blank — "not given" is information. */
function Row({ label, value }: { label: string; value: string | null | undefined }) {
  const t = useT();
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <dt className="min-w-0 shrink text-brand-mid-grey">{label || t('adminContractorRecords.none')}</dt>
      <dd className="min-w-0 shrink-0 text-right font-medium text-brand-near-black dark:text-white">
        {value ?? <Minus className="inline size-3.5 text-brand-mid-grey" aria-label={t('adminContractorRecords.notGiven')} />}
      </dd>
    </div>
  );
}

/**
 * A contractor's uploaded document, as a link staff can actually open.
 *
 * `contractor-docs` is private and the stored value is a PATH, so a link has to be
 * signed on demand. Signed on CLICK rather than on render: a dossier with several
 * documents would otherwise mint a URL for every one of them whether or not anybody
 * looks, and each is a live link to somebody's identity papers for the next hour.
 */
function DocLink({ kind, filename, path }: { kind: string; filename: string; path: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open() {
    setBusy(true); setFailed(false);
    try {
      const url = await signCredentialUrl(path);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <dt className="min-w-0 shrink text-brand-mid-grey">
        {t(`adminContractorRecords.doc.${kind}` as TKey)}
      </dt>
      <dd className="min-w-0 shrink-0 text-right">
        <button
          type="button" onClick={() => void open()} disabled={busy}
          className="inline-flex max-w-52 items-center gap-1.5 font-medium text-brand-near-black underline underline-offset-4 disabled:opacity-50 dark:text-white"
        >
          {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <FileText className="size-3" aria-hidden />}
          <span className="truncate">{filename}</span>
        </button>
        {failed && <p role="alert" className="text-[11px] text-state-alert">{t('adminContractorRecords.docFailed')}</p>}
      </dd>
    </div>
  );
}
