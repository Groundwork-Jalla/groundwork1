import { supabase } from '@/lib/supabase/client';

// =========================================================
// Where each tracked sequence starts and ends (170).
//
// Philip, 30 Oct 2026: sign-up, contractor onboarding and partner application are
// three SEPARATE sequences, each tracked from its own start to its own end, so a
// drop-off inside a sequence is visible and not only the gap between them.
//
// The rule that matters, and the reason this file exists rather than a few inline
// `supabase.rpc` calls: a boundary is recorded WHERE THE ACTION HAPPENS. None of
// these is inferred from an answer on another screen. That inference is what produced
// the double count Philip named — finishing onboarding with "I have a project" was
// being read as the start of a partner application, so one click ended one sequence
// and began another.
//
// Naming them here, in one list, is what stops the next person re-deriving a boundary
// somewhere else and quietly disagreeing with this one.
// =========================================================

export type FunnelSequence =
  | 'signup'
  | 'contractor_onboarding'
  | 'partner_application'
  | 'call_booking'
  | 'project_creation'
  | 'client_invitation';

export type FunnelStep = 'started' | 'completed';

/**
 * Record a boundary. Never throws, never blocks.
 *
 * A measurement must not be able to break the thing it measures: if this fails, the
 * contractor still finishes onboarding and still files their application. The count
 * is worth less than the action, so the action wins every time.
 *
 * The RPC is idempotent and keeps the first occurrence, so calling this on every
 * render of a page, or twice on a retry, cannot inflate anything.
 */
export async function recordFunnel(
  sequence: FunnelSequence,
  step: FunnelStep,
  subjectId?: string | null,
): Promise<void> {
  try {
    await supabase.rpc('record_funnel_event', {
      p_sequence: sequence,
      p_step: step,
      p_subject: subjectId ?? null,
    });
  } catch {
    // 170 not applied yet, signed out, offline. All are "no measurement", not "stop".
  }
}

/** Fire and forget, for call sites that must not wait on a measurement. */
export function trackFunnel(
  sequence: FunnelSequence,
  step: FunnelStep,
  subjectId?: string | null,
): void {
  void recordFunnel(sequence, step, subjectId);
}

// =========================================================
// Project creation is counted per ATTEMPT, not per person.
//
// Every other sequence here happens once in a lifetime, so the person is the unit and
// the event needs no subject. Project creation does not: one contractor can open the
// wizard four times and finish twice, and "two incomplete" is the fact Philip asked
// for — "aggressive tracking of both created and completed projects".
//
// With no subject the unique index would record ONE start per person forever, so the
// second attempt would be invisible and the first would look permanently abandoned.
// So each opening of the wizard gets an id, and the confirm step closes that same id.
//
// It lives in sessionStorage rather than the wizard draft: the draft is validated,
// versioned and cleared on its own schedule, and a measurement has no business being
// able to invalidate somebody's half-finished project.
// =========================================================

const ATTEMPT_KEY = 'groundwork:project-attempt';

/** The id for the attempt in progress, creating one if the wizard just opened. */
export function projectAttemptId(): string | null {
  try {
    const existing = sessionStorage.getItem(ATTEMPT_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(ATTEMPT_KEY, fresh);
    return fresh;
  } catch {
    // Private mode, or storage blocked. No attempt id means no pair to close, so the
    // caller records nothing rather than recording half of one.
    return null;
  }
}

/** The attempt in progress, without starting a new one. */
export function currentProjectAttemptId(): string | null {
  try { return sessionStorage.getItem(ATTEMPT_KEY); } catch { return null; }
}

/** The attempt finished. The next wizard opening is a new one. */
export function clearProjectAttempt(): void {
  try { sessionStorage.removeItem(ATTEMPT_KEY); } catch { /* nothing to clear */ }
}
