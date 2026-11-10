import { supabase } from './client';
import { detectLang } from '@/lib/i18n';
import type { Lang } from '@/lib/i18n/types';
import { trackFunnel } from '@/lib/analytics/funnel';
import { trackLifecycle } from '@/lib/analytics/lifecycle';

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

/**
 * Invite somebody to watch. Owner only — the server refuses anybody else.
 *
 * `isClient` says which of the two kinds of invitation this is. 112 built the table for
 * family; 166 reused it for the client of a contractor-run build, and 174 made that
 * distinction load-bearing: only the client may approve a stage, and a sibling must
 * never be able to unlock a payment. Default false, so the family case — the original
 * one — stays what it was and a new caller cannot grant approval by forgetting.
 */
export async function inviteProjectViewer(
  projectId: string, email: string, relationship?: string, isClient = false,
): Promise<string> {
  const { data, error } = await supabase.rpc('invite_project_viewer', {
    p_project: projectId, p_email: email, p_relationship: relationship ?? null,
    p_is_client: isClient,
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
export async function sendShareInviteEmail(
  shareToken: string,
  /**
   * The language the sender's screen is in. Falls back to what the device shows when
   * a caller has none in scope — never to nothing, because nothing means the country
   * decides, and that is the bug (see resolveRecipientLang).
   */
  lang: Lang = detectLang(),
): Promise<boolean> {
  try {
    // Through the dispatcher, not an endpoint of its own: Vercel's Hobby plan allows
    // 12 serverless functions and api/ is already at 11.
    const r = await fetch('/api/events?action=send-share-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send-share-invite', shareToken, lang }),
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

  /**
   * And close the reminder track.
   *
   * Communication Flow §8.1: accepting ends IV02/03/04 to the client and IV06/IV07 to
   * the contractor, and opens IV05 and IV08. Both events are sent because they mean
   * different things — `invitation_accepted` is the exit condition the pending
   * reminders are cancelled on (§9.3 rule 3), `project_membership_active` is the entry
   * condition for "connected", which is the outcome the whole document exists to reach.
   */
  trackLifecycle('invitation_accepted', projectId);
  trackLifecycle('project_membership_active', projectId);

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

/**
 * The builds somebody else owns that this person was invited onto, and accepted.
 *
 * The mirror of `fetchProjectViewers`: that one answers "who is watching this project",
 * this one answers "which projects am I watching". Both read the same table through the
 * same policy — `user_id = auth.uid()` is the first arm of `owner_reads_project_viewers`
 * — and 112's `project_viewers_by_user` index is exactly this query.
 *
 * Why it matters more than "family can see the build" suggests: 166 made a
 * CONTRACTOR-RUN project the ordinary case. The contractor owns the `projects` row, and
 * the person the house is for is a viewer. Every client surface loaded projects with
 * `user_id = me`, so that client signed in and was told they had no builds and should
 * start one — on the platform their own house was being tracked on.
 *
 * Ids rather than rows: the caller already has to fetch `projects` and would otherwise
 * read the same table twice.
 *
 * Empty rather than throwing when 112 is not applied, for the same reason as above — a
 * dashboard that will not load because one table is missing is worse than one without
 * the shared builds on it.
 */
export async function fetchSharedProjectIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('project_viewers')
    .select('project_id')
    .eq('user_id', userId)
    .not('accepted_at', 'is', null)
    .is('revoked_at', null);

  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return [];
    throw error;
  }
  // 112's partial unique index allows one live invitation per ADDRESS per project, so
  // one person reachable at two addresses can hold two live rows on the same build.
  // Deduplicated before the ids become an `in` filter.
  return [...new Set((data ?? []).map((r: { project_id: string }) => r.project_id))];
}
