import type {
  ProjectRow, ProjectStageRow, ProjectSubstageRow, ProjectFeeRow, ProjectDocumentRow, ContractorInviteRow,
} from '@/types/project';
import type { SiteUpdate } from '@/lib/supabase/site-updates';
import type { StageVerification } from '@/lib/supabase/verifications';
import type { ProjectVerifier } from '@/lib/supabase/verifiers';
import type { Payment } from '@/lib/supabase/payments';
import type { Conversation, Decision } from '@/lib/supabase/conversations';
import type { ProjectActivityRow } from '@/lib/supabase/activity';
import { availableFunds, stageLifecycle, STATE_SEVERITY, type StageBlocker, type StageLifecycle, type StageLifecycleState } from '@/lib/lifecycle/stage';
import { entityTab } from './action-labels';

// =========================================================
// The Project Workspace's model (05 §5–§10), assembled from rows.
//
// PURE. This file takes what the readers returned and produces what every tab renders;
// it touches no network, no clock it was not handed, and stores nothing. The I/O half —
// which reader to call, what to do when a migration is not applied — lives in
// `lib/supabase/workspace.ts`. Splitting them is what lets `workspace.test.ts` feed this
// a project with a rejected verification, a funded tranche and an on-hold status and
// assert what the Stages tab will say, without a database.
//
// The operational loop this reads out (Phase 3 §2):
//   Project → Stage → Evidence → Verification → Approval → Payment eligibility →
//   Release / disbursement → next stage
// Every step's state is DERIVED here through `stageLifecycle()` and thrown away. Nothing
// in this file reads `project_stages.payment_status`; that column is a projection of the
// same ledger for older screens, and the Financials tab shows it labelled as such.
// =========================================================

/** Someone with an account: resolved once from `admin_list_users()`, by id. */
export interface Person { id: string; name: string; email: string }
export type PersonLookup = Map<string, { name: string; email: string }>;

/** A fail-soft domain: rows, or none with `available: false` when its migration is absent. */
export interface Soft<T> { rows: T[]; available: boolean }

/** Everything the readers produced, before any derivation. */
export interface WorkspaceRaw {
  project: ProjectRow;
  stages: ProjectStageRow[];
  substages: ProjectSubstageRow[];
  fees: ProjectFeeRow[];
  people: PersonLookup;
  siteUpdates: Soft<SiteUpdate>;
  verifications: Soft<StageVerification>;
  verifiers: Soft<ProjectVerifier>;
  payments: Soft<Payment>;
  conversations: Soft<Conversation>;
  decisions: Soft<Decision>;
  documents: Soft<ProjectDocumentRow>;
  invites: Soft<ContractorInviteRow>;
  activity: Soft<ProjectActivityRow>;
}

export interface StageView {
  stage: ProjectStageRow;
  substages: ProjectSubstageRow[];
  /** The one derived lifecycle — never stored, recomputed on every load. */
  lifecycle: StageLifecycle;
  latestVerification: StageVerification | null;
  /** Every verification on the stage, newest request first. */
  verifications: StageVerification[];
  /** Every site update on the stage, newest first. */
  siteUpdates: SiteUpdate[];
  /** The stage's incoming tranche (090 seeds one per stage with a milestone). */
  tranche: Payment | null;
  /** The newest outgoing row for the stage, live or failed. */
  release: Payment | null;
  /** From the verified decision, when one issued a certificate (079/087). */
  certificateId: string | null;
  /** True when the stage after this one has started (or this is the last stage). */
  nextStageStarted: boolean;
}

export interface OpenBlocker {
  stageNumber: number;
  stageId: string;
  state: StageLifecycleState;
  blocker: StageBlocker;
}

export interface WorkspaceFinancials {
  /** False when 090 is not applied: every figure below is then 0 and must not be shown as a fact. */
  available: boolean;
  budgetUsd: number;
  /** Sum of `in` rows that are funded or reconciled. */
  funded: number;
  /** Sum of `out` rows still only authorised. */
  authorised: number;
  /** Sum of `out` rows initiated or reconciling — money in motion. */
  inFlight: number;
  /** Sum of `out` rows disbursed. */
  disbursed: number;
  /** `availableFunds()` — what could still be released. */
  availableFunds: number;
  payments: Payment[];
  fees: ProjectFeeRow[];
}

export interface TeamContractor extends ContractorInviteRow {
  /** Resolved from the accepted account; the invite email otherwise. */
  name: string;
}
export interface TeamVerifier extends ProjectVerifier { name: string; email: string }

export interface WorkspaceTeam {
  owner: Person | null;
  contractors: TeamContractor[];
  verifiers: TeamVerifier[];
}

export interface ActivityEntry extends ProjectActivityRow {
  actorName: string;
  personName: string;
  /** Which tab the entity chip opens, or null when the entity has no tab. */
  tab: ReturnType<typeof entityTab>;
}

export type WorkspaceDomain =
  'siteUpdates' | 'verifications' | 'verifiers' | 'ledger' | 'conversations' | 'decisions' | 'documents' | 'invites' | 'activity';

export interface Workspace {
  project: ProjectRow;
  stages: StageView[];
  /** The stage `projects.current_stage` points at, when it exists. */
  currentStage: StageView | null;
  /** Every blocker on every stage, worst state first — the Overview tab's list. */
  openBlockers: OpenBlocker[];
  financials: WorkspaceFinancials;
  team: WorkspaceTeam;
  siteUpdates: SiteUpdate[];
  documents: ProjectDocumentRow[];
  conversations: Conversation[];
  decisions: Decision[];
  /** Newest first, names resolved. The Overview's "last 5" is `activity.slice(0, 5)`. */
  activity: ActivityEntry[];
  available: Record<WorkspaceDomain, boolean>;
  loadedAt: string;
}

const person = (people: PersonLookup, id: string | null | undefined): Person | null => {
  if (!id) return null;
  const hit = people.get(id);
  return hit ? { id, name: hit.name, email: hit.email } : null;
};
/** A display name: profile name, then the address they sign in with, then nothing. */
const nameOf = (people: PersonLookup, id: string | null | undefined): string => {
  const p = person(people, id);
  return p ? (p.name || p.email) : '';
};

function newestVerification(rows: StageVerification[]): StageVerification | null {
  return rows.length ? rows.reduce((a, b) => (b.requestedAt > a.requestedAt ? b : a)) : null;
}

export function assembleWorkspace(raw: WorkspaceRaw, now: Date = new Date()): Workspace {
  const { project, people } = raw;
  const stages = [...raw.stages].sort((a, b) => a.stage_number - b.stage_number);

  const substagesBy = new Map<string, ProjectSubstageRow[]>();
  for (const s of raw.substages) substagesBy.set(s.stage_id, [...(substagesBy.get(s.stage_id) ?? []), s]);
  const updatesBy = new Map<string, SiteUpdate[]>();
  for (const u of raw.siteUpdates.rows) updatesBy.set(u.stageId, [...(updatesBy.get(u.stageId) ?? []), u]);
  const verificationsBy = new Map<string, StageVerification[]>();
  for (const v of raw.verifications.rows) verificationsBy.set(v.stageId, [...(verificationsBy.get(v.stageId) ?? []), v]);

  // `null`, not `[]`, when the ledger is not there: stageLifecycle() treats null as "do
  // not evaluate eligibility", and an empty ledger as "nothing funded" — different facts.
  const ledger = raw.payments.available ? raw.payments.rows : null;

  const views: StageView[] = stages.map((stage, i) => {
    const next = stages[i + 1];
    const nextStageStarted = next ? next.status !== 'locked' : true;
    const mine = (verificationsBy.get(stage.id) ?? []).slice().sort((a, b) => (b.requestedAt > a.requestedAt ? 1 : -1));
    const updates = (updatesBy.get(stage.id) ?? []).slice().sort((a, b) => (b.submittedAt > a.submittedAt ? 1 : -1));
    const latest = newestVerification(mine);
    const outs = (ledger ?? []).filter(p => p.direction === 'out' && p.stageId === stage.id);

    return {
      stage,
      substages: (substagesBy.get(stage.id) ?? []).slice().sort((a, b) => a.substage_number - b.substage_number),
      lifecycle: stageLifecycle(
        { id: stage.id, status: stage.status, stage_number: stage.stage_number,
          verification_required: stage.verification_required ?? false, payment_milestone_usd: stage.payment_milestone_usd ?? null },
        raw.verifications.rows,
        { status: project.status },
        nextStageStarted,
        updates[0]?.submittedAt ?? null,
        ledger,
      ),
      latestVerification: latest,
      verifications: mine,
      siteUpdates: updates,
      tranche: (ledger ?? []).find(p => p.direction === 'in' && p.stageId === stage.id) ?? null,
      release: outs.length ? outs.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)) : null,
      certificateId: mine.find(v => v.decision === 'verified' && v.certificateId)?.certificateId ?? null,
      nextStageStarted,
    };
  });

  const openBlockers: OpenBlocker[] = views
    .flatMap(v => v.lifecycle.blockers.map(blocker => ({
      stageNumber: v.stage.stage_number, stageId: v.stage.id, state: v.lifecycle.state, blocker,
    })))
    .sort((a, b) => STATE_SEVERITY[a.state] - STATE_SEVERITY[b.state] || a.stageNumber - b.stageNumber);

  const pays = raw.payments.rows;
  const sum = (pred: (p: Payment) => boolean) => pays.filter(pred).reduce((a, p) => a + p.amount, 0);
  const financials: WorkspaceFinancials = {
    available:  raw.payments.available,
    budgetUsd:  Number(project.budget_usd ?? 0),
    funded:     sum(p => p.direction === 'in'  && (p.state === 'funded' || p.state === 'reconciled')),
    authorised: sum(p => p.direction === 'out' && p.state === 'release_authorised'),
    inFlight:   sum(p => p.direction === 'out' && (p.state === 'initiated' || p.state === 'reconciling')),
    disbursed:  sum(p => p.direction === 'out' && p.state === 'disbursed'),
    availableFunds: raw.payments.available ? availableFunds(pays) : 0,
    payments: pays,
    fees: raw.fees,
  };

  const team: WorkspaceTeam = {
    owner: person(people, project.user_id),
    contractors: raw.invites.rows.map(inv => ({ ...inv, name: nameOf(people, inv.contractor_user_id) || inv.email })),
    verifiers: raw.verifiers.rows.map(v => {
      const p = person(people, v.userId);
      return { ...v, name: p?.name || p?.email || '', email: p?.email ?? '' };
    }),
  };

  const activity: ActivityEntry[] = [...raw.activity.rows]
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map(r => ({ ...r, actorName: nameOf(people, r.actorId), personName: nameOf(people, r.personId), tab: entityTab(r.entityType) }));

  return {
    project,
    stages: views,
    currentStage: views.find(v => v.stage.stage_number === project.current_stage) ?? null,
    openBlockers,
    financials,
    team,
    siteUpdates: [...raw.siteUpdates.rows].sort((a, b) => (b.submittedAt > a.submittedAt ? 1 : -1)),
    documents: raw.documents.rows,
    conversations: raw.conversations.rows,
    decisions: raw.decisions.rows,
    activity,
    available: {
      siteUpdates:   raw.siteUpdates.available,
      verifications: raw.verifications.available,
      verifiers:     raw.verifiers.available,
      ledger:        raw.payments.available,
      conversations: raw.conversations.available,
      decisions:     raw.decisions.available,
      documents:     raw.documents.available,
      invites:       raw.invites.available,
      activity:      raw.activity.available,
    },
    loadedAt: now.toISOString(),
  };
}
