import { supabase } from './client';
import type { ProjectRow, ProjectStageRow, ProjectSubstageRow, ProjectDocumentRow } from '@/types/project';

// =========================================================
// The contractor's own work.
//
// Every read here is bounded by RLS, not by a filter in the browser. A contractor is a
// `project_member` (086) of exactly the projects they hold an accepted
// `contractor_invites` row for, so `select * from projects` returns their projects and
// nobody else's — asking the database for everything and narrowing it here would make the
// browser the access control, which is the thing RLS exists to stop.
//
// Nothing in this module reads an admin or verifier RPC. The contractor observes
// verification outcomes and payment state; it governs neither.
// =========================================================

/** One assigned build, with just enough to render a row without a second round trip. */
export interface AssignedProject {
  project: ProjectRow;
  stages: ProjectStageRow[];
  /** The stage the contractor is being asked to work on, if any is active. */
  activeStage: ProjectStageRow | null;
  completedStages: number;
  totalStages: number;
}

// Stage statuses are locked | active | pending_review | complete. `in_progress` belongs
// to SUBSTAGES — using it here silently matched nothing and every project looked idle.
function activeOf(stages: ProjectStageRow[]): ProjectStageRow | null {
  return stages.find(s => s.status === 'active')
      ?? stages.find(s => s.status === 'pending_review')
      ?? null;
}

/**
 * Every project this contractor is assigned to.
 *
 * Two queries, not one per project: the stages come back in a single `in` over the
 * project ids the first query returned, which RLS has already narrowed.
 */
export async function fetchAssignedProjects(): Promise<AssignedProject[]> {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('*')
    .neq('status', 'archived')
    .order('updated_at', { ascending: false });
  if (error) throw error;

  const rows = (projects ?? []) as ProjectRow[];
  if (rows.length === 0) return [];

  const { data: stages, error: stageErr } = await supabase
    .from('project_stages')
    .select('*')
    .in('project_id', rows.map(p => p.id))
    .order('stage_number', { ascending: true });
  if (stageErr) throw stageErr;

  const byProject = new Map<string, ProjectStageRow[]>();
  for (const s of (stages ?? []) as ProjectStageRow[]) {
    const list = byProject.get(s.project_id) ?? [];
    list.push(s);
    byProject.set(s.project_id, list);
  }

  return rows.map(project => {
    const list = byProject.get(project.id) ?? [];
    return {
      project,
      stages: list,
      activeStage: activeOf(list),
      completedStages: list.filter(s => s.status === 'complete').length,
      totalStages: list.length,
    };
  });
}

/**
 * One assigned project, or null.
 *
 * Null covers both "no such project" and "not yours" on purpose: RLS returns an empty
 * result either way, and telling the two apart would confirm the existence of a project
 * the caller may not see.
 */
export async function fetchAssignedProject(projectId: string): Promise<AssignedProject | null> {
  const { data, error } = await supabase
    .from('projects').select('*').eq('id', projectId).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: stages, error: stageErr } = await supabase
    .from('project_stages').select('*').eq('project_id', projectId)
    .order('stage_number', { ascending: true });
  if (stageErr) throw stageErr;

  const list = (stages ?? []) as ProjectStageRow[];
  return {
    project: data as ProjectRow,
    stages: list,
    activeStage: activeOf(list),
    completedStages: list.filter(s => s.status === 'complete').length,
    totalStages: list.length,
  };
}

export async function fetchSubstages(projectId: string): Promise<ProjectSubstageRow[]> {
  const { data, error } = await supabase
    .from('project_substages').select('*').eq('project_id', projectId)
    .order('substage_number', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProjectSubstageRow[];
}

export async function fetchProjectDocuments(projectId: string): Promise<ProjectDocumentRow[]> {
  const { data, error } = await supabase
    .from('project_documents').select('*').eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProjectDocumentRow[];
}

// ── What the reviewers asked for ─────────────────────────────────────────────────────

/**
 * A verification outcome the contractor has to act on.
 *
 * `stage_verifications` is readable by any project member (087), so the contractor sees
 * the finding that was recorded about their work — including a rejection and its reason.
 * They can read it and they cannot change it: there is no write path to this table from
 * here, by design.
 */
export interface ReworkItem {
  stageId: string;
  stageNumber: number;
  stageName: string;
  projectId: string;
  projectName: string;
  decision: 'rejected' | 'needs_more_evidence';
  findings: string | null;
  decidedAt: string | null;
}

export async function fetchRework(projects: AssignedProject[]): Promise<ReworkItem[]> {
  if (projects.length === 0) return [];
  const { data, error } = await supabase
    .from('stage_verifications')
    .select('stage_id, project_id, decision, findings, decided_at')
    .in('decision', ['rejected', 'needs_more_evidence'])
    .order('decided_at', { ascending: false });
  // The table may not be reachable on an older deployment; an absent queue is not a fault.
  if (error) return [];

  const stageIndex = new Map<string, { n: number; name: string; projectId: string }>();
  const projectNames = new Map<string, string>();
  for (const a of projects) {
    projectNames.set(a.project.id, a.project.name);
    for (const s of a.stages) stageIndex.set(s.id, { n: s.stage_number, name: s.name, projectId: a.project.id });
  }

  return (data ?? []).flatMap(r => {
    const stage = stageIndex.get(String(r.stage_id));
    // A row for a project this contractor cannot see never arrives; one whose stage is
    // not in the loaded set is skipped rather than rendered without a name.
    if (!stage) return [];
    return [{
      stageId: String(r.stage_id),
      stageNumber: stage.n,
      stageName: stage.name,
      projectId: stage.projectId,
      projectName: projectNames.get(stage.projectId) ?? '',
      decision: r.decision as ReworkItem['decision'],
      findings: (r.findings as string | null) ?? null,
      decidedAt: (r.decided_at as string | null) ?? null,
    }];
  });
}

// ── Payments the contractor is actually party to ─────────────────────────────────────

/**
 * Payments naming this contractor as the beneficiary.
 *
 * `beneficiary_read_payments` (090) is the only arm of the policy a contractor satisfies:
 * they see rows they are the beneficiary of, and nothing else on the project. So an empty
 * result means "none names you", which is NOT the same as "this project has no payments" —
 * the UI must say the former and never imply the latter.
 *
 * Read-only by construction. There is no confirm, authorise, release or reconcile here:
 * the contractor observes, Groundwork governs, and a licensed provider moves the money.
 */
export interface ContractorPayment {
  id: string;
  projectId: string;
  stageId: string | null;
  direction: string;
  state: string;
  amount: number;
  currency: string;
  note: string | null;
  createdAt: string;
}

export async function fetchMyPayments(): Promise<{ rows: ContractorPayment[]; available: boolean }> {
  const { data, error } = await supabase
    .from('payments')
    .select('id, project_id, stage_id, direction, state, amount, currency, note, created_at')
    .order('created_at', { ascending: false });
  // A missing ledger is "not available", which the UI must distinguish from "none".
  if (error) return { rows: [], available: false };

  return {
    available: true,
    rows: (data ?? []).map(r => ({
      id: String(r.id),
      projectId: String(r.project_id),
      stageId: (r.stage_id as string | null) ?? null,
      direction: String(r.direction),
      state: String(r.state),
      amount: Number(r.amount ?? 0),
      currency: String(r.currency ?? 'USD'),
      note: (r.note as string | null) ?? null,
      createdAt: String(r.created_at),
    })),
  };
}

// ── Submitting work ──────────────────────────────────────────────────────────────────

/**
 * Upload evidence for a stage and file it as a site update.
 *
 * Two steps, in this order, because they enforce different halves of the rule:
 *
 *   1. The file goes to the private `evidence` bucket under `<projectId>/…`. The storage
 *      policy (012) checks `path_tokens[1]` against the caller's accepted invites, so a
 *      contractor physically cannot write into another project's folder.
 *   2. `submit_site_update` (088) records it. That definer function re-checks who may
 *      report work — owner, accepted contractor, admin — and explicitly refuses a
 *      verifier, who must not file the evidence they will later assess. It also appends
 *      to the substage's `evidence_urls`, which the contractor cannot update directly
 *      (only `owner_update_substages` exists).
 *
 * `clientRef` makes a retry a no-op: the same reference returns the same row rather than
 * appending the photos twice, which matters on a Cameroonian site connection.
 */
export async function submitSiteUpdate(input: {
  projectId: string;
  stageId: string;
  substageId?: string | null;
  description?: string | null;
  files: File[];
  clientRef: string;
}): Promise<string> {
  const paths: string[] = [];

  for (const file of input.files) {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${input.projectId}/${Date.now()}_${safe}`;
    const { error } = await supabase.storage.from('evidence').upload(path, file, { upsert: false });
    if (error) throw error;
    paths.push(path);
  }

  const { data, error } = await supabase.rpc('submit_site_update', {
    p_stage: input.stageId,
    p_substage: input.substageId ?? null,
    p_description: input.description ?? null,
    p_paths: paths,
    p_location: null,
    p_client_ref: input.clientRef,
  });
  if (error) throw error;
  return String(data ?? '');
}

/** Evidence and documents live in private buckets; a stored path is not a URL. */
export async function signEvidenceUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('evidence').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
