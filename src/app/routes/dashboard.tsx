import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import {
  Plus,
  ChevronRight, HardHat,
  UserCircle, Check, MessageSquare, FolderArchive, Eye,
} from 'lucide-react';
import { useAuth }                    from '@/contexts/AuthContext';
import { SecurityNudges }             from '@/components/dashboard/SecurityNudges';
import { supabase }                   from '@/lib/supabase/client';
import { fetchParticipantProjects } from '@/lib/supabase/participant-projects';
import { projectBudget } from '@/lib/budget';
import { useProjectMoney } from '@/lib/budget/use-project-money';
import { useT, type TKey } from '@/lib/i18n';
import type { ProjectRow, ProjectStageRow } from '@/types/project';
import { ProjectPayoutSummary } from '@/components/project/ProjectPayoutSummary';
import { useStageLabels } from '@/lib/stage-labels';
import { useDomainLabels } from '@/lib/domain-labels';

// ── Types ──────────────────────────────────────────────────

type ProjectStage = ProjectStageRow;

const isComplete = (s: ProjectStage) => s.status === 'complete';
const isActive   = (s: ProjectStage) => s.status === 'active' || s.status === 'pending_review';

// ── Constants ──────────────────────────────────────────────

const TOTAL_STAGES   = 10;

const PROJECT_STATUS_META: Record<string, { labelKey: TKey; dot: string; badge: string }> = {
  active:    { labelKey: 'common.active',   dot: 'bg-state-active',      badge: 'bg-brand-off-white text-state-active border border-state-active/30'    },
  on_hold:   { labelKey: 'common.onHold',   dot: 'bg-state-held',         badge: 'bg-brand-off-white text-state-held border border-state-held/30'                    },
  completed: { labelKey: 'common.complete', dot: 'bg-brand-mid-grey',    badge: 'bg-brand-off-white text-brand-mid-grey border border-brand-border-grey' },
  archived:  { labelKey: 'common.archived', dot: 'bg-brand-border-grey', badge: 'bg-brand-off-white text-brand-mid-grey border border-brand-border-grey' },
};

// ── Helpers ────────────────────────────────────────────────

function completedStages(p: ProjectRow): number {
  return p.status === 'completed' ? TOTAL_STAGES : Math.max(0, p.current_stage - 1);
}

/** Returns a key, not a string — the greeting was the one untranslated line here. */
function greetingKey(): TKey {
  const h = new Date().getHours();
  if (h < 12) return 'dashboard.goodMorning';
  if (h < 17) return 'dashboard.goodAfternoon';
  return 'dashboard.goodEvening';
}

// ── Shared progress bar ────────────────────────────────────

function HorizBar({ pct, color = 'var(--color-progress-bar-default)' }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-brand-light-grey overflow-hidden">
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(pct, 100)}%` }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      />
    </div>
  );
}

// ── Profile completion ─────────────────────────────────────

/**
 * The three things that actually make an account usable.
 *
 * "ID uploaded" used to be the third of four, which made a brand-new account 50%
 * complete and told the owner the way to finish it was to photograph a passport. Philip
 * asked for it out on 4 Sep 2026 — and it stands whatever SwyChr turns out to return,
 * because payment-name matching is a question about the payment rails, not something to
 * put in front of somebody on their first day.
 *
 * The upload section in the profile is left in place and dormant; this only stops us
 * asking for it unprompted. `pct` is computed from `items.length`, so removing the row
 * is the whole change — a completed profile is now three of three, not three of four.
 */
function ProfileCompletion({ nameSet, hasProject }: {
  nameSet: boolean; hasProject: boolean;
}) {
  const t = useT();
  const items: { label: string; done: boolean }[] = [
    { label: t('dashboard.profileCompletion.accountCreated'), done: true       },
    { label: t('dashboard.profileCompletion.nameSet'),        done: nameSet    },
    { label: t('dashboard.profileCompletion.firstProject'),   done: hasProject },
  ];
  // `hasProject` counts OWNED projects only, and the caller does not render this card
  // at all for somebody whose builds are all shared with them (112, 166). A client
  // whose contractor set the build up has no project of their own to create and never
  // will, so a tracker stuck at 67% would be telling them to undo their own
  // onboarding.
  const count = items.filter(i => i.done).length;
  const pct   = Math.round((count / items.length) * 100);
  if (pct === 100) return null;

  return (
    <div className="bg-white rounded-2xl border border-brand-border-grey p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-full bg-brand-off-white">
            <UserCircle className="size-5 text-brand-mid-grey" />
          </div>
          <div>
            <p className="text-sm font-semibold text-brand-near-black">{t('dashboard.profileCompletion.title')}</p>
            <p className="text-xs text-brand-mid-grey mt-0.5">{t('dashboard.profileCompletion.subtitle')}</p>
          </div>
        </div>
        <span className="text-sm font-bold text-brand-near-black tabular-nums">{pct}%</span>
      </div>
      <div className="mb-4"><HorizBar pct={pct} /></div>
      <div className="grid grid-cols-2 gap-2">
        {items.map(item => (
          <div key={item.label} className="flex items-center gap-2">
            <div className={`flex size-4 shrink-0 items-center justify-center rounded-full ${
              item.done ? 'bg-brand-near-black' : 'border-2 border-brand-border-grey'
            }`}>
              {item.done && <Check className="size-2.5 text-white stroke-3" />}
            </div>
            <span className={`text-xs ${item.done ? 'text-brand-mid-grey line-through' : 'text-brand-near-black font-medium'}`}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Active project hero (Design B) ─────────────────────────
// The one card the dashboard is built around: the build you are actually running.
// Design B's argument is that a dashboard is a place to act, not a place to read
// statistics, so the active project gets the whole top of the page and everything
// else is secondary.

function ActiveProjectHero({ project, stages, stagesLoading, stagesError, onRetryStages, shared, assigned }: {
  project: ProjectRow; stages: ProjectStage[]; stagesLoading: boolean; stagesError: boolean; onRetryStages: () => void;
  /** Somebody else owns this build and invited this person onto it (112, 166). */
  shared: boolean;
  assigned: boolean;
}) {
  const t = useT();
  const money = useProjectMoney(project);
  const { stageLabel } = useStageLabels();
  const { buildingType } = useDomainLabels();

  const done    = stages.filter(isComplete).length;
  const current = stages.find(isActive);
  const pct     = stages.length ? Math.round((done / stages.length) * 100) : 0;
  const { total } = projectBudget(project);

  const meta = [
    buildingType(project.building_type),
    [project.city, project.country].filter(Boolean).join(', '),
  ].filter(Boolean).join(' · ');

  const status = PROJECT_STATUS_META[project.status] ?? PROJECT_STATUS_META.active;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="rounded-2xl border border-brand-green bg-brand-green p-6 sm:p-7"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold tracking-wide text-white/80">
            <span className={`size-1.5 rounded-full ${status.dot}`} />
            {t(status.labelKey)}
          </span>
          {/* Beside the status, not instead of it: whose build this is and how it is
              going are different questions and a client watching their contractor's
              build needs both answered. */}
          {shared && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold tracking-wide text-white/80">
              <Eye className="size-3" aria-hidden="true" />
              {t('dashboard.shared.badge')}
            </span>
          )}
        </div>
        <span className="shrink-0 text-[11px] text-white/40 tabular-nums">
          {stagesLoading
            ? '—'
            : t('dashboard.hero.stageOf', { n: current?.stage_number ?? done, total: stages.length || TOTAL_STAGES })}
        </span>
      </div>

      <h2 className="text-xl font-bold text-white sm:text-2xl">{project.name}</h2>
      <p className="mt-1 text-xs text-white/75">{meta}</p>
      <p className="mt-2 font-mono text-lg font-semibold text-white">{money.local(total, project.budget_amount)}</p>
      {money.pair(total, project.budget_amount)?.usd && <p className="font-mono text-xs text-white/75">≈ {money.pair(total, project.budget_amount)?.usd}</p>}

      <div className="mt-5">
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full rounded-full bg-white"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-white/40">
          <span className="tabular-nums">{stagesLoading ? '—' : t('dashboard.hero.percentComplete', { pct })}</span>
          <span className="truncate pl-3">
            {current ? stageLabel(current) : t('dashboard.stageProgress.notStarted')}
          </span>
        </div>
      </div>

      <div className="mt-5">
        {stagesError ? <p role="alert" className="text-xs text-white">{t('project.review.stagesLoadFailed')}{' '}
          <button type="button" className="font-semibold underline" onClick={onRetryStages}>{t('common.retry')}</button></p>
          : stagesLoading ? <p role="status" className="text-xs text-white/75">{t('common.loading')}</p>
          : <ProjectPayoutSummary project={project} stages={stages} tone="hero" />}
      </div>

      <Link
        to={`${assigned ? '/work/projects' : '/projects'}/${project.id}`}
        className="group mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-brand-near-black transition-colors hover:bg-brand-off-white"
      >
        {t('dashboard.hero.openProject')}
        <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </motion.div>
  );
}

// ── Quick actions (Design B) ───────────────────────────────
// Messages open the current project; documents open the shared file vault.

function QuickActions({ project, unread, documentCount, shared, assigned }: {
  project: ProjectRow | undefined;
  unread: number;
  documentCount: number;
  /** The active build belongs to somebody else. The first card changes; the rest do not. */
  shared: boolean;
  assigned: boolean;
}) {
  const t = useT();
  const projectPath = project ? `${assigned ? '/work/projects' : '/projects'}/${project.id}` : '/projects';

  const actions = [
    // Straight into the conversation. This said "Messages" and went to
    // /notifications — a list of things that had happened, not the thread. With a
    // build open it opens THAT build's messages, because that is the conversation
    // the person on the dashboard means.
    //
    // 9 Nov 2026: with messaging out of the client menu, the project tab is the only
    // place a client is sent for a conversation, so this card is shown only when there
    // is a build for it to open. Without one it used to fall back to the standalone
    // /messages page, which is now a door nothing else points at.
    ...(project ? [{
        to: `${projectPath}?tab=messages`,
        icon: MessageSquare,
        labelKey: 'dashboard.quick.messages' as TKey,
        sub: unread > 0
          ? t('dashboard.quick.messagesSub', { count: unread })
          : t('dashboard.quick.messagesNone'),
      }] : []),
    {
      to: '/documents',
      icon: FolderArchive,
      labelKey: 'dashboard.quick.documents' as TKey,
      sub: t('dashboard.quick.documentsSub', { count: documentCount }),
    },
    // The "Contractors" card went with the sidebar item on 9 Nov 2026. It opened the
    // published directory — people the client has not hired — from the page they come
    // to for the build they are in the middle of.
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {actions.map(({ to, icon: Icon, labelKey, sub }) => (
        <Link
          key={labelKey}
          to={to}
          className="group flex items-center gap-3.5 rounded-2xl border border-brand-border-grey bg-white p-4 transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-off-white transition-colors group-hover:bg-brand-near-black dark:bg-[#252525]">
            <Icon className="size-4.5 text-brand-mid-grey transition-colors group-hover:text-white" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-brand-near-black dark:text-white">{t(labelKey)}</span>
            <span className="block truncate text-xs text-brand-mid-grey">{sub}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

function OtherProjectRow({ project, shared, assigned }: { project: ProjectRow; shared: boolean; assigned: boolean }) {
  const t = useT();
  const money = useProjectMoney(project);
  const { buildingType } = useDomainLabels();
  const { total } = projectBudget(project);
  const status = PROJECT_STATUS_META[project.status] ?? PROJECT_STATUS_META.active;
  const budgetPair = money.pair(total);

  return (
    <Link
      to={`${assigned ? '/work/projects' : '/projects'}/${project.id}`}
      className="flex items-center gap-4 rounded-2xl border border-brand-border-grey bg-white p-4 transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
    >
      <span className={`size-2 shrink-0 rounded-full ${status.dot}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-brand-near-black dark:text-white">
          <span className="truncate">{project.name}</span>
          {/* An icon, not a word: the row is one line and the name has to survive on a
              phone. The title attribute carries the same thing for a pointer, and the
              screen-reader text for everyone else. */}
          {shared && (
            <Eye className="size-3.5 shrink-0 text-brand-mid-grey" aria-label={t('dashboard.shared.badge')} />
          )}
        </p>
        <p className="truncate text-xs text-brand-mid-grey">
          {[
            buildingType(project.building_type),
            [project.city, project.country].filter(Boolean).join(', '),
            t('dashboard.card.stages', { done: completedStages(project), total: TOTAL_STAGES }),
          ].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-sm font-bold tabular-nums text-brand-near-black dark:text-white">
          {total > 0 ? budgetPair?.local : '—'}
        </p>
        {total > 0 && budgetPair?.usd && <p className="mt-1 font-mono text-xs text-brand-mid-grey">{budgetPair.usd}</p>}
      </div>
      <ChevronRight className="size-4 shrink-0 text-brand-border-grey" />
    </Link>
  );
}

// ── Empty state ────────────────────────────────────────────

function EmptyBuilds() {
  const t = useT();

  return (
    <Link to="/projects/new"
      className="flex flex-col items-center justify-center gap-5 rounded-2xl border-2 border-dashed border-brand-border-grey p-12 hover:border-brand-near-black hover:bg-white transition-all group text-center">
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
        className="flex size-16 items-center justify-center rounded-full bg-brand-off-white group-hover:bg-brand-near-black transition-colors">
        <HardHat className="size-8 text-brand-mid-grey group-hover:text-white transition-colors" />
      </motion.div>
      <div>
        <p className="text-base font-semibold text-brand-near-black mb-1">{t('dashboard.empty.title')}</p>
        <p className="text-sm text-brand-mid-grey leading-relaxed max-w-xs mx-auto">
          {t('dashboard.empty.body')}
        </p>
      </div>
      <span className="inline-flex items-center gap-2 rounded-xl bg-brand-green text-white text-sm font-semibold px-6 py-3 group-hover:bg-brand-green-hover transition-colors">
        <Plus className="size-4" /> {t('dashboard.empty.cta')}
      </span>
    </Link>
  );
}

// ── Dashboard ──────────────────────────────────────────────

export default function Dashboard() {
  const { user, isContractor } = useAuth();
  const t = useT();
  // From `user_roles` and accepted assignments, via AuthContext — NOT from
  // `user_metadata.role`, which is set by the browser at signup and which migration
  // 100 stopped writing. That check had been false for every contractor since, so a
  // partner who created a project for their client opened it and saw the CLIENT's
  // view, complete with an invitation to invite a contractor. Reported 29 October.

  const [projects,      setProjects]      = useState<ProjectRow[]>([]);
  // Which of `projects` this person does not own. Separate from the list rather than a
  // flag on the rows, because `ProjectRow` is the database row and nothing that is not
  // a column belongs on it.
  const [sharedIds,     setSharedIds]     = useState<Set<string>>(() => new Set());
  const [assignedIds, setAssignedIds] = useState<Set<string>>(() => new Set());
  const [ownedCount,    setOwnedCount]    = useState(0);
  const [loading,       setLoading]       = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [stageAttempt, setStageAttempt] = useState(0);
  const [stageRead, setStageRead] = useState<{ projectId: string; status: 'loading' | 'ready' | 'error'; rows: ProjectStage[] }>({ projectId: '', status: 'loading', rows: [] });
  const [unreadCount,      setUnreadCount]      = useState(0);
  const [documentCount,    setDocumentCount]    = useState(0);

  const displayName = user?.user_metadata?.full_name
    ?? user?.email?.split('@')[0]
    ?? 'there';
  const nameSet    = !!user?.user_metadata?.full_name;

  const visibleProjects = projects.filter(p => p.status !== 'archived');

  const activeProject = visibleProjects
    .filter(p => p.status === 'active')
    .sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime())[0]
    ?? visibleProjects[0];


  useEffect(() => {
    if (!user) return;
    let live = true;

    // A contractor's builds come from their accepted invitations. A client's come from
    // two places — the ones they created and the ones they were invited onto (112,
    // 166) — and until 9 Nov 2026 this page only ever asked for the first, so a client
    // whose contractor set the build up was shown an empty dashboard and offered a
    // wizard.
    setLoading(true);
    setLoadFailed(false);
    const loader = fetchParticipantProjects(user.id, isContractor);

    loader
      .then(({ all, shared, owned, assigned, loadFailed: failed }) => {
        if (!live) return;
        setProjects(all);
        setSharedIds(new Set(shared.map(p => p.id)));
        setOwnedCount(owned.length);
        setAssignedIds(new Set(assigned.map(p => p.id)));
        setLoadFailed(!!failed);
      })
      .catch(() => { if (live) setLoadFailed(true); })
      .finally(() => { if (live) setLoading(false); });

    return () => { live = false; };
  }, [user, isContractor, loadAttempt]);

  useEffect(() => {
    const projectId = activeProject?.id;
    if (!projectId) return;
    let live = true;
    setStageRead({ projectId, status: 'loading', rows: [] });
    void (async () => {
      try {
        const { data, error } = await supabase.from('project_stages').select('*')
          .eq('project_id', projectId).order('stage_number');
        if (error) throw error;
        if (live) setStageRead({ projectId, status: 'ready', rows: data ?? [] });
      } catch {
        if (live) setStageRead({ projectId, status: 'error', rows: [] });
      }
    })();
    return () => { live = false; };
  }, [activeProject?.id, stageAttempt]);
  const currentStages = stageRead.projectId === activeProject?.id ? stageRead : null;

  // Counts behind the quick-action subtitles. Head-only queries — we want the
  // number, never the rows. Failures leave the count at 0 and the tile still
  // works as a link, so a slow table never blocks the dashboard rendering.
  useEffect(() => {
    if (!user || projects.length === 0) return;
    const ids = projects.map(p => p.id);

    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('read_at', null)          // unread is a null timestamp, not a boolean
      .then(({ count }) => setUnreadCount(count ?? 0));

    supabase
      .from('project_documents')
      .select('id', { count: 'exact', head: true })
      .in('project_id', ids)
      .then(({ count }) => setDocumentCount(count ?? 0));

    // The accepted-contractor count was read here for the "Contractors" quick action.
    // That card went on 9 Nov 2026, and a count nothing renders is a query every
    // dashboard load pays for and nobody sees.
  }, [user, projects]);

  const otherProjects = visibleProjects.filter(p => p.id !== activeProject?.id);

  /**
   * The invited-client path.
   *
   * Every build this person can see belongs to somebody else. They did not come here
   * to start a project — their project already exists and somebody else is running it
   * — so the three things this page uses to push a new client toward the wizard are
   * all wrong for them: the New Project button, the profile tracker whose last item is
   * "First project created", and the dashed Create a build strip at the bottom.
   *
   * Not the same test as "has no projects". Somebody with one of their own and one
   * shared with them is on the ordinary path and keeps all three.
   */
  const viewerOnly = !isContractor && !loading && ownedCount === 0 && projects.length > 0;

  return (
    // Design B: focus-forward. One active build owns the top of the page; everything
    // else is secondary. The dense stat grid Design A used lives on /projects now.
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 pb-24 sm:px-6 md:pb-8">

      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-brand-mid-grey">{t(greetingKey())}</p>
          <h1 className="mt-1 text-2xl font-bold text-brand-near-black dark:text-white">{displayName}</h1>
        </div>
        {/* Primary action kept in the header for quick project creation. */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {!isContractor && !viewerOnly && (
            <Link to="/projects/new"
              data-tour="new-project"
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-brand-green px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-green-hover">
              <Plus className="size-4" /> {t('dashboard.newProject')}
            </Link>
          )}
        </div>
      </div>

      {/* Above everything else, for everyone: an account that cannot be recovered or
          that anyone with the password can enter is a bigger problem than an empty
          profile. Renders nothing once both are handled. */}
      <SecurityNudges user={user} showTwoFactor={false} />

      {loadFailed && (
        <div role="alert" className="rounded-xl border border-brand-border-grey p-4 text-sm">
          <p>{t('projects.loadFailed')}</p>
          <button type="button" onClick={() => setLoadAttempt(n => n + 1)}
            className="mt-2 font-semibold underline underline-offset-4">{t('common.retry')}</button>
        </div>
      )}

      {!loading && !isContractor && !viewerOnly && (
        <ProfileCompletion nameSet={nameSet} hasProject={ownedCount > 0} />
      )}

      {loading ? (
        <div className="h-72 animate-pulse rounded-2xl bg-brand-light-grey dark:bg-[#1e1e1e]" />
      ) : activeProject ? (
        <>
          <ActiveProjectHero
            project={activeProject}
            stages={currentStages?.rows ?? []}
            stagesLoading={currentStages?.status !== 'ready'}
            stagesError={currentStages?.status === 'error'}
            onRetryStages={() => setStageAttempt(value => value + 1)}
            shared={sharedIds.has(activeProject.id)}
            assigned={assignedIds.has(activeProject.id)}
          />

          <QuickActions
            project={activeProject}
            unread={unreadCount}
            documentCount={documentCount}
            shared={sharedIds.has(activeProject.id)}
            assigned={assignedIds.has(activeProject.id)}
          />

        </>
      ) : loadFailed ? null : isContractor ? (
        <div className="rounded-2xl border border-dashed border-brand-border-grey p-6 text-sm text-brand-mid-grey">
          {t('dashboard.empty.contractor')}
        </div>
      ) : (
        <EmptyBuilds />
      )}

      {otherProjects.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-wide text-brand-mid-grey">
              {t('dashboard.otherProjects')}
            </h2>
            <Link to="/projects" className="text-xs font-medium text-brand-mid-grey transition-colors hover:text-brand-near-black">
              {t('common.viewAll')} →
            </Link>
          </div>
          <div className="space-y-2.5">
            {otherProjects.slice(0, 3).map((p, i) => (
              <motion.div key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}>
                <OtherProjectRow project={p} shared={sharedIds.has(p.id)} assigned={assignedIds.has(p.id)} />
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {!loading && !isContractor && !viewerOnly && projects.length > 0 && (
        <Link
          to="/projects/new"
          className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-border-grey py-4 text-sm font-semibold text-brand-mid-grey transition-colors hover:border-brand-near-black hover:text-brand-near-black"
        >
          <Plus className="size-4" /> {t('dashboard.newProject')}
        </Link>
      )}
    </div>
  );
}
