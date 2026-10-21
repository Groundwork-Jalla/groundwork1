import type { EmergencyContact } from '@/lib/supabase/contractor-onboarding';

// =========================================================
// Emergency contacts typed but not yet saved.
//
// 116 requires exactly three contacts and saves them in ONE call, so that a partial set
// never sits in the database looking finished. The cost is that a contractor who fills
// in the first contact, or the first two, and then walks away loses that typing: the
// panels resume correctly, but the form underneath them is blank again.
//
// This keeps those answers on their own device until the save goes through. The database
// invariant is untouched — nothing partial is ever written to it.
//
// ── Why localStorage, and not sessionStorage like the client draft ──────────────────
// `client-onboarding-draft.ts` uses sessionStorage, which is right for a flow somebody
// finishes in one sitting. This one exists precisely for the contractor who does not:
// "they stay away for a long time and continue where they stopped". sessionStorage is
// dropped when the tab closes, which is the case this is for.
//
// Only the three resumable fields are kept, and only under the contractor's own id, so
// another account signing in on the same browser never inherits them.
// =========================================================

const VERSION = 1;

const draftKey = (contractorId: string) =>
  `groundwork:emergency-contacts:v${VERSION}:${encodeURIComponent(contractorId)}`;

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** One contact, with anything a caller may have attached to it dropped. */
function parseContact(value: unknown): EmergencyContact | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { fullName, relationship, phone } = value as Record<string, unknown>;
  if (typeof fullName !== 'string' || typeof relationship !== 'string' || typeof phone !== 'string') {
    return null;
  }
  return { fullName, relationship, phone };
}

/** Exactly three, or nothing: the panels index into this array by position. */
function parseDraft(value: unknown): EmergencyContact[] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const rows = value.map(parseContact);
  if (rows.some(r => r === null)) return null;
  // All three blank is not a draft worth restoring.
  const rowsOk = rows as EmergencyContact[];
  const anyTyped = rowsOk.some(r => r.fullName.trim() || r.relationship.trim() || r.phone.trim());
  return anyTyped ? rowsOk : null;
}

export function readEmergencyContactDraft(contractorId: string): EmergencyContact[] | null {
  if (!contractorId.trim()) return null;
  try {
    const raw = browserStorage()?.getItem(draftKey(contractorId));
    if (!raw) return null;
    const snapshot: unknown = JSON.parse(raw);
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
    const { version, contacts } = snapshot as Record<string, unknown>;
    return version === VERSION ? parseDraft(contacts) : null;
  } catch {
    return null;
  }
}

export function saveEmergencyContactDraft(contractorId: string, contacts: EmergencyContact[]): void {
  if (!contractorId.trim()) return;
  const sanitized = parseDraft(contacts);
  if (!sanitized) return;
  try {
    browserStorage()?.setItem(draftKey(contractorId),
      JSON.stringify({ version: VERSION, contacts: sanitized }));
  } catch {
    // Blocked or full storage must not stop somebody finishing the form in memory.
  }
}

/** Called once the three are saved: the database is the record from then on. */
export function clearEmergencyContactDraft(contractorId: string): void {
  if (!contractorId.trim()) return;
  try {
    browserStorage()?.removeItem(draftKey(contractorId));
  } catch {
    // A blocked store must not prevent finishing or restarting onboarding.
  }
}
