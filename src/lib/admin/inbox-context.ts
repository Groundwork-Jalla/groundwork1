import type { Conversation } from '@/lib/supabase/conversations';
import type { InboxProject } from '@/lib/supabase/inbox-context';

// =========================================================
// What the Inbox may say about a conversation's project (06 §19 D) — pure.
//
// The rule the whole thing turns on: a project the CONVERSATION names is a fact, and a
// project the PERSON happens to own is context. They are rendered differently and the
// second is never written to `conversations.project_id` — linking a thread to a project
// stays an explicit act by a person who knows which build the message is about.
// =========================================================

export type ProjectContextKind =
  /** `conversations.project_id` — somebody linked this thread to this project. */
  | 'linked'
  /** The person owns exactly one project. Context, not a claim about the thread. */
  | 'account'
  /** The person owns several. Groundwork does not guess which one this is about. */
  | 'choice'
  /** The person owns none, or there is no identified person. */
  | 'none';

export interface ProjectContext {
  kind: ProjectContextKind;
  /** The one project to show, for `linked` and `account`. */
  project: InboxProject | null;
  /** Every project of the person, for `choice` (and the one, for the others). */
  projects: InboxProject[];
}

export function projectContext(
  conversation: Pick<Conversation, 'projectId' | 'personId'>,
  byPerson: Map<string, InboxProject[]>,
): ProjectContext {
  const owned = (conversation.personId ? byPerson.get(conversation.personId) : undefined) ?? [];

  // 1. Explicitly linked wins, even when the person owns others. If the linked project is
  //    not among the person's (an admin linked a thread to someone else's build), it is
  //    still the conversation's project — the link is the statement.
  if (conversation.projectId) {
    const found = owned.find(p => p.id === conversation.projectId) ?? null;
    return { kind: 'linked', project: found, projects: owned };
  }
  if (owned.length === 1) return { kind: 'account', project: owned[0], projects: owned };
  if (owned.length > 1)  return { kind: 'choice',  project: null,     projects: owned };
  return { kind: 'none', project: null, projects: [] };
}

/** A person's display name: never a phone number, never a raw id. */
export function personLabel(
  fullName: string | null | undefined,
  email: string | null | undefined,
  fallback: string,
): { primary: string; secondary: string | null } {
  const name = (fullName ?? '').trim();
  const mail = (email ?? '').trim();
  if (name) return { primary: name, secondary: mail || null };
  if (mail)  return { primary: mail, secondary: null };
  return { primary: fallback, secondary: null };
}
