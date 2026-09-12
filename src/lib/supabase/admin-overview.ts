import { supabase } from './client';
import { ownerLookup } from './admin-users';
import { projectHealth, type ActivityStamps, type ProjectHealth } from '@/lib/admin/health';
import type { ProjectRow, ProjectStageRow } from '@/types/project';

// =========================================================
// Everything the /admin overview needs, in one load.
//
// Six requests in parallel, then the health rules run in the browser. See
// lib/admin/health.ts for why the scoring is client-side.
//
// The activity RPC (084) is the only piece that can be missing — a migration pasted by
// hand can lag a deploy by a day. So it is fail-soft: when the call errors, the page
// still renders with `updated_at` as the only signal and `activityAvailable` tells the
// UI to say so. The alternative — an overview that is blank until someone runs SQL —
// is how a lagging migration turns into "the admin panel is broken".
// =========================================================

export type OverviewProject = Pick<ProjectRow,
  'id' | 'name' | 'user_id' | 'status' | 'tier' | 'tracking_started_at' | 'updated_at'
  | 'current_stage' | 'country' | 'city' | 'budget_usd'
>;

export type OverviewStage = Pick<ProjectStageRow,
  'project_id' | 'stage_number' | 'name' | 'stage_key' | 'status' | 'payment_status' | 'planned_end' | 'completed_at'
>;

export interface ScoredProject extends OverviewProject {
  ownerName: string;
  ownerEmail: string;
  health: ProjectHealth;
  /** Most recent of every activity signal, for the "last update" column. */
  lastActivityAt: string | null;
}

export interface OpsBacklog {
  pendingReviews: number;
  pendingBudgets: number;
  pendingApplications: number;
  openSupport: number;
  openInquiries: number;
  newAgentRequests: number;
}

export interface AuditEntry {
  id: string;
  /** Empty for a person-level row (089): activity with no project, e.g. a client provisioned. */
  projectId: string;
  projectName: string;
  action: string;
  actorName: string;
  /** Who the row is about, when it is about a person (089). Empty otherwise. */
  personName: string;
  entityType: string;
  createdAt: string;
}

export interface AdminOverviewData {
  projects: ScoredProject[];
  /** Stage number → count of tracked, unfinished projects currently on it. */
  pipeline: Map<number, number>;
  backlog: OpsBacklog;
  recent: AuditEntry[];
  /** False when the 084 RPC is not applied; health then leans on updated_at only. */
  activityAvailable: boolean;
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

async function count(table: string, apply: (q: any) => any): Promise<number> {
  const { count: n } = await apply(supabase.from(table).select('id', { count: 'exact', head: true }));
  return n ?? 0;
}

// The 089 columns, with the pre-089 shape as the fallback: a deploy can land before the
// migration is pasted, and PostgREST refuses a select naming a column that is not there
// (42703) rather than returning nulls.
async function recentAudit() {
  const q = (cols: string) => supabase.from('project_audit_log')
    .select(cols)
    .order('created_at', { ascending: false })
    .limit(20);
  const wide = await q('id, project_id, action, actor_id, person_id, entity_type, created_at');
  if (!wide.error || wide.error.code !== '42703') return wide;
  return q('id, project_id, action, actor_id, created_at');
}

export async function loadAdminOverview(now: Date = new Date()): Promise<AdminOverviewData> {
  const [
    projectsRes, stagesRes, activityRes, owners, auditRes,
    pendingReviews, pendingBudgets, pendingApplications, openSupport, openInquiries, newAgentRequests,
  ] = await Promise.all([
    supabase.from('projects')
      .select('id, name, user_id, status, tier, tracking_started_at, updated_at, current_stage, country, city, budget_usd')
      .neq('status', 'archived'),
    supabase.from('project_stages')
      .select('project_id, stage_number, name, stage_key, status, payment_status, planned_end, completed_at'),
    supabase.rpc('admin_project_activity'),
    ownerLookup(),
    recentAudit(),
    count('project_stages', q => q.eq('status', 'pending_review')),
    count('projects', q => q.in('tier', ['jalla_management', 'enterprise']).is('tracking_started_at', null)),
    count('contractor_applications', q => q.eq('status', 'pending')),
    count('support_tickets', q => q.in('status', ['open', 'in_progress'])),
    count('contractor_inquiries', q => q.eq('status', 'open')),
    count('agent_requests', q => q.eq('status', 'new')),
  ]);

  if (projectsRes.error) throw projectsRes.error;
  if (stagesRes.error)   throw stagesRes.error;

  const projects = (projectsRes.data ?? []) as OverviewProject[];
  const stages   = (stagesRes.data ?? []) as OverviewStage[];

  // ── Activity, if the RPC is there ────────────────────────────────────────────────
  const activityAvailable = !activityRes.error;
  const activity = new Map<string, ActivityStamps>();
  if (activityAvailable) {
    for (const r of (activityRes.data ?? []) as Row[]) {
      activity.set(str(r.project_id), {
        lastEvidenceAt: (r.last_evidence_at as string | null) ?? null,
        lastReviewAt:   (r.last_review_at   as string | null) ?? null,
        lastMessageAt:  (r.last_message_at  as string | null) ?? null,
        lastAuditAt:    (r.last_audit_at    as string | null) ?? null,
      });
    }
  }

  const stagesByProject = new Map<string, OverviewStage[]>();
  for (const s of stages) {
    const list = stagesByProject.get(s.project_id) ?? [];
    list.push(s);
    stagesByProject.set(s.project_id, list);
  }

  // ── Score ────────────────────────────────────────────────────────────────────────
  const scored: ScoredProject[] = projects.map(p => {
    const stamps = activity.get(p.id) ?? {};
    const health = projectHealth(p, stagesByProject.get(p.id) ?? [], stamps, now);
    const owner  = owners.get(p.user_id);
    const last   = [stamps.lastEvidenceAt, stamps.lastReviewAt, stamps.lastMessageAt, stamps.lastAuditAt, p.updated_at]
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null;
    return {
      ...p,
      ownerName:  owner?.name  ?? '',
      ownerEmail: owner?.email ?? '',
      health,
      lastActivityAt: last,
    };
  });

  // ── Pipeline: where is everything that is actually being built ───────────────────
  const pipeline = new Map<number, number>();
  for (const p of scored) {
    if (!p.tracking_started_at || p.status === 'completed') continue;
    pipeline.set(p.current_stage, (pipeline.get(p.current_stage) ?? 0) + 1);
  }

  // ── Recent activity, with names resolved client-side (same reason as ownerLookup) ─
  const nameOf = new Map(projects.map(p => [p.id, p.name]));
  const recent: AuditEntry[] = ((auditRes.data ?? []) as unknown as Row[]).map(r => ({
    id:          str(r.id),
    projectId:   str(r.project_id),
    projectName: nameOf.get(str(r.project_id)) ?? '',
    action:      str(r.action),
    actorName:   owners.get(str(r.actor_id))?.name ?? '',
    personName:  owners.get(str(r.person_id))?.name ?? '',
    entityType:  str(r.entity_type),
    createdAt:   str(r.created_at),
  }));

  return {
    projects: scored,
    pipeline,
    backlog: {
      pendingReviews:      num(pendingReviews),
      pendingBudgets:      num(pendingBudgets),
      pendingApplications: num(pendingApplications),
      openSupport:         num(openSupport),
      openInquiries:       num(openInquiries),
      newAgentRequests:    num(newAgentRequests),
    },
    recent,
    activityAvailable,
  };
}
