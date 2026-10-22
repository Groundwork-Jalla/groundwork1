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

/**
 * The sequence, in order. The rank is what SQL sorts on.
 *
 * `rejected` sits at the start because it is TERMINAL, not early: it ranks below
 * everything so it sorts out of the way, and a rejection outranks whatever progress
 * came before it — somebody turned down is not still "pre-qualified".
 */
export const PIPELINE_STAGES = [
  'rejected',
  'account_created', 'onboarded', 'applied', 'prequalified', 'booking_shown',
  'call_completed', 'reviewing', 'accepted',
  'committed', 'agreement_signed', 'client_introduced', 'activated',
] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];

/** Nobody to chase: they are through, or they are out. */
export const TERMINAL_STAGES: readonly PipelineStage[] = ['activated', 'rejected'];

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
  /** The application's own status, so the funnel and the application cannot disagree. */
  applicationStatus: string | null;
  /**
   * Whether clients can actually see them.
   *
   * Accepting publishes to the directory (033), but a publish can fail. "Accepted" and
   * "visible to clients" are two different facts and only one of them is what a client
   * sees, so the board reports both rather than implying the second from the first.
   */
  inDirectory: boolean;
  /**
   * The application staff can open and read (148).
   *
   * Null for somebody who holds a contractor account but has never applied — which is
   * exactly the difference between a partner prospect and an ordinary contractor.
   */
  applicationId: string | null;
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
    applicationStatus:  (r.application_status as string) ?? null,
    inDirectory:        r.in_directory === true,
    applicationId:      (r.application_id as string) ?? null,
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
export type Attention =
  'unowned' | 'overdue' | 'no_next_action' | 'deadline_passed' | 'not_in_directory' | null;

export function attention(r: PipelineRow, now = new Date()): Attention {
  // Through, or out. Neither is a worklist item.
  if (TERMINAL_STAGES.includes(r.stage)) return null;
  // Accepted but invisible to clients is a silent failure: the decision was made, the
  // applicant was told, and no client can find them.
  if (r.applicationStatus === 'accepted' && !r.inDirectory) return 'not_in_directory';
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
    return a === 'not_in_directory' ? 0 : a === 'deadline_passed' ? 1 : a === 'overdue' ? 2
         : a === 'unowned' ? 3 : a === 'no_next_action' ? 4 : 5;
  };
  return [...rows].sort((x, y) => weight(x) - weight(y) || y.stageRank - x.stageRank);
}

/**
 * Everyone who has actually entered the partner funnel.
 *
 * A contractor account is not a partner application. The board is built over every
 * contractor because the early stages — account created, onboarded — are real funnel
 * steps, but a row that never produced an application is a prospect, not a partner,
 * and staff reviewing applications should not have to read past them.
 */
export function partnersOnly(rows: PipelineRow[]): PipelineRow[] {
  return rows.filter(r => r.applicationId !== null);
}

/** How many sit at each stage, for the strip above the list. */
export function byStage(rows: PipelineRow[]): Record<PipelineStage, number> {
  const out = Object.fromEntries(PIPELINE_STAGES.map(s => [s, 0])) as Record<PipelineStage, number>;
  for (const r of rows) if (r.stage in out) out[r.stage] += 1;
  return out;
}
