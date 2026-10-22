import { supabase } from '@/lib/supabase/client';

// =========================================================
// The partner pipeline — one row per contractor, as a worklist (145).
//
// 136 counts the funnel. Counts say where people are lost; they do not say who to ring
// this morning. Philip's rule is that no qualified applicant sits in the pipeline
// without a current stage, a last action, a next action, an owner, a next-action date
// and a fourteen-day activation deadline. This is that list.
//
// Eight of the eleven stages are derived live in SQL from what the product already
// knows. Only the call, the commitment and the signed agreement are stored, because
// nothing observes them. Asking staff to maintain a stage the database can answer is
// how a tracker rots — the derived half goes stale and nobody trusts either half.
// =========================================================

/** Philip's sequence, in order. The rank is what SQL sorts on. */
export const PIPELINE_STAGES = [
  'account_created', 'onboarded', 'applied', 'prequalified', 'booking_shown',
  'call_completed', 'committed', 'agreement_signed', 'client_introduced', 'activated',
] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];

/** The three a person has to tell us; everything else is observed. */
export const MANUAL_STAGES: readonly PipelineStage[] =
  ['call_completed', 'committed', 'agreement_signed'];

export interface PipelineRow {
  userId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  specialty: string | null;
  stage: PipelineStage;
  stageRank: number;
  ownerId: string | null;
  ownerName: string | null;
  lastAction: string | null;
  lastActionAt: string | null;
  nextAction: string | null;
  nextActionOn: string | null;
  activationDeadline: string | null;
  notes: string | null;
  appliedAt: string | null;
  stageSince: string | null;
  daysInStage: number;
}

export async function pipelineAvailable(): Promise<boolean> {
  const { error } = await supabase.rpc('admin_partner_pipeline');
  if (!error) return true;
  if (error.code === 'PGRST202' || error.code === '42P01' || error.code === 'PGRST205') return false;
  return true;
}

export async function fetchPipeline(): Promise<PipelineRow[]> {
  const { data, error } = await supabase.rpc('admin_partner_pipeline');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    userId:             String(r.user_id),
    fullName:           (r.full_name as string) ?? null,
    email:              (r.email as string) ?? null,
    phone:              (r.phone as string) ?? null,
    specialty:          (r.specialty as string) ?? null,
    stage:              (r.stage as PipelineStage),
    stageRank:          Number(r.stage_rank ?? 0),
    ownerId:            (r.owner_id as string) ?? null,
    ownerName:          (r.owner_name as string) ?? null,
    lastAction:         (r.last_action as string) ?? null,
    lastActionAt:       (r.last_action_at as string) ?? null,
    nextAction:         (r.next_action as string) ?? null,
    nextActionOn:       (r.next_action_on as string) ?? null,
    activationDeadline: (r.activation_deadline as string) ?? null,
    notes:              (r.notes as string) ?? null,
    appliedAt:          (r.applied_at as string) ?? null,
    stageSince:         (r.stage_since as string) ?? null,
    daysInStage:        Number(r.days_in_stage ?? 0),
  }));
}

export interface PipelineEdit {
  ownerId?: string | null;
  lastAction?: string;
  nextAction?: string;
  nextActionOn?: string;
  activationDeadline?: string;
  notes?: string;
  callCompleted?: boolean;
  committed?: boolean;
  agreementSigned?: boolean;
}

export async function savePipeline(userId: string, e: PipelineEdit): Promise<void> {
  const { error } = await supabase.rpc('set_partner_pipeline', {
    p_user:                userId,
    p_owner:               e.ownerId ?? null,
    p_last_action:         e.lastAction ?? null,
    p_next_action:         e.nextAction ?? null,
    p_next_action_on:      e.nextActionOn ?? null,
    p_activation_deadline: e.activationDeadline ?? null,
    p_notes:               e.notes ?? null,
    p_call_completed:      e.callCompleted ?? null,
    p_committed:           e.committed ?? null,
    p_agreement_signed:    e.agreementSigned ?? null,
  });
  if (error) throw error;
}

/** Today, as a plain date, so comparisons do not depend on the clock's time of day. */
const today = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * What needs attention, and why.
 *
 * `unowned` is first on purpose: Philip's rule is that nobody should be in the pipeline
 * without somebody chasing them, so an absent owner is itself the finding — not a blank
 * column to be ignored.
 */
export type Attention = 'unowned' | 'overdue' | 'no_next_action' | 'deadline_passed' | null;

export function attention(r: PipelineRow, now = new Date()): Attention {
  // Somebody already in the product and finished with is not a worklist item.
  if (r.stage === 'activated') return null;
  if (!r.ownerId) return 'unowned';
  if (r.activationDeadline && r.activationDeadline < today(now)) return 'deadline_passed';
  if (r.nextActionOn && r.nextActionOn < today(now)) return 'overdue';
  if (!r.nextAction) return 'no_next_action';
  return null;
}

/** The worklist first, then the furthest along. */
export function sortForWork(rows: PipelineRow[], now = new Date()): PipelineRow[] {
  const weight = (r: PipelineRow) => {
    const a = attention(r, now);
    return a === 'deadline_passed' ? 0 : a === 'overdue' ? 1
         : a === 'unowned' ? 2 : a === 'no_next_action' ? 3 : 4;
  };
  return [...rows].sort((x, y) => weight(x) - weight(y) || y.stageRank - x.stageRank);
}

/** How many sit at each stage, for the strip above the list. */
export function byStage(rows: PipelineRow[]): Record<PipelineStage, number> {
  const out = Object.fromEntries(PIPELINE_STAGES.map(s => [s, 0])) as Record<PipelineStage, number>;
  for (const r of rows) if (r.stage in out) out[r.stage] += 1;
  return out;
}
