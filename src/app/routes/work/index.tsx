import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, ArrowRight, Camera, Check, FolderPlus, Landmark, Loader2, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchAssignedProjects, fetchRework, fetchMyPayments, fetchSubstages,
  type AssignedProject, type ReworkItem, type ContractorPayment,
} from '@/lib/supabase/contractor-work';
import type { ProjectSubstageRow } from '@/types/project';
import { fetchMyPayoutDestinations } from '@/lib/supabase/payout-destinations';
import { fetchOnboardingStatus, onboardingAvailable, ONBOARDING_STEPS,
         type OnboardingStatus } from '@/lib/supabase/contractor-onboarding';
import { StagePipeline, currentStageNumber } from '@/components/contractor/StagePipeline';
import { useProjectMoney } from '@/lib/budget/use-project-money';
import { moneyPair } from '@/lib/budget/money-pair';
import { useStageLabels } from '@/lib/stage-labels';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// The contractor's dashboard.
//
// Redesigned 29 Oct 2026, approved with the rest of the surface. It answers, in
// order: where are my builds, what is being asked of me on the one that is live,
// and what have I been paid.
//
// WHAT WENT, AND WHY
//
// The "needs action" tab and the "current stage work" task list are both gone. The
// lit dot on a build's pipeline is the work; a second list of the same truth is free
// to disagree with the first, and two lists that disagree are worse than one.
// Verifier findings are not lost — they ride on the build they are about, as a state
// on its row and in full inside the project.
//
// Three states stay apart deliberately, because collapsing them is a lie:
//   · unavailable — the source could not be read (older deployment, RLS refusal)
//   · empty       — read fine, nothing there
//   · zero        — a real count that happens to be 0
// =========================================================

export default function ContractorDashboard() {
  const t = useT();
  const { user } = useAuth();
  const { stageLabel } = useStageLabels();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';

  const [projects, setProjects] = useState<AssignedProject[] | null>(null);
  const [rework, setRework] = useState<ReworkItem[] | null>(null);
  const [payments, setPayments] = useState<{ rows: ContractorPayment[]; available: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null while unknown. A prompt shown because a read failed would nag somebody who has
  // already given their details, so silence is the answer to "we could not tell".
  const [needsPayout, setNeedsPayout] = useState<boolean | null>(null);
  // The contractor's onboarding progress (116). Null while unknown or while the
  // migration is not applied — in both cases the banner stays away rather than
  // nagging somebody about steps this database cannot yet record.
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const assigned = await fetchAssignedProjects();
        if (!alive) return;
        setProjects(assigned);
        setError(null);
        const [r, p] = await Promise.all([fetchRework(assigned), fetchMyPayments()]);
        if (!alive) return;
        setRework(r);
        setPayments(p);
      } catch {
        if (alive) { setProjects([]); setError(t('contractor.loadFailed')); }
      }
    })();
    return () => { alive = false; };
  }, [t]);

  // Onboarding progress (116). Read separately from everything else: a contractor who
  // has not finished should still see their work, and a failure here must not blank it.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!(await onboardingAvailable())) return;   // 116 not applied — stay silent
        const st = await fetchOnboardingStatus();
        if (alive) setOnboarding(st);
      } catch { /* a refusal is not evidence they are unfinished */ }
    })();
    return () => { alive = false; };
  }, []);

  // Separate from the work read: payment details are not work, and a failure in one must
  // not blank the other.
  useEffect(() => {
    let alive = true;
    fetchMyPayoutDestinations()
      .then(rows => { if (alive) setNeedsPayout(rows.filter(d => d.status !== 'retired').length === 0); })
      .catch(() => { if (alive) setNeedsPayout(null); });
    return () => { alive = false; };
  }, []);

  const firstName = ((user?.user_metadata?.full_name as string | undefined) ?? '').split(' ')[0];

  /** Stage ids a verifier has sent back, so a build can say so on its own row. */
  const reworkStages = useMemo(
    () => new Set((rework ?? []).map(r => r.stageId)),
    [rework],
  );

  const activeBuilds = useMemo(
    () => (projects ?? []).filter(a => a.activeStage !== null).length,
    [projects],
  );
  /**
   * Projects with something outstanding on the contractor: a stage open for work, or
   * a verifier's findings to answer. Not "awaiting verification" — that state is
   * hidden until the feature ships, and a tile counting it would point at a screen
   * with nothing on it.
   */
  const needsYou = useMemo(
    () => (projects ?? []).filter(a =>
      a.activeStage !== null || a.stages.some(s => reworkStages.has(s.id))).length,
    [projects, reworkStages],
  );

  const visibleProjects = (projects ?? []).filter(a =>
    [a.project.name, a.project.city, a.project.country, ...a.stages.map(stageLabel)]
      .join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  /** The build whose stage the rail expands: the first one with work open. */
  const lead = visibleProjects.find(a => a.activeStage !== null) ?? null;

  if (projects === null) {
    return (
      <p className="flex items-center gap-2 py-16 text-sm text-brand-mid-grey">
        <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5 text-brand-near-black dark:text-white">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">
            {t('contractor.dashboard.title')}
          </h1>
          <p className="mt-1 text-sm text-brand-mid-grey">
            {firstName
              ? t('contractor.dashboard.greeting', { name: firstName })
              : t('contractor.dashboard.subtitle')}
          </p>
        </div>
        <Link
          to="/projects/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-near-black px-3.5 py-2 text-xs font-semibold text-white dark:bg-white dark:text-brand-near-black"
        >
          <FolderPlus className="size-3.5" aria-hidden />{t('contractorOwnProject.promptCta')}
        </Link>
      </header>

      {/* ── Finish setting up (116) ────────────────────────────────────────────────
          Shown only when we KNOW they are unfinished. Null means either the read failed
          or 116 is not applied, and nagging on a guess is worse than staying quiet. */}
      {onboarding && !onboarding.complete && (
        <div className="rounded-xl border border-state-alert/30 bg-brand-off-white px-4 py-3.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                {t('contractorOnboarding.bannerTitle')}
              </p>
              <p className="mt-0.5 text-xs text-brand-mid-grey">
                {t('contractorOnboarding.bannerBody', {
                  left: String(ONBOARDING_STEPS.filter(k => !onboarding.steps[k]).length),
                })}
              </p>
            </div>
            <Link
              to="/work/onboarding"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-near-black px-3.5 py-2 text-xs font-semibold text-white dark:bg-white dark:text-brand-near-black"
            >
              {t('contractorOnboarding.bannerCta')}<ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
          {/* Six pips, so the distance left is visible without opening the page. */}
          <div className="mt-3 flex gap-1.5" aria-hidden>
            {ONBOARDING_STEPS.map(k => (
              <span
                key={k}
                className={cn('h-1 flex-1 rounded-full',
                  onboarding.steps[k] ? 'bg-state-success' : 'bg-brand-border-grey dark:bg-[#2c2c2c]')}
              />
            ))}
          </div>
        </div>
      )}

      {/* The standalone payout prompt remains ONLY for a database without 116, where the
          banner above cannot render. Once 116 is applied this never shows: payout is a
          step in the sequence and `onboarding` is non-null. */}
      {onboarding === null && needsPayout === true && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white">
              <Landmark className="size-4 shrink-0" aria-hidden />{t('contractorPayout.promptTitle')}
            </p>
            <p className="mt-0.5 text-xs text-brand-mid-grey">{t('contractorPayout.promptBody')}</p>
          </div>
          <Link
            to="/work/payouts"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-near-black px-3.5 py-2 text-xs font-semibold text-white dark:bg-white dark:text-brand-near-black"
          >
            {t('contractorPayout.promptCta')}<ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      )}

      <div className="relative lg:hidden">
        <Search className="absolute left-3 top-3 size-4 text-brand-mid-grey" />
        <input type="search" aria-label={t('contractorDashboard.search')} placeholder={t('contractorDashboard.search')}
               value={query}
               onChange={e => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
               className="w-full rounded-xl border border-brand-border-grey bg-white py-2.5 pl-10 pr-3 text-sm dark:border-[#444] dark:bg-[#1e1e1e]" />
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-state-alert/30 bg-brand-off-white px-4 py-3 text-sm text-brand-near-black dark:bg-[#1e1e1e] dark:text-white">
          {error}
        </p>
      )}

      {!error && <>
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label={t('contractorDashboard.tileActiveBuilds')} value={projects.length}
                dot="active" hint={t('contractorDashboard.tileActiveHint', { n: String(activeBuilds) })} />
          {/* Verification is hidden until the feature is finished (30 Oct 2026), so
              neither the tile nor the filter may announce a stage nobody can act on. */}
          <Tile label={t('contractorDashboard.tileNeedsYou')} value={needsYou}
                dot="held" hint={t('contractorDashboard.tileNeedsYouHint')} />
          <ReleasedTile payments={payments} />
        </div>

        <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[3fr_2fr]">
          <div className="flex min-w-0 flex-col gap-5">
            <section className="min-w-0">
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t('contractorDashboard.yourBuilds')}</h2>
                {projects.length > 0 && (
                  <Link to="/work/projects" className="text-xs text-brand-mid-grey underline underline-offset-2 hover:text-brand-near-black dark:hover:text-white">
                    {t('common.viewAll')}
                  </Link>
                )}
              </div>

              {projects.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-brand-border-grey px-4 py-10 text-center">
                  <p className="text-sm font-medium">{t('contractor.projects.emptyTitle')}</p>
                  <p className="mt-1 text-xs text-brand-mid-grey">{t('contractor.projects.emptyBody')}</p>
                </div>
              ) : visibleProjects.length === 0 ? (
                <p className="py-8 text-sm text-brand-mid-grey">{t('contractorDashboard.noResults')}</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {visibleProjects.slice(0, 5).map(a => (
                    <li key={a.project.id}>
                      <BuildRow assigned={a} hasRework={a.stages.some(s => reworkStages.has(s.id))} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* "Recent releases" removed 30 Oct 2026 on Favour's note: the dashboard
                is active projects, what needs doing, and partner status. Payouts is
                the page for what has been paid, and it has the full history. */}
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <OpenStage lead={lead} />

            <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
                {t('contractorDashboard.whyNoListTitle')}
              </h2>
              <p className="mt-2 text-xs text-brand-mid-grey">{t('contractorDashboard.whyNoListBody')}</p>
            </section>

            {/* The partner funnel's dashboard card is gone (30 Oct 2026): it is not on
                the approved dashboard, and "Partner programme" is a permanent sidebar
                entry, so the card was a second door to a room already signposted. */}
          </div>
        </div>
      </>}
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────────────

function Tile({ label, value, hint, dot }: {
  label: string; value: number | null; hint?: string;
  dot: 'active' | 'held' | 'complete' | 'locked';
}) {
  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white px-4 py-3.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-brand-mid-grey">{label}</p>
      {/* A dash, not a zero: "could not read" and "none" are different facts. */}
      <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums tracking-tight">
        {value === null ? '—' : value}
      </p>
      {hint && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-brand-mid-grey">
          <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full',
            dot === 'complete' && 'bg-state-complete',
            dot === 'held'     && 'bg-state-held',
            dot === 'locked'   && 'bg-brand-border-grey',
            dot === 'active'   && 'bg-brand-near-black dark:bg-white',
          )} />
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * What has actually been released to this contractor.
 *
 * Payments carry their own currency, so a sum across two of them would be a number
 * that means nothing. One currency gets a total; more than one gets the count and
 * says so. An unreadable ledger (090: beneficiary-scoped) shows a dash, never a 0 —
 * "we cannot see it" must not read as "nothing is owed".
 */
function ReleasedTile({ payments }: { payments: { rows: ContractorPayment[]; available: boolean } | null }) {
  const t = useT();

  if (payments === null || !payments.available) {
    return <Tile label={t('contractorDashboard.tileReleased')} value={null} dot="locked"
                 hint={t('contractor.kpi.unavailable')} />;
  }

  const rows = payments.rows;
  const currencies = new Set(rows.map(r => r.currency.toUpperCase()));

  if (rows.length === 0) {
    return <Tile label={t('contractorDashboard.tileReleased')} value={0} dot="locked"
                 hint={t('contractorDashboard.noReleases')} />;
  }

  if (currencies.size > 1) {
    return <Tile label={t('contractorDashboard.tileReleased')} value={rows.length} dot="complete"
                 hint={t('contractorDashboard.tileReleasedMixed', { n: String(rows.length) })} />;
  }

  const code = [...currencies][0];
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white px-4 py-3.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-brand-mid-grey">
        {t('contractorDashboard.tileReleased')}
      </p>
      <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums tracking-tight text-state-complete">
        {moneyPair(total, code, null).local}
      </p>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-brand-mid-grey">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-state-complete" />
        {t('contractorDashboard.tileReleasedCount', { n: String(rows.length) })}
      </p>
    </div>
  );
}

function BuildRow({ assigned, hasRework }: { assigned: AssignedProject; hasRework: boolean }) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const money = useProjectMoney(assigned.project.country);
  const { project, stages, activeStage } = assigned;

  const awaiting = stages.some(s => s.status === 'pending_review');
  const due = money.pair(activeStage?.payment_milestone_usd ?? null);

  // A verifier's findings outrank everything else a row could say: that is the one
  // thing on this build waiting on the contractor.
  const state = hasRework
    ? { label: t('contractorDashboard.changesRequested'), tone: 'alert' as const }
    : awaiting
      ? { label: t('contractor.projects.awaitingCheck'),  tone: 'held' as const }
      : activeStage
        ? { label: stageLabel(activeStage),               tone: 'active' as const }
        : { label: t('contractor.projects.nothingActive'), tone: 'locked' as const };

  return (
    <Link to={`/work/projects/${project.id}`}
          className="block rounded-2xl border border-brand-border-grey bg-white px-4 pb-3.5 pt-3 transition-colors hover:border-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 truncate text-sm font-semibold">
          {project.name}
          <span className="ml-2 text-xs font-normal text-brand-mid-grey">
            {[project.city, project.country].filter(Boolean).join(' · ')}
          </span>
        </p>
        <p className={cn('flex shrink-0 items-center gap-1.5 text-xs font-semibold',
          state.tone === 'alert'  && 'text-state-alert',
          state.tone === 'held'   && 'text-state-held',
          state.tone === 'locked' && 'text-brand-mid-grey',
          state.tone === 'active' && 'text-brand-near-black dark:text-white',
        )}>
          <span aria-hidden className={cn('size-1.5 rounded-full',
            state.tone === 'alert'  && 'bg-state-alert',
            state.tone === 'held'   && 'bg-state-held',
            state.tone === 'locked' && 'bg-brand-border-grey',
            state.tone === 'active' && 'bg-brand-near-black dark:bg-white',
          )} />
          {state.label}
        </p>
      </div>

      <StagePipeline stages={stages} className="mb-3" />

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-t border-brand-border-grey pt-2.5 dark:border-[#2c2c2c]">
        <p className="text-xs text-brand-mid-grey">
          {assigned.totalStages > 0
            ? t('contractor.projects.stageOf', { n: assigned.completedStages, total: assigned.totalStages })
            : t('contractor.projects.noStages')}
        </p>
        {due && (
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-mid-grey">
              {t('contractor.projects.colNextRelease')}
            </p>
            <p className="font-mono text-sm font-semibold tabular-nums">{due.local}</p>
            {due.usd && <p className="font-mono text-[11px] text-brand-mid-grey">≈ {due.usd}</p>}
          </div>
        )}
      </div>
    </Link>
  );
}

/**
 * The stage the contractor is standing in, with its work items.
 *
 * Each item ticks itself when a file lands against it — the checkbox here is an
 * OUTPUT, never an input. The real submission happens inside the project, where the
 * upload lives; this is the view of it, and the link through.
 */
function OpenStage({ lead }: { lead: AssignedProject | null }) {
  const t = useT();
  const { stageLabel, substageLabel } = useStageLabels();
  const money = useProjectMoney(lead?.project.country);
  const [substages, setSubstages] = useState<ProjectSubstageRow[] | null>(null);

  const projectId = lead?.project.id ?? null;
  const stageId = lead?.activeStage?.id ?? null;

  useEffect(() => {
    if (!projectId) { setSubstages(null); return; }
    let alive = true;
    fetchSubstages(projectId)
      .then(rows => { if (alive) setSubstages(rows); })
      .catch(() => { if (alive) setSubstages([]); });
    return () => { alive = false; };
  }, [projectId]);

  if (!lead || !lead.activeStage) {
    return (
      <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
          {t('contractorDashboard.stageInProgress')}
        </h2>
        <p className="mt-2 text-sm text-brand-mid-grey">{t('contractorDashboard.noOpenStage')}</p>
      </section>
    );
  }

  const stage = lead.activeStage;
  const items = (substages ?? []).filter(s => s.stage_id === stageId);
  const done = items.filter(s => s.status === 'complete').length;
  const due = money.pair(stage.payment_milestone_usd);

  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
        {t('contractorDashboard.stageInProgress')}
      </h2>

      <div className="mt-2 flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-base font-bold tracking-tight">{stageLabel(stage)}</p>
        {items.length > 0 && (
          <span className="shrink-0 font-mono text-xs text-brand-mid-grey">{done} / {items.length}</span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-brand-mid-grey">
        {lead.project.name} · {t('contractorDashboard.currentStage', { n: stage.stage_number, total: lead.totalStages })}
      </p>

      {substages === null ? (
        <p className="py-6 text-xs text-brand-mid-grey">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-xs text-brand-mid-grey">{t('contractorDashboard.noSubstages')}</p>
      ) : (
        <ul className="mt-3">
          {/* A long stage (eleven items on a storey of blockwork) would push the rest
              of the rail off the screen. The first six, then the way in. */}
          {items.slice(0, 6).map(item => {
            const complete = item.status === 'complete';
            const count = item.evidence_urls?.length ?? 0;
            return (
              <li key={item.id} className="flex items-center gap-3 border-t border-brand-border-grey py-2.5 dark:border-[#2c2c2c]">
                <span aria-hidden className={cn(
                  'flex size-[17px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px]',
                  complete
                    ? 'border-state-complete bg-state-complete text-white'
                    : 'border-brand-border-grey dark:border-[#444]',
                )}>
                  {complete && <Check className="size-2.5 stroke-[3]" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-xs',
                    complete ? 'text-brand-mid-grey' : 'font-semibold')}>
                    {substageLabel(item)}
                  </span>
                  <span className="block text-[11px] text-brand-mid-grey">
                    {count > 0
                      ? t('contractorProject.evidenceCount', { count })
                      : t('contractorProject.noEvidence')}
                  </span>
                </span>
                {!complete && (
                  <Link
                    to={`/work/projects/${lead.project.id}`}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-near-black px-2.5 py-1.5 text-[11px] font-semibold text-white dark:bg-white dark:text-brand-near-black"
                  >
                    <Camera className="size-3" aria-hidden />{t('contractorProject.upload')}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {due && (
        <div className="mt-3 rounded-xl bg-brand-off-white px-3.5 py-3 dark:bg-[#141414]">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-mid-grey">
            {t('contractorDashboard.dueOnApproval')}
          </p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{due.local}</p>
          {due.usd && <p className="font-mono text-[11px] text-brand-mid-grey">≈ {due.usd}</p>}
        </div>
      )}

      <Link to={`/work/projects/${lead.project.id}`}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4">
        {items.length > 6
          ? t('contractorDashboard.andMoreItems', { n: items.length - 6 })
          : t('contractorDashboard.openProject')}
        <ArrowRight className="size-3" aria-hidden />
      </Link>
    </section>
  );
}

