import { supabase } from './client';

// =========================================================
// Contractor application drafts — saved while the form is being filled in.
//
// The form asks for ~18 things including uploads and three past projects. Without this,
// everyone who starts and does not finish leaves no trace at all.
//
// Two rules this module exists to enforce:
//
//   1. NEVER call .select() on a write. Applicants are anonymous and the table has no
//      SELECT policy for anon, so asking PostgREST to read the row back fails the whole
//      write with 42501 — the same trap documented in contractor-applications.ts.
//
//   2. A save failure is never surfaced to the applicant. They are trying to apply, not
//      to help us with our CRM; a red banner because our autosave hiccuped would cost us
//      the application we already have.
// =========================================================

const DRAFT_KEY = 'gw:contractorDraftId';

/**
 * The id for this browser's draft, minted once and reused.
 *
 * Kept in localStorage rather than derived from the email: the email is itself a field
 * they type part-way through, so keying on it would spawn a new row per keystroke.
 */
export function draftId(): string {
  try {
    const existing = localStorage.getItem(DRAFT_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(DRAFT_KEY, id);
    return id;
  } catch {
    // Private browsing with storage disabled. Still worth capturing, just not resumable.
    return crypto.randomUUID();
  }
}

/** Forget this browser's draft — called once the application is actually submitted. */
export function clearDraftId(): void {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ }
}

export interface DraftSnapshot {
  fullName?: string;
  email?: string;
  phone?: string;
  role?: string;
  /** Whole form state. Shape follows the form, deliberately not mirrored as columns. */
  payload: Record<string, unknown>;
  /** 0-100, so the follow-up list can sort "nearly done" above "typed one word". */
  progressPct: number;
}

/**
 * Write the draft. Fire-and-forget by design — see rule 2 above.
 *
 * Upsert rather than insert-then-update: the first save creates the row and every
 * subsequent one replaces it, with no round trip to find out which case we are in.
 */
export async function saveApplicationDraft(id: string, snap: DraftSnapshot): Promise<boolean> {
  try {
    await writeDraft(id, snap);
    return true;
  } catch (err) {
    // Swallowed on purpose, including a rejected fetch. Logged so it is visible in the
    // console during testing, but never thrown — an autosave must not be able to
    // interrupt someone applying.
    //
    // The boolean is what stops the form claiming "Answers saved" when nothing was:
    // before migration 043 runs, every one of these writes fails, and a badge that
    // appears anyway would turn the disclosure above it into a false statement.
    console.warn('[draft] save failed', err);
    return false;
  }
}

async function writeDraft(id: string, snap: DraftSnapshot): Promise<void> {
  const { error } = await supabase
    .from('contractor_application_drafts')
    .upsert({
      id,
      full_name:    snap.fullName?.trim() || null,
      email:        snap.email?.trim().toLowerCase() || null,
      phone:        snap.phone?.trim() || null,
      role:         snap.role || null,
      payload:      snap.payload,
      progress_pct: Math.max(0, Math.min(100, Math.round(snap.progressPct))),
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'id' });

  if (error) throw error;
}

/**
 * Mark a draft as having become a real application.
 *
 * This is what separates "abandoned" from "finished" in the admin list. It cannot use
 * the RETURNING clause for the same RLS reason as everything else here.
 */
export async function markDraftSubmitted(id: string, applicationId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('contractor_application_drafts')
      .update({ submitted_application_id: applicationId, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  } catch (err) {
    console.warn('[draft] mark submitted failed', err);
  }
}

// ── Admin side ───────────────────────────────────────────

export interface DraftRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  payload: Record<string, unknown>;
  progress_pct: number;
  submitted_application_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Drafts for the admin panel, newest first.
 *
 * `unsubmittedOnly` is the follow-up list — people who started and never finished. That
 * is the whole reason the table exists, so it is the default.
 */
export async function fetchApplicationDrafts(unsubmittedOnly = true): Promise<DraftRow[]> {
  let q = supabase
    .from('contractor_application_drafts')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(200);

  if (unsubmittedOnly) q = q.is('submitted_application_id', null);

  const { data, error } = await q;
  // Not swallowed the way the applicant-side writes are. An admin seeing an empty list
  // cannot tell "nobody started an application" from "migration 043 has not run", and
  // those call for opposite actions — so the page says which.
  if (error) throw error;
  return (data ?? []) as DraftRow[];
}

export async function deleteApplicationDraft(id: string): Promise<void> {
  const { error } = await supabase
    .from('contractor_application_drafts').delete().eq('id', id);
  if (error) throw error;
}
