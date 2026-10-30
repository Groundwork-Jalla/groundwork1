import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, ArrowRight, Camera, Check, Handshake, Landmark, Loader2, Plus, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchAssignedProjects, fetchRework, fetchMyPayments, fetchSubstages,
  type AssignedProject, type ReworkItem, type ContractorPayment,
} from '@/lib/supabase/contractor-work';
import type { ProjectSubstageRow } from '@/types/project';
import { fetchMyPayoutDestinations } from '@/lib/supabase/payout-destinations';
import { fetchViewerSummaries, type ViewerSummary } from '@/lib/supabase/project-viewers';
import { fetchOnboardingStatus, onboardingAvailable, ONBOARDING_STEPS,
         type OnboardingStatus } from '@/lib/supabase/contractor-onboarding';
import { myApplicationState, type ApplicationState } from '@/lib/supabase/partner-application';
import { StagePipeline, currentStageNumber } from '@/components/contractor/StagePipeline';
import { useProjectMoney } from '@/lib/budget/use-project-money';
import { moneyPair } from '@/lib/budget/money-pair';
import { useStageLabels } from '@/lib/stage-labels';
import { useT } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
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
  const [partnerState, setPartnerState] = useState<ApplicationState | null>(null);
  /** The client named on each row. Empty map until read; absent key = nobody invited. */
  const [clients, setClients] = useState<Map<string, ViewerSummary>>(new Map());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const assigned = await fetchAssignedProjects();
        if (!alive) return;
        setProjects(assigned);
        setError(null);
        const [r, p, v] = await Promise.all([
          fetchRework(assigned),
          fetchMyPayments(),
          fetchViewerSummaries(assigned.map(a => a.project.id)),
        ]);
        if (!alive) return;
        setRework(r);
        setPayments(p);
        setClients(v);
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

  // Certified partner application (30 Oct 2026, from the working session: "integrate a
  // certified partner application widget"). Its own read for the same reason as the two
  // above — a contractor's builds must not disappear because the partner table did not
  // answer. `null` means not known yet, and the card stays off the page until it is.
  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    myApplicationState(user.id)
      .then(st => { if (alive) setPartnerState(st); })
      .catch(() => { /* unknown is not "has not applied" — show nothing */ });
    return () => { alive = false; };
  }, [user?.id]);

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
          <Plus className="size-4" aria-hidden />{t('contractor.newProject')}
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
          {/* The six progress pips were here. Removed 30 Oct 2026 — "remove
              unnecessary progress trackers". The line above already says how many
              steps are left in words, and a bar that repeats it in colour is the
              same fact drawn twice. */}
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

      {/* Only the data waits. The heading and "Create project" render immediately:
          returning a bare spinner left a contractor on a slow connection with no
          way to start a project at all. */}
      {projects === null && !error && (
        <p className="flex items-center gap-2 py-10 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
        </p>
      )}

      {projects !== null && !error && <>
        {/* Three across at every width, as the designs show. The figures are
            short enough to read at 360px and stacking them pushed the project
            list below the fold. */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Tile label={t('contractorDashboard.tileActiveBuilds')} value={projects.length}
                dot="active" hint={t('contractorDashboard.tileActiveHint', { n: String(activeBuilds) })} />
          {/* Verification is hidden until the feature is finished (30 Oct 2026), so
              neither the tile nor the filter may announce a stage nobody can act on. */}
          <Tile label={t('contractorDashboard.tileNeedsYou')} value={needsYou}
                dot="held" hint={t('contractorDashboard.tileNeedsYouHint')} />
          <ReleasedTile payments={payments} />
        </div>

        {/* Between the tiles and the builds, where Favour asked for it: what the
            three figures above are worth is partly decided by whether this person
            is a certified partner, and somebody who has not applied should meet
            the invitation before they scroll into their project list. */}
        <PartnerCard state={partnerState} />

        {/* One column. The right-hand rail held "Stage in progress", removed
            30 Oct 2026 at Favour's request — the open dot on each build's
            pipeline already says where that build is, and the card repeated it
            for whichever build happened to be first. */}
        <div className="grid min-w-0 items-start gap-5">
          <div className="flex min-w-0 flex-col gap-5">
            <section className="min-w-0">
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-base font-bold tracking-tight">{t('contractorDashboard.yourBuilds')}</h2>
                {projects.length > 0 && (
                  <Link to="/work/projects" className="text-xs text-brand-mid-grey underline underline-offset-2 hover:text-brand-near-black dark:hover:text-white">
                    {t('contractorDashboard.seeAll', { n: projects.length })}
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
                      <BuildRow assigned={a} client={clients.get(a.project.id) ?? null}
                                hasRework={a.stages.some(s => reworkStages.has(s.id))} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* "Recent releases" removed 30 Oct 2026 on Favour's note: the dashboard
                is active projects, what needs doing, and partner status. Payouts is
                the page for what has been paid, and it has the full history. */}
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
    <div className="min-w-0 rounded-2xl border border-brand-border-grey bg-white px-3 py-3 dark:border-[#2c2c2c] dark:bg-[#1e1e1e] sm:px-4 sm:py-3.5">
      <p className="text-[9px] font-bold uppercase leading-tight tracking-wider text-brand-mid-grey sm:text-[10px]">{label}</p>
      {/* A dash, not a zero: "could not read" and "none" are different facts. */}
      <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">
        {value === null ? '—' : value}
      </p>
      {hint && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-tight text-brand-mid-grey sm:text-xs">
          <span aria-hidden className={cn('mt-1 size-1.5 shrink-0 rounded-full',
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

function BuildRow({ assigned, client, hasRework }: {
  assigned: AssignedProject; client: ViewerSummary | null; hasRework: boolean;
}) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const money = useProjectMoney(assigned.project.country);
  const { project, stages, activeStage } = assigned;

  const due = money.pair(activeStage?.payment_milestone_usd ?? null);

  // A verifier's findings outrank everything else a row could say: that is the one
  // thing on this build waiting on the contractor.
  const state = hasRework
    ? { label: t('contractorDashboard.changesRequested'), tone: 'alert' as const }
    : activeStage
      ? { label: stageLabel(activeStage),                 tone: 'active' as const }
      : { label: t('contractor.projects.nothingActive'),  tone: 'locked' as const };

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
          state.tone === 'locked' && 'text-brand-mid-grey',
          state.tone === 'active' && 'text-brand-near-black dark:text-white',
        )}>
          <span aria-hidden className={cn('size-1.5 rounded-full',
            state.tone === 'alert'  && 'bg-state-alert',
            state.tone === 'locked' && 'bg-brand-border-grey',
            state.tone === 'active' && 'bg-brand-near-black dark:bg-white',
          )} />
          {state.label}
        </p>
      </div>

      <StagePipeline stages={stages} className="mb-3" />

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-t border-brand-border-grey pt-3 dark:border-[#2c2c2c]">
        {/* The stage, in its own outlined pill, with when it started and who the
            client is — the shape on the approved dashboard. */}
        <span className="inline-flex flex-wrap items-baseline gap-x-2 rounded-lg border border-brand-border-grey px-3 py-1.5 dark:border-[#2c2c2c]">
          <span className="text-xs font-semibold text-brand-near-black dark:text-white">
            {activeStage
              ? t('contractor.projects.stageNumber', { n: activeStage.stage_number, name: stageLabel(activeStage) })
              : t('contractor.projects.notStarted')}
          </span>
          <span className="text-[11px] text-brand-mid-grey">
            {[
              project.created_at ? t('contractorDashboard.started', { date: formatDate(project.created_at) }) : null,
              client
                ? t(client.accepted ? 'contractorDashboard.clientAccepted' : 'contractorDashboard.clientInvited',
                    { name: client.label })
                : t('contractorDashboard.noClientInvited'),
            ].filter(Boolean).join(' · ')}
          </span>
        </span>

        {due && (
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-mid-grey">
              {t('contractor.projects.colNextRelease')}
            </p>
            <p className="font-mono text-base font-semibold tabular-nums">{due.local}</p>
            {due.usd && <p className="font-mono text-[11px] text-brand-mid-grey">≈ {due.usd}</p>}
          </div>
        )}
      </div>
    </Link>
  );
}


/**
 * Where their certified-partner application stands — or an invitation to start one.
 *
 * Favour, 30 Oct 2026: "let's have the partner network thing there showing their
 * progress, and if they have not, let's have a button asking them to join".
 *
 * So it is one band with two faces. Applied: the four steps, with the ones behind
 * them filled, so the distance left is readable without opening the page. Not
 * applied: what the programme is worth and one button.
 *
 * The steps are the funnel's own, from `partner.track` — the same five words
 * /work/partner uses, minus "Call held", which Groundwork cannot honestly mark: we
 * can see somebody was sent to a calendar, never that they attended. Acceptance is
 * what moves them on.
 *
 * `null` is "not known yet" and renders nothing. A band that flickers "Apply to
 * become a partner" at somebody who already is one is worse than one that waits.
 */
function PartnerCard({ state }: { state: ApplicationState | null }) {
  const t = useT();
  if (state === null) return null;

  // Not shown to a rejected or disqualified applicant. They are not invited to read
  // about it on their dashboard every morning; the page is there if they look.
  if (state === 'rejected' || state === 'disqualified') return null;

  if (state === 'none') {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-border-grey bg-white px-5 py-4 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white">
            <Handshake className="size-4 shrink-0" aria-hidden />
            {t('contractorPartnerCard.title')}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-brand-mid-grey">
            {t('contractorPartnerCard.none')}
          </p>
        </div>
        <Link to="/work/partner"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-near-black px-3.5 py-2 text-xs font-semibold text-white dark:bg-white dark:text-brand-near-black">
          {t('contractorPartnerCard.ctaApply')}<ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </section>
    );
  }

  // How far along they are. `accepted` fills every step; the two in-flight states
  // differ by one, which is the whole reason they are separate states.
  const reached = state === 'accepted' ? 4 : state === 'reviewing' ? 2 : 1;
  const steps = [
    t('partner.track.applied'),
    t('partner.track.qualified'),
    t('partner.track.book'),
    t('partner.track.partner'),
  ];
  const body = state === 'accepted'  ? t('contractorPartnerCard.accepted')
             : state === 'reviewing' ? t('contractorPartnerCard.reviewing')
             : t('contractorPartnerCard.pending');

  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white px-5 py-4 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white">
            <Handshake className="size-4 shrink-0" aria-hidden />
            {t('contractorPartnerCard.title')}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-brand-mid-grey">{body}</p>
        </div>
        <Link to="/work/partner"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-border-grey px-3.5 py-2 text-xs font-semibold text-brand-near-black dark:border-[#2c2c2c] dark:text-white">
          {state === 'accepted' ? t('contractorPartnerCard.ctaOpen') : t('contractorPartnerCard.ctaTrack')}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      <ol className="mt-3.5 grid grid-cols-4 gap-2">
        {steps.map((label, i) => {
          const done = i < reached;
          return (
            <li key={label} className="min-w-0">
              <span className={cn('block h-1 rounded-full',
                done ? 'bg-state-complete' : 'bg-brand-border-grey dark:bg-[#2c2c2c]')} />
              <span className={cn('mt-1.5 block truncate text-[11px]',
                done ? 'font-semibold text-brand-near-black dark:text-white' : 'text-brand-mid-grey')}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
