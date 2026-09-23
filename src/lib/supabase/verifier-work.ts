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
    supabase.from('project_documents').select('id, name, file_path, created_at').eq('project_id', s(r.project_id)).order('created_at', { ascending: false }),
  ]);

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
      id: s(d.id), name: s(d.name), path: s(d.file_path), uploadedAt: s(d.created_at),
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
