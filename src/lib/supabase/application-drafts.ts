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

/**
 * This browser's draft id **without minting one**.
 *
 * `draftId()` creates and stores an id when none exists, which is right for saving and
 * wrong for resuming: a first-time visitor has nothing to restore, and asking the server
 * about a UUID invented microseconds ago is a guaranteed miss. Worse, it is a *visible*
 * miss — the browser logs the failed request to the console whether or not the caller
 * handles it, so every new applicant would see errors from a lookup that could not have
 * succeeded.
 *
 * Null means "has not been here before". Don't ask.
 */
export function existingDraftId(): string | null {
  try {
    return localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

/** Forget this browser's draft — called once the application is actually submitted. */
export function clearDraftId(): void {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ }
}

/**
 * The draft id for a signed-in partner, minted once per contractor.
 *
 * Keyed by user id rather than sharing `DRAFT_KEY`, for two reasons. A contractor who
 * once filled in the public form on this browser already has a draft id sitting in
 * storage, and reusing it would flip that stranger's row to `in_app` and attach it to
 * the wrong person. And two partners signing in on one site-office machine would
 * otherwise write to the same row.
 *
 * The user's own id is deliberately NOT used as the draft id. 043's update policy is
 * `USING (true)` — the id IS the credential — so it has to stay unguessable.
 */
export function partnerDraftId(userId: string): string {
  const key = `${DRAFT_KEY}:partner:${userId}`;
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function clearPartnerDraftId(userId: string): void {
  try { localStorage.removeItem(`${DRAFT_KEY}:partner:${userId}`); } catch { /* nothing to clear */ }
}

/**
 * Close every open partner draft for this contractor.
 *
 * By user, not by draft id: somebody who starts on a phone and finishes on a laptop has
 * a row the laptop has never heard of, and marking only the local one would leave them
 * on the follow-up list for ever — chased for an application they already sent.
 */
export async function markPartnerDraftSubmitted(userId: string, applicationId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('contractor_application_drafts')
      .update({ submitted_application_id: applicationId, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('source', 'in_app')
      .is('submitted_application_id', null);
    if (error) throw error;
  } catch (err) {
    console.warn('[draft] mark partner submitted failed', err);
  }
}

export interface DraftSnapshot {
  /**
   * Which door they started at (138).
   *
   * 'public' is the open form at /contractor-apply; 'in_app' is the partner application
   * at /work/partner. Defaulted here rather than required, so the public form — which
   * knows nothing about any of this — keeps calling exactly as it did.
   */
  source?: 'public' | 'in_app';
  /** Required for an in_app draft: a partner is signed in and staff need to know who. */
  userId?: string;
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
  /**
   * The public form sends exactly the columns it always sent.
   *
   * `source` and `user_id` arrive with 138. Adding them to every write would mean that
   * between deploying this code and running that migration, PostgREST answered 42703 to
   * each save and the live capture of abandoned PUBLIC applications stopped — a working
   * feature broken by a change meant to extend it. The column defaults to 'public'
   * anyway, so saying so adds nothing.
   *
   * A partner draft names them because it has to: it is the whole point, and that path
   * is new, so it simply does nothing until the migration lands.
   */
  const partnerColumns = snap.source === 'in_app'
    ? { source: 'in_app', user_id: snap.userId ?? null }
    : {};

  const { error } = await supabase
    .from('contractor_application_drafts')
    .upsert({
      ...partnerColumns,
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
  /** 'public' (the open form) or 'in_app' (the partner application) — 138. */
  source: 'public' | 'in_app';
  user_id: string | null;
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

/**
 * The saved answers for this browser's draft, or null if there is nothing to resume.
 *
 * Goes through `get_contractor_draft` (migration 052) rather than a table read: the
 * applicant is anonymous and the only SELECT policy on the table is admin-only. The id
 * itself is the credential, which is the same basis on which they are already allowed to
 * write to the row.
 *
 * Null covers every uninteresting case — no draft, already submitted, older than thirty
 * days, RPC missing because the migration has not been applied — because the caller does
 * the same thing in all of them: start with an empty form.
 */
export async function fetchDraftPayload(id: string): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.rpc('get_contractor_draft', { p_id: id });
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}
