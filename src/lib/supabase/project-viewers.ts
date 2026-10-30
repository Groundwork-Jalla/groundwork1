import { supabase } from './client';
import { trackFunnel } from '@/lib/analytics/funnel';

// =========================================================
// Sharing a build with the people who care about it (112).
//
// A project has one owner. A spouse, a parent, whoever is putting money toward the house
// could see none of it, and the only workaround was sharing a password — which hands over
// the entire account, every project, and the ability to authorise things.
//
// ── Read, and only read ──────────────────────────────────────────────────────────────
// A viewer is the fourth kind of `project_member()`, and every policy behind that gate is
// FOR SELECT. They can see the build; they cannot approve a stage, move money, invite
// anybody or change a figure. The server decides that, not this file.
// =========================================================

export interface ProjectViewer {
  id: string;
  email: string;
  relationship: string | null;
  invitedAt: string;
  /** Null until they open the link and accept. */
  acceptedAt: string | null;
}

interface Row {
  id: string;
  email: string;
  relationship: string | null;
  invited_at: string;
  accepted_at: string | null;
}

/**
 * Who this project is shared with.
 *
 * Empty rather than throwing when 112 is not applied — a project page that will not load
 * because one panel has no table is worse than a panel with nothing in it.
 */
export async function fetchProjectViewers(projectId: string): Promise<ProjectViewer[]> {
  const { data, error } = await supabase
    .from('project_viewers')
    .select('id, email, relationship, invited_at, accepted_at')
    .eq('project_id', projectId)
    .is('revoked_at', null)
    .order('invited_at', { ascending: false });

  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return [];
    throw error;
  }
  return (data ?? []).map((r: Row) => ({
    id: r.id, email: r.email, relationship: r.relationship,
    invitedAt: r.invited_at, acceptedAt: r.accepted_at,
  }));
}

/** Who a project is shared with, as a list row needs it. */
export interface ViewerSummary {
  /** What to call them: their relationship if given, else the email's local part. */
  label: string;
  accepted: boolean;
}

/**
 * The client on each of several projects, in one query.
 *
 * The dashboard and the project list both name the client on every row — "client
 * Mr Nas, invited". One `in` over the project ids RLS has already narrowed, rather
 * than a round trip per row.
 *
 * Returns a map that is simply missing the projects nobody was invited to, so a
 * caller distinguishes "no client" from "not loaded" by whether the map itself is
 * null.
 */
export async function fetchViewerSummaries(
  projectIds: string[],
): Promise<Map<string, ViewerSummary>> {
  const out = new Map<string, ViewerSummary>();
  if (projectIds.length === 0) return out;

  const { data, error } = await supabase
    .from('project_viewers')
    .select('project_id, email, relationship, accepted_at')
    .in('project_id', projectIds)
    .is('revoked_at', null)
    .order('invited_at', { ascending: true });
  // A deployment without 112 has no table. An absent panel beats a broken page.
  if (error) return out;

  for (const row of (data ?? []) as { project_id: string; email: string;
                                      relationship: string | null; accepted_at: string | null }[]) {
    // The FIRST invitation is the client; later ones are family the client added.
    if (out.has(row.project_id)) continue;
    const named = row.relationship?.trim();
    out.set(row.project_id, {
      label: named && named !== '' ? named : row.email.split('@')[0],
      accepted: row.accepted_at !== null,
    });
  }
  return out;
}

export class ShareFailed extends Error {
  constructor(public code: string) { super(code); }
}

function fail(message: string): never {
  const known = ['not_owner', 'invalid_email', 'self_invite', 'no_project', 'revoked',
                 'already_accepted', 'invalid_token', 'not_permitted']
    .find(c => message.includes(c));
  throw new ShareFailed(known ?? 'failed');
}

/** Invite somebody to watch. Owner only — the server refuses anybody else. */
export async function inviteProjectViewer(
  projectId: string, email: string, relationship?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('invite_project_viewer', {
    p_project: projectId, p_email: email, p_relationship: relationship ?? null,
  });
  if (error) fail(error.message);
  // An invitation was SENT. Philip asked for "sent invitations along with their
  // acceptance status", so the pair is the project: one invitation per project is
  // the unit being followed up, and the acceptance below closes the same subject.
  trackFunnel('client_invitation', 'started', projectId);
  return String(data);
}

/**
 * Actually put the invitation in their inbox.
 *
 * Separate from `inviteProjectViewer` because the two can fail independently and the
 * caller has to tell them apart: the row existing means they are on the project and
 * the link works; the email going out means they know about it. Saying "Invitation
 * sent" for the first was the bug — the row was always written, the email was never
 * sent at all, and nobody could see the difference.
 *
 * Resolves false rather than throwing: a send that failed must not lose the row, and
 * the owner can copy the link instead.
 */
export async function sendShareInviteEmail(shareToken: string): Promise<boolean> {
  try {
    // Through the dispatcher, not an endpoint of its own: Vercel's Hobby plan allows
    // 12 serverless functions and api/ is already at 11.
    const r = await fetch('/api/events?action=send-share-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send-share-invite', shareToken }),
    });
    if (!r.ok) {
      console.error('[share] email send failed:', await r.json().catch(() => ({})));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[share] email fetch error:', err);
    return false;
  }
}

/** The link itself, for when the email could not be sent or they want to paste it. */
export function shareLinkFor(shareToken: string): string {
  return `${window.location.origin}/share/${encodeURIComponent(shareToken)}`;
}

export interface ViewerInvitePreview {
  projectName: string;
  invitedByName: string;
  accepted: boolean;
}

/**
 * Whose build this is, readable before sign-in.
 *
 * Granted to anon on purpose: a family member may have no Groundwork account at all, and
 * a page that cannot name the project reads as a phishing link.
 */
export async function getViewerInvitePreview(token: string): Promise<ViewerInvitePreview | null> {
  const { data, error } = await supabase.rpc('project_viewer_preview', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    projectName:   String(row.project_name ?? ''),
    invitedByName: String(row.invited_by_name ?? ''),
    accepted:      row.accepted === true,
  };
}

/** Accept, and return the project now visible. */
export async function acceptProjectViewer(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_project_viewer', { p_token: token });
  if (error) fail(error.message);
  const projectId = String(data);
  // Accepted. This is the step that moves a project from qualified toward verified
  // (169), which is why Philip wanted the acceptance tracked and not just the send.
  //
  // Recorded against the CLIENT, who is the person signed in here — so the pair is
  // "this client was invited to this project and joined it", not the contractor's.
  trackFunnel('client_invitation', 'completed', projectId);
  return projectId;
}

/** The owner takes it back — or the viewer removes their own access. Immediate. */
export async function revokeProjectViewer(viewerId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_project_viewer', { p_viewer: viewerId });
  if (error) fail(error.message);
}

/** Where sign-up parks a share token while the person goes to their email. */
export const PENDING_SHARE_KEY = 'pendingProjectShare';

export function rememberShare(token: string): void {
  try { localStorage.setItem(PENDING_SHARE_KEY, token); } catch { /* private mode */ }
}

export function takeRememberedShare(): string | null {
  try {
    const t = localStorage.getItem(PENDING_SHARE_KEY);
    if (t) localStorage.removeItem(PENDING_SHARE_KEY);
    return t;
  } catch { return null; }
}
