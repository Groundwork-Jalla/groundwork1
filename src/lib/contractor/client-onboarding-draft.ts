export type ClientOnboardingDraft = {
  clientId: string | null;
  fullName: string;
  email: string;
  phase: 'details' | 'confirmation' | 'wizard';
};

const VERSION = 1;

function onboardingKey(contractorId: string): string {
  return `groundwork:client-onboarding:v${VERSION}:${encodeURIComponent(contractorId)}`;
}

/** Keep wizard answers separate for each contractor and client. */
export function clientProjectDraftKey(contractorId: string, clientId: string): string {
  return `groundwork:client-project:v${VERSION}:${encodeURIComponent(contractorId)}:${encodeURIComponent(clientId)}`;
}

/**
 * A client setting up their own project, and an admin doing it for one.
 *
 * These two wizards kept their answers in memory alone, so a refresh — or a phone
 * backgrounding the tab long enough for the browser to discard it — threw away every
 * answer and returned the person to the first question. Ruth, 28 October: "it needs
 * to stop taking us to the beginning after refreshing".
 *
 * Scoped per owner, and per client as well when an admin is acting for someone, so
 * one unfinished project can never surface inside another. Cleared on creation by the
 * confirm step, the same as the contractor draft.
 */
export function ownProjectDraftKey(ownerId: string, onBehalfOfId?: string | null): string {
  return onBehalfOfId
    ? `groundwork:managed-project:v${VERSION}:${encodeURIComponent(ownerId)}:${encodeURIComponent(onBehalfOfId)}`
    : `groundwork:own-project:v${VERSION}:${encodeURIComponent(ownerId)}`;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function parseDraft(value: unknown): ClientOnboardingDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const { clientId, fullName, email, phase } = candidate;
  if (typeof fullName !== 'string' || typeof email !== 'string') return null;
  if (phase !== 'details' && phase !== 'confirmation' && phase !== 'wizard') return null;
  if (phase === 'details') {
    if (clientId !== null) return null;
  } else if (typeof clientId !== 'string' || !clientId.trim()) {
    return null;
  }

  // Copy only the resumable fields. Passwords, tokens and other account data must
  // never enter browser storage, even if a caller supplies extra properties.
  return { clientId: clientId as string | null, fullName, email, phase };
}

/** The caller must recheck the restored client against the signed-in contractor. */
export function readClientOnboardingDraft(contractorId: string): ClientOnboardingDraft | null {
  if (!contractorId.trim()) return null;
  try {
    const raw = browserStorage()?.getItem(onboardingKey(contractorId));
    if (!raw) return null;
    const snapshot: unknown = JSON.parse(raw);
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
    const { version, draft } = snapshot as Record<string, unknown>;
    return version === VERSION ? parseDraft(draft) : null;
  } catch {
    return null;
  }
}

export function saveClientOnboardingDraft(contractorId: string, draft: ClientOnboardingDraft): void {
  if (!contractorId.trim()) return;
  const sanitized = parseDraft(draft);
  if (!sanitized) return;
  try {
    browserStorage()?.setItem(onboardingKey(contractorId), JSON.stringify({ version: VERSION, draft: sanitized }));
  } catch {
    // Storage may be blocked or full. Onboarding should still work in memory.
  }
}

export function clearClientOnboardingDraft(contractorId: string): void {
  if (!contractorId.trim()) return;
  try {
    browserStorage()?.removeItem(onboardingKey(contractorId));
  } catch {
    // A blocked browser store must not prevent finishing or restarting onboarding.
  }
}
