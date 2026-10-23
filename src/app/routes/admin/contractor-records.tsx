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
  fetchPartnerFunnel, funnelStages, partnerFunnelAvailable, type PartnerFunnel,
} from '@/lib/admin/partner-funnel';
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

export default function AdminContractorRecords() {
  const t = useT();
  const [rows, setRows] = useState<ContractorRecordRow[] | null>(null);
  const [absent, setAbsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  /** null until loaded, false when 136 is not on this database yet. */
  const [funnel, setFunnel] = useState<PartnerFunnel | null | false>(null);

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

  // Separate from `load`: the funnel is a different RPC behind a different migration, and
  // a database without 136 must still render the table rather than an error.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (!(await partnerFunnelAvailable())) { if (alive) setFunnel(false); return; }
        const f = await fetchPartnerFunnel();
        if (alive) setFunnel(f);
      } catch { if (alive) setFunnel(false); }
    })();
    return () => { alive = false; };
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !rows) return rows ?? [];
    return rows.filter(r =>
      [r.fullName, r.email, r.phone].some(v => (v ?? '').toLowerCase().includes(q)));
  }, [rows, query]);

  if (!rows) {
    return <div className="flex justify-center p-12"><Loader2 className="size-5 animate-spin text-brand-mid-grey" /></div>;
  }

  const done = rows.filter(r => r.status.complete).length;
  const partners = rows.filter(r => r.clientIntent === 'onboard_client').length;

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

      {funnel && <FunnelStrip funnel={funnel} />}

      {/* Counts of real rows, not illustrative figures. */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label={t('adminContractorRecords.statTotal')} value={rows.length} />
        <Stat label={t('adminContractorRecords.statComplete')} value={done} />
        <Stat label={t('adminContractorRecords.statPartners')} value={partners} />
      </div>

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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-brand-border-grey bg-white px-4 py-3 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <p className="text-xs text-brand-mid-grey">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-brand-near-black dark:text-white">{value}</p>
    </div>
  );
}

/**
 * The partner funnel, in the order the flow runs.
 *
 * Outreach → contractor signup → contractor onboarding → partner application →
 * pre-qualification → the call with Philip. Each stage shows what it lost from the one
 * before it, because the count alone never says where to act.
 *
 * Two labels are load-bearing. "Sent to booking" is not confirmed bookings — Philip's
 * calendar holds those, and the widget is a cross-origin iframe, so this is the nearest
 * fact Groundwork owns. And the interested-but-not-applied line is the follow-up list:
 * somebody who said yes at onboarding and then stopped is the cheapest person to
 * recover, which is the one number here that names an action.
 */
function FunnelStrip({ funnel }: { funnel: PartnerFunnel }) {
  const t = useT();
  const stages = funnelStages(funnel);
  const gap = Math.max(0, funnel.partnerInterested - funnel.applications);

  return (
    <section className="mb-5" aria-label={t('adminContractorRecords.funnelTitle')}>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-mid-grey">
        {t('adminContractorRecords.funnelTitle')}
      </h2>
      <ol className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stages.map((stage, i) => (
          <li
            key={stage.key}
            className="rounded-xl border border-brand-border-grey bg-white px-4 py-3 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
          >
            <p className="text-xs text-brand-mid-grey">
              {t(`adminContractorRecords.funnel.${stage.key}` as TKey)}
            </p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-brand-near-black dark:text-white">
              {stage.count}
            </p>
            {/* No drop on the first stage: there is nothing before it to have lost. */}
            {i > 0 && stage.dropFromPrevious > 0 && (
              <p className="mt-0.5 text-[11px] tabular-nums text-brand-mid-grey">
                −{stage.dropFromPrevious}
              </p>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] leading-relaxed text-brand-mid-grey">
        {/* The counts say where the funnel leaks; the pipeline says who to ring. */}
        <Link to="/admin/partners" className="font-semibold text-brand-near-black underline underline-offset-2 dark:text-white">
          {t('adminContractorRecords.funnelWorklist')}
        </Link>{' '}
        {t('adminContractorRecords.funnelBookingNote')}
        {gap > 0 && <> {t('adminContractorRecords.funnelGap').replace('{n}', String(gap))}</>}
      </p>
    </section>
  );
}

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
  return (
    <div className="grid gap-5 border-b border-brand-border-grey bg-brand-off-white px-4 py-5 sm:grid-cols-2 dark:border-[#2c2c2c] dark:bg-[#141414]">
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
