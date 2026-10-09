import { supabase } from './client';

// =========================================================
// What Jalla found in work completed before a project joined Groundwork (107).
//
// 103 marks those stages `pre_existing`: they cost the client nothing, need no
// verification and issue no certificate, and the badge says "Completed outside
// Groundwork". This is the other half — somebody walked the site before we took the
// project on, and what they saw belongs in the record rather than in WhatsApp.
//
// ── Not a verification ───────────────────────────────────────────────────────────────
// A verification is a decision about work Groundwork supervised, and it releases money.
// An assessment is an opinion about work nobody here watched being built. They live in
// different tables on purpose: `stage_verifications` has four independent consumers that
// act on "latest verification wins", and none of them can see this.
//
// Nothing here can move money. `stage_release_blocker` refuses every pre-existing stage
// before it looks at anything else, whatever this says.
// =========================================================

/**
 * Deliberately coarse. Four outcomes, because these are the decisions that actually
 * follow — a finer scale would be false precision about work nobody from Jalla saw built.
 */
export type JoiningCondition = 'sound' | 'needs_attention' | 'defective' | 'not_inspected';

export const JOINING_CONDITIONS: readonly JoiningCondition[] =
  ['sound', 'needs_attention', 'defective', 'not_inspected'] as const;

export interface JoiningAssessment {
  id: string;
  projectId: string;
  stageId: string;
  condition: JoiningCondition;
  notes: string;
  evidencePaths: string[];
  assessedBy: string;
  assessedAt: string;
}

interface Row {
  id: string;
  project_id: string;
  stage_id: string;
  condition: JoiningCondition;
  notes: string;
  evidence_paths: unknown;
  assessed_by: string;
  assessed_at: string;
}

const toAssessment = (r: Row): JoiningAssessment => ({
  id:            r.id,
  projectId:     r.project_id,
  stageId:       r.stage_id,
  condition:     r.condition,
  notes:         r.notes,
  // The column is a JSON array of strings, guarded by a CHECK — but a column read is not
  // a parse, so the shape is narrowed here rather than asserted.
  evidencePaths: Array.isArray(r.evidence_paths) ? r.evidence_paths.filter((p): p is string => typeof p === 'string') : [],
  assessedBy:    r.assessed_by,
  assessedAt:    r.assessed_at,
});

const COLUMNS = 'id, project_id, stage_id, condition, notes, evidence_paths, assessed_by, assessed_at';

/**
 * Every assessment on a project, by stage id.
 *
 * Returns an empty map rather than throwing when the table is absent: 107 may not be
 * applied yet, and a project workspace that will not load because one panel has no table
 * is worse than a panel that shows nothing. Same posture the ledger takes.
 */
export async function fetchJoiningAssessments(projectId: string): Promise<Map<string, JoiningAssessment>> {
  const { data, error } = await supabase
    .from('stage_joining_assessments')
    .select(COLUMNS)
    .eq('project_id', projectId);

  if (error) {
    // 42P01 undefined_table, PGRST205 unknown relation — 107 not applied.
    if (error.code === '42P01' || error.code === 'PGRST205') return new Map();
    throw error;
  }
  return new Map((data ?? []).map(r => {
    const a = toAssessment(r as Row);
    return [a.stageId, a];
  }));
}

/**
 * Record what was found, or amend it.
 *
 * One per stage: calling this again replaces the finding and logs the change with what it
 * was before, because "sound in March, defective in June" is a fact somebody will need.
 *
 * Refused for a contractor even though they are a project member — they are the
 * interested party in a judgement about their own earlier work. The server decides this;
 * the UI only avoids offering a button that would be refused.
 */
export async function recordJoiningAssessment(opts: {
  stageId: string;
  condition: JoiningCondition;
  notes: string;
  evidencePaths?: string[];
}): Promise<string> {
  const { data, error } = await supabase.rpc('record_joining_assessment', {
    p_stage:     opts.stageId,
    p_condition: opts.condition,
    p_notes:     opts.notes,
    p_evidence:  opts.evidencePaths ?? [],
  });
  if (error) throw error;
  return String(data);
}
