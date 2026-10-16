import { supabase } from './client';

/**
 * A verifier's own work (06 §22) — the /verifiers surface's only reader.
 *
 * ── Isolation is the database's, not this file's ─────────────────────────────────────
 * Every query below asks for `verifier_id = me`, but that is a *filter*, not the
 * protection: `stage_verifications` is readable only by an admin or a `project_member`
 * (087/086), and a verifier is a member solely of the projects they are actively
 * assigned to. So a verifier who removed the filter would still see only their own
 * projects, and one who guessed another verifier's verification id gets no row.
 *
 * Nothing here is admin-shaped: no portfolio, no other people's assignments, no totals.
 */

export type VerificationDecision = 'pending' | 'verified' | 'rejected' | 'needs_more_evidence';

export interface VerifierWorkItem {
  id: string;
  projectId: string;
  projectName: string;
  projectCity: string | null;
  projectCountry: string | null;
  stageId: string;
  stageNumber: number;
  stageName: string;
  stageKey: string | null;
  discipline: string | null;
  requestedAt: string;
  visitedAt: string | null;
  decision: VerificationDecision;
  decidedAt: string | null;
  findings: string | null;
}

const s = (v: unknown) => (typeof v === 'string' ? v : '');
const sn = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** PostgREST answers 42P01 when 087 has not been applied; that is "not available". */
const unavailable = (e: unknown) => {
  const code = (e as { code?: string } | null)?.code;
  return code === '42P01' || code === '42703';
};

/**
 * The signed-in verifier's verifications, newest request first. `p_user` is the caller's
 * own id — passed explicitly so the query is legible, enforced by RLS regardless.
 */
export async function listMyVerifications(userId: string):
  Promise<{ rows: VerifierWorkItem[]; available: boolean }> {
  const { data, error } = await supabase
    .from('stage_verifications')
    .select('id, project_id, stage_id, verifier_id, requested_at, visited_at, decision, decided_at, findings, ' +
            'projects(name, city, country), project_stages(stage_number, name, stage_key)')
    .eq('verifier_id', userId)
    .order('requested_at', { ascending: false });
  if (error) {
    if (unavailable(error)) return { rows: [], available: false };
    throw error;
  }

  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(r => {
    const project = (r.projects ?? {}) as Record<string, unknown>;
    const stage = (r.project_stages ?? {}) as Record<string, unknown>;
    return {
      id:             s(r.id),
      projectId:      s(r.project_id),
      projectName:    s(project.name),
      projectCity:    sn(project.city),
      projectCountry: sn(project.country),
      stageId:        s(r.stage_id),
      stageNumber:    typeof stage.stage_number === 'number' ? stage.stage_number : 0,
      stageName:      s(stage.name),
      stageKey:       sn(stage.stage_key),
      discipline:     null,
      requestedAt:    s(r.requested_at),
      visitedAt:      sn(r.visited_at),
      decision:       (r.decision as VerificationDecision) ?? 'pending',
      decidedAt:      sn(r.decided_at),
      findings:       sn(r.findings),
    };
  });
  return { rows, available: true };
}

export interface VerifierWorkDetail extends VerifierWorkItem {
  /** The stage's own substages — what the work was supposed to be. */
  substages: { id: string; name: string; status: string; evidence: string[] }[];
  /** Documents on the project, readable through the member policy (092). */
  documents: { id: string; name: string; path: string; uploadedAt: string }[];
}

/**
 * One verification, with the context needed to judge it. A verification that is not this
 * verifier's returns null — RLS refuses the row, and the id in the URL proves nothing.
 */
export async function loadVerification(verificationId: string, userId: string): Promise<VerifierWorkDetail | null> {
  const { data, error } = await supabase
    .from('stage_verifications')
    .select('id, project_id, stage_id, verifier_id, requested_at, visited_at, decision, decided_at, findings, ' +
            'projects(name, city, country), project_stages(stage_number, name, stage_key)')
    .eq('id', verificationId)
    .eq('verifier_id', userId)
    .maybeSingle();
  if (error) {
    if (unavailable(error)) return null;
    throw error;
  }
  if (!data) return null;

  const r = data as unknown as Record<string, unknown>;
  const project = (r.projects ?? {}) as Record<string, unknown>;
  const stage = (r.project_stages ?? {}) as Record<string, unknown>;

  const [subs, docs] = await Promise.all([
    supabase.from('project_substages').select('id, name, status, evidence_urls').eq('stage_id', s(r.stage_id)).order('created_at'),
    supabase.from('project_documents').select('id, file_name, file_path, created_at').eq('project_id', s(r.project_id)).order('created_at', { ascending: false }),
  ]);

  if (subs.error) throw subs.error;
  if (docs.error) throw docs.error;

  return {
    id:             s(r.id),
    projectId:      s(r.project_id),
    projectName:    s(project.name),
    projectCity:    sn(project.city),
    projectCountry: sn(project.country),
    stageId:        s(r.stage_id),
    stageNumber:    typeof stage.stage_number === 'number' ? stage.stage_number : 0,
    stageName:      s(stage.name),
    stageKey:       sn(stage.stage_key),
    discipline:     null,
    requestedAt:    s(r.requested_at),
    visitedAt:      sn(r.visited_at),
    decision:       (r.decision as VerificationDecision) ?? 'pending',
    decidedAt:      sn(r.decided_at),
    findings:       sn(r.findings),
    substages: ((subs.data ?? []) as Record<string, unknown>[]).map(x => ({
      id: s(x.id), name: s(x.name), status: s(x.status),
      evidence: Array.isArray(x.evidence_urls) ? (x.evidence_urls as unknown[]).map(String) : [],
    })),
    documents: ((docs.data ?? []) as Record<string, unknown>[]).map(d => ({
      id: s(d.id), name: s(d.file_name), path: s(d.file_path), uploadedAt: s(d.created_at),
    })),
  };
}

/**
 * A time-limited link to one private file. Evidence and documents live in private
 * buckets; a verifier reads them through the member policies added in 092, and never
 * through a public URL — there is no public path to these buckets at all.
 */
export async function signedFileUrl(bucket: 'evidence' | 'documents', path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// =========================================================
// A whole project, as the verifier assigned to it needs to see it.
//
// `loadVerification` answers "judge this one stage", which is right once you are already
// on a piece of work. It is the wrong shape for arriving from an assignment email: you
// have just been told you are verifying a BUILD, and the first question is what state it
// is in and what the contractor has put up against each stage.
//
// RLS does the gating, not this: a verifier is a `project_member` only while actively
// assigned (086), so an ended assignment stops resolving rather than lingering.
// =========================================================

export interface VerifierStage {
  id: string;
  stageNumber: number;
  name: string;
  stageKey: string | null;
  status: string;
  substages: { id: string; name: string; status: string; evidence: string[] }[];
  /** Their own verification of this stage, when one has been requested. */
  verificationId: string | null;
  decision: VerificationDecision | null;
}

export interface VerifierProject {
  projectId: string;
  projectName: string;
  city: string | null;
  country: string | null;
  stages: VerifierStage[];
}

/** Null when the project is not readable — which means the assignment is not active. */
export async function loadProjectForVerifier(
  projectId: string, userId: string,
): Promise<VerifierProject | null> {
  const { data: project, error: pErr } = await supabase
    .from('projects').select('id, name, city, country').eq('id', projectId).maybeSingle();
  if (pErr) { if (unavailable(pErr)) return null; throw pErr; }
  if (!project) return null;

  const [stages, verifications] = await Promise.all([
    supabase.from('project_stages')
      .select('id, stage_number, name, stage_key, status')
      .eq('project_id', projectId).order('stage_number'),
    // Only theirs. Another discipline's verification of the same stage is not this
    // verifier's to open, and showing it would imply it was.
    supabase.from('stage_verifications')
      .select('id, stage_id, decision').eq('project_id', projectId).eq('verifier_id', userId),
  ]);
  if (stages.error) throw stages.error;

  const stageRows = (stages.data ?? []) as Record<string, unknown>[];
  const ids = stageRows.map(x => s(x.id));

  // One query for every substage rather than one per stage: ten stages is ten round
  // trips on a page somebody opens from an email, on a phone, on site.
  const subs = ids.length === 0
    ? { data: [] as Record<string, unknown>[], error: null }
    : await supabase.from('project_substages')
        .select('id, stage_id, name, status, evidence_urls').in('stage_id', ids).order('created_at');
  if (subs.error) throw subs.error;

  const byStage = new Map<string, { id: string; name: string; status: string; evidence: string[] }[]>();
  for (const x of (subs.data ?? []) as Record<string, unknown>[]) {
    const list = byStage.get(s(x.stage_id)) ?? [];
    list.push({
      id: s(x.id), name: s(x.name), status: s(x.status),
      evidence: Array.isArray(x.evidence_urls) ? (x.evidence_urls as unknown[]).map(String) : [],
    });
    byStage.set(s(x.stage_id), list);
  }

  const mine = new Map<string, { id: string; decision: VerificationDecision }>();
  for (const v of ((verifications.data ?? []) as Record<string, unknown>[])) {
    mine.set(s(v.stage_id), { id: s(v.id), decision: (v.decision as VerificationDecision) ?? 'pending' });
  }

  const p = project as Record<string, unknown>;
  return {
    projectId:   s(p.id),
    projectName: s(p.name),
    city:        sn(p.city),
    country:     sn(p.country),
    stages: stageRows.map(x => {
      const v = mine.get(s(x.id));
      return {
        id:          s(x.id),
        stageNumber: typeof x.stage_number === 'number' ? x.stage_number : 0,
        name:        s(x.name),
        stageKey:    sn(x.stage_key),
        status:      s(x.status),
        substages:   byStage.get(s(x.id)) ?? [],
        verificationId: v?.id ?? null,
        decision:       v?.decision ?? null,
      };
    }),
  };
}
