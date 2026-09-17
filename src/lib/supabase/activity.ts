import { supabase } from './client';

// =========================================================
// The activity model (089): project_audit_log is the one record of what happened.
//
// Nothing here writes an audit row. The browser lost that ability in 089 — an audit row
// exists only because a definer function wrote it, in the same transaction as the change
// it describes. What lives here are the two stage transitions that were still done from
// the browser with a hand-written audit row beside them, now one RPC each, plus the
// "089 not applied yet" test their callers use to fall back to the old path.
// =========================================================

/** Is this "the function does not exist yet" — a migration that has not been run? */
export function isMissingRpc(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as Record<string, unknown>).code;
  return code === 'PGRST202' || code === '42883';
}

/**
 * Owner submits a stage for review (Jalla Verify / Jalla Management). The database
 * re-checks ownership, tier, `active`, paid, and that every substage is pending review or
 * complete; refuses with `not_owner:`, `self_verify:`, `wrong_state:`, `not_paid:` or
 * `substages_not_ready:`. Writes `stage_submitted_for_review` itself.
 */
export async function submitStageForReview(stageId: string): Promise<void> {
  const { error } = await supabase.rpc('submit_stage_for_review', { p_stage: stageId });
  if (error) throw error;
}

/**
 * Admin sends a pending-review stage back to active and its reviewed substages back to
 * in_progress. Refuses `not_admin:` and `wrong_state:`. Writes `rework_requested` itself.
 * The bell and the email are the caller's, after this returns.
 */
export async function requestRework(stageId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('request_rework', { p_stage: stageId, p_reason: reason });
  if (error) throw error;
}

// =========================================================
// Reading the log.
//
// The Overview's rail shows five rows; this is what "See all" opens onto. Same table,
// same shape, no limit of five — a preview and its module must never be two datasets.
//
// Names are resolved in the browser for the reason `ownerLookup()` exists: PostgREST
// cannot join `project_audit_log.actor_id` to a profile, because the column references
// `auth.users`. An actor with no profile name is shown by the address they sign in with,
// which is a fact; nothing is invented from it.
// =========================================================

export interface AuditRow {
  id: string;
  /** Empty for a person-level row (089) — activity with no project. */
  projectId: string;
  projectName: string;
  action: string;
  actorName: string;
  personName: string;
  entityType: string;
  createdAt: string;
}

export interface AuditPage {
  rows: AuditRow[];
  /** False when the table answered but there was nothing more after this page. */
  hasMore: boolean;
}

/**
 * One page of the audit log, newest first.
 *
 * `before` is the `created_at` of the last row already shown — keyset paging, so a row
 * written while the admin is reading cannot shift the page boundary and hide an entry.
 */
export async function listAuditLog(limit = 50, before?: string): Promise<AuditPage> {
  const { ownerLookup } = await import('./admin-users');

  const select = (cols: string) => {
    let q = supabase.from('project_audit_log').select(cols)
      .order('created_at', { ascending: false })
      .limit(limit + 1);
    if (before) q = q.lt('created_at', before);
    return q;
  };

  // 089's columns, with the pre-089 shape as the fallback: PostgREST refuses a select
  // naming a column that is not there (42703) rather than returning nulls.
  let res = await select('id, project_id, action, actor_id, person_id, entity_type, created_at');
  if (res.error && res.error.code === '42703') {
    res = await select('id, project_id, action, actor_id, created_at');
  }
  if (res.error) throw res.error;

  const raw = (res.data ?? []) as unknown as Record<string, unknown>[];
  const hasMore = raw.length > limit;
  const page = hasMore ? raw.slice(0, limit) : raw;

  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const owners = await ownerLookup();
  const name = (id: string) => {
    const hit = owners.get(id);
    return hit ? (hit.name || hit.email) : '';
  };

  // Project names, including archived ones — the scored lists exclude those, and without
  // this an older row would show a raw uuid where its project's name belongs.
  const ids = [...new Set(page.map(r => s(r.project_id)).filter(Boolean))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await supabase.from('projects').select('id, name').in('id', ids);
    for (const p of (data ?? []) as unknown as Record<string, unknown>[]) names.set(s(p.id), s(p.name));
  }

  return {
    hasMore,
    rows: page.map(r => ({
      id:          s(r.id),
      projectId:   s(r.project_id),
      projectName: names.get(s(r.project_id)) ?? '',
      action:      s(r.action),
      actorName:   name(s(r.actor_id)),
      personName:  name(s(r.person_id)),
      entityType:  s(r.entity_type),
      createdAt:   s(r.created_at),
    })),
  };
}

// =========================================================
// One project's activity (05 §8) — the Workspace's Activity tab and its Overview's
// "last 5" are this list, whole and sliced. No second table, no cache.
//
// Raw rows only: ids, not names. The workspace loader resolves actor and person once for
// everything it shows, and this reader must not spend a second `admin_list_users()` call
// doing the same job. Person-level rows (project_id NULL, 089) never match the filter.
// =========================================================

export interface ProjectActivityRow {
  id: string;
  action: string;
  actorId: string;
  /** Who the row is about, when it is about a person (089). Null otherwise. */
  personId: string | null;
  entityType: string | null;
  entityId: string | null;
  /** The pre-089 column, still written for `project_stage` entities. */
  stageId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export async function listProjectActivity(projectId: string, limit = 200): Promise<ProjectActivityRow[]> {
  const select = (cols: string) => supabase.from('project_audit_log').select(cols)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);

  // 089's columns, with the pre-089 shape as the fallback (42703: PostgREST refuses a
  // select naming a column that is not there rather than returning nulls).
  let res = await select('id, action, actor_id, person_id, entity_type, entity_id, stage_id, details, created_at');
  if (res.error && res.error.code === '42703') {
    res = await select('id, action, actor_id, stage_id, details, created_at');
  }
  if (res.error) throw res.error;

  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const sn = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return ((res.data ?? []) as unknown as Record<string, unknown>[]).map(r => ({
    id:         s(r.id),
    action:     s(r.action),
    actorId:    s(r.actor_id),
    personId:   sn(r.person_id),
    entityType: sn(r.entity_type),
    entityId:   sn(r.entity_id),
    stageId:    sn(r.stage_id),
    details:    (r.details && typeof r.details === 'object' ? r.details : {}) as Record<string, unknown>,
    createdAt:  s(r.created_at),
  }));
}
