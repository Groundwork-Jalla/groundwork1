import type { JallaAccount, JallaProject } from '@/lib/supabase/jalla-projects';

// =========================================================
// Choosing a project to message about (01 §3 COMMUNICATION) — pure.
//
// Jalla Messages are project-specific, and deliberately unlike WhatsApp: Groundwork owns
// this conversation model, so there is no provider constraint forcing one thread per
// person. Mary's Project A and Project B each have their own native thread, and that is
// the right shape — the conversation is about a build, not about a contact.
// =========================================================

/** Matches what a person would actually type: the project, its client, or where it is. */
export function matchesProject(p: JallaProject, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [p.name, p.ownerName ?? '', p.ownerEmail ?? '', p.city ?? '', p.country ?? '']
    .some(v => v.toLowerCase().includes(q));
}

/**
 * Can a conversation be started about this project?
 *
 * A project with no `user_id` has no client, and a Jalla thread is a conversation WITH
 * somebody — `project_conversation()` would insert a row whose `person_id` is null. The
 * button is disabled and says why rather than creating a thread with nobody in it.
 */
export function canMessage(p: JallaProject): boolean {
  return !!p.ownerId;
}

/**
 * Matches an account by the things written on its row, or by any project it owns — so
 * typing a project name finds the person who owns it, which is how an admin who
 * remembers the build but not the client will actually search.
 */
export function matchesAccount(a: JallaAccount, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if ([a.name ?? '', a.email ?? ''].some(v => v.toLowerCase().includes(q))) return true;
  return a.projects.some(p => matchesProject(p, q));
}

/** Nothing to attach a message to. Shown, disabled, and told why. */
export const canMessageAccount = (a: JallaAccount): boolean => a.projects.some(canMessage);

/** Where the Inbox opens a native thread. Same addressing as every other admin deep link. */
export const jallaHref = (conversationId: string): string =>
  `/admin/inbox?channel=jalla&conversation=${conversationId}`;
