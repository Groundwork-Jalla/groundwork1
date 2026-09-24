import type { JallaProject } from '@/lib/supabase/jalla-projects';

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

/** Where the Inbox opens a native thread. Same addressing as every other admin deep link. */
export const jallaHref = (conversationId: string): string =>
  `/admin/inbox?channel=jalla&conversation=${conversationId}`;
