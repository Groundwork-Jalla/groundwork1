import { supabase } from './client';
import { ownerLookup } from './admin-users';
import { isMissingTable } from '@/lib/errors';
import { getCrmStatus, listCrmBacklog, listSyncFailures, type CrmStatus } from './admin-applications';
import { listOpenSupportTickets } from './support';
import { listAdminUsers } from './admin-users';
import { listApplications, listDirectory, listWaitlist } from './admin-applications';
import { fetchApplicationDrafts } from './application-drafts';
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
  /** Stage rows complete / total — progress is this ratio, nothing estimated. */
  stagesComplete: number;
  stagesTotal: number;
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

export interface LocationCount { country: string; city: string | null; count: number }
export interface OpenTicket { id: string; subject: string; who: string; status: string; createdAt: string }
export interface CrmState {
  /** null when the status call itself failed (not signed in as admin, function down). */
  status: CrmStatus | null;
  /** Outbox rows still to deliver, and rows that failed. */
  backlog: number;
  failures: number;
  /** Newest inbound webhook event and newest outbox row, when readable. */
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
}

/** One step of the real contractor funnel. `status` is the database's own value. */
export interface FunnelStep { key: string; count: number; to: string }
/** Contractors grouped by a real column on the directory row. */
export interface DistributionSlice { label: string; count: number }

export interface AdminOverviewData {
  /** The signed-in admin's own name, from their profile — for the greeting. */
  viewerName: string;
  /** Every account the admin may list (admin_list_users). null when the call failed. */
  totalUsers: number | null;
  /** contractor_inquiries still open. */
  quoteRequests: number | null;
  /** waitlist → started → pending → reviewing → accepted, from the real rows. */
  funnel: FunnelStep[] | null;
  /** Published contractors by trade — the directory's own column. */
  contractorsByTrade: DistributionSlice[] | null;
  /** The same contractors by the `location` they entered. Free text, shown as stored. */
  contractorsByLocation: DistributionSlice[] | null;
  projects: ScoredProject[];
  /** Stage number → count of tracked, unfinished projects currently on it. */
  pipeline: Map<number, number>;
  backlog: OpsBacklog;
  recent: AuditEntry[];
  /** False when the 084 RPC is not applied; health then leans on updated_at only. */
  activityAvailable: boolean;
  /** Real aggregation of projects.country / city — a table, not a map (no pins until Phase 7). */
  locations: LocationCount[];
  /** conversations.status <> 'resolved' (091). null when the table is not there yet. */
  openConversations: number | null;
  /** Open and in-progress support tickets, newest first. */
  tickets: OpenTicket[];
  crm: CrmState;
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
  // Independent, fail-soft: 091's table may not be there; the CRM status call may fail;
  // neither may hide the page. Every miss is reported as null / empty, never as a number.
  const [convRes, ticketsRes, crmStatusRes, outboxRes, failuresRes, inboundRes,
         usersRes, quotesRes, appsRes, waitlistRes, draftsRes, directoryRes] = await Promise.allSettled([
    supabase.from('conversations').select('id', { count: 'exact', head: true }).neq('status', 'resolved'),
    listOpenSupportTickets(5),
    getCrmStatus(),
    listCrmBacklog(),
    listSyncFailures(),
    supabase.from('ghl_inbound_events').select('created_at').order('created_at', { ascending: false }).limit(1),
    listAdminUsers(),
    count('contractor_inquiries', q => q.eq('status', 'open')),
    listApplications(),
    listWaitlist(),
    fetchApplicationDrafts(true),
    listDirectory(),
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
    const mine = stagesByProject.get(p.id) ?? [];
    return {
      ...p,
      stagesComplete: mine.filter(s => s.status === 'complete').length,
      stagesTotal: mine.length,
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
  // Names for every project the audit log can reference — including archived ones, which
  // the scored list excludes. Without this an older row shows a raw uuid as its project.
  const nameOf = new Map(projects.map(p => [p.id, p.name]));
  const auditProjectIds = [...new Set(((auditRes.data ?? []) as unknown as Row[])
    .map(r => str(r.project_id)).filter(id => id && !nameOf.has(id)))];
  if (auditProjectIds.length > 0) {
    const { data: extra } = await supabase.from('projects').select('id, name').in('id', auditProjectIds);
    for (const p of (extra ?? []) as unknown as Row[]) nameOf.set(str(p.id), str(p.name));
  }
  // An account with no profile name falls back to the address it signs in with — which
  // is a fact about the account — rather than to a blank. The blank was showing as
  // "— approved a stage", which reads as an unattributed action on an audit log.
  const who = (id: string) => {
    const hit = owners.get(id);
    return hit ? (hit.name || hit.email) : '';
  };
  const recent: AuditEntry[] = ((auditRes.data ?? []) as unknown as Row[]).map(r => ({
    id:          str(r.id),
    projectId:   str(r.project_id),
    projectName: nameOf.get(str(r.project_id)) ?? '',
    action:      str(r.action),
    actorName:   who(str(r.actor_id)),
    personName:  who(str(r.person_id)),
    entityType:  str(r.entity_type),
    createdAt:   str(r.created_at),
  }));

  // ── Locations: a real GROUP BY over the rows already loaded ────────────────────────
  const locMap = new Map<string, LocationCount>();
  for (const p of projects) {
    const country = (p.country ?? '').toUpperCase() || '—';
    const city = p.city?.trim() || null;
    const key = `${country}|${city ?? ''}`;
    const cur = locMap.get(key) ?? { country, city, count: 0 };
    cur.count += 1; locMap.set(key, cur);
  }
  const locations = [...locMap.values()].sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));

  const openConversations =
    convRes.status === 'fulfilled' && !convRes.value.error ? (convRes.value.count ?? 0)
    : convRes.status === 'fulfilled' && isMissingTable(convRes.value.error) ? null
    : null;

  const tickets: OpenTicket[] = ticketsRes.status === 'fulfilled'
    ? ticketsRes.value.map(t => ({ id: t.id, subject: t.subject, who: t.name || t.email, status: t.status, createdAt: t.created_at }))
    : [];

  const outbox = outboxRes.status === 'fulfilled' ? outboxRes.value : [];
  const crm: CrmState = {
    status:         crmStatusRes.status === 'fulfilled' ? crmStatusRes.value : null,
    backlog:        outbox.filter(r => r.status === 'pending').length,
    failures:       failuresRes.status === 'fulfilled' ? failuresRes.value.length : 0,
    lastInboundAt:  inboundRes.status === 'fulfilled' && !inboundRes.value.error ? (str((inboundRes.value.data?.[0] as Row | undefined)?.created_at) || null) : null,
    lastOutboundAt: outbox.length ? outbox.map(r => r.created_at).sort().at(-1) ?? null : null,
  };

  // The viewer's own name. `ownerLookup()` is already loaded and keyed by user id, so
  // this costs nothing beyond the session read — and it is their real profile name, not
  // the local part of their email address.
  const { data: auth } = await supabase.auth.getUser();
  const viewerName = (auth.user ? owners.get(auth.user.id)?.name : '') || '';

  // ── The contractor funnel, from the rows themselves ────────────────────────────────
  const apps = appsRes.status === 'fulfilled' ? appsRes.value : null;
  const byStatus = (st: string) => apps?.filter(a => a.status === st).length ?? 0;
  const funnel: FunnelStep[] | null = apps
    ? [
        { key: 'waitlist',  count: waitlistRes.status === 'fulfilled' ? waitlistRes.value.length : 0, to: '/admin/waitlist' },
        { key: 'started',   count: draftsRes.status === 'fulfilled' ? draftsRes.value.length : 0,     to: '/admin/drafts' },
        { key: 'pending',   count: byStatus('pending'),   to: '/admin/applications' },
        { key: 'reviewing', count: byStatus('reviewing'), to: '/admin/applications' },
        { key: 'accepted',  count: byStatus('accepted'),  to: '/admin/applications' },
      ]
    : null;

  // ── Contractor distribution — the directory's own columns, nothing derived ────────
  // Both dimensions are computed because "distribution" has two readings and both are
  // real: `trade` is the enum the contractor picked on the form, `location` is the free
  // text they typed. Neither is normalised here — a value is shown as it was stored.
  let contractorsByTrade: DistributionSlice[] | null = null;
  let contractorsByLocation: DistributionSlice[] | null = null;
  if (directoryRes.status === 'fulfilled') {
    const directory = directoryRes.value;
    const group = (pick: (c: (typeof directory)[number]) => string) => {
      const by = new Map<string, number>();
      for (const c of directory) {
        const label = pick(c).trim();
        if (!label) continue;
        by.set(label, (by.get(label) ?? 0) + 1);
      }
      return [...by].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    };
    contractorsByTrade    = group(c => c.trade ?? '');
    contractorsByLocation = group(c => c.location ?? '');
  }

  return {
    viewerName,
    totalUsers:    usersRes.status === 'fulfilled' ? usersRes.value.length : null,
    quoteRequests: quotesRes.status === 'fulfilled' ? num(quotesRes.value) : null,
    funnel,
    contractorsByTrade,
    contractorsByLocation,
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
    locations,
    openConversations,
    tickets,
    crm,
  };
}
