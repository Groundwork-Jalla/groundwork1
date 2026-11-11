import { supabase } from './client';
import { trackLifecycle } from '@/lib/analytics/lifecycle';
import { detectLang } from '@/lib/i18n';
import type { Lang } from '@/lib/i18n/types';
import type { ContractorInviteRow } from '@/types/project';

// =========================================================
// inviteContractor — insert invite + send email
// =========================================================
export interface InviteResult {
  invite: ContractorInviteRow;
  emailSent: boolean;
}

export async function inviteContractor(
  projectId: string,
  _invitedBy: string,
  email: string,
  projectName: string,
  inviterName: string,
  senderLang: Lang = detectLang(),
): Promise<InviteResult> {
  // The language this screen is in, which is what the sender means the invitation in.
  //
  // This used to be `resolveRecipientLang(null, country)` — the COUNTRY default, 'fr'
  // for every Cameroon build — sent as `lang` on the reasoning that the invitee has no
  // stored preference. Production ignored it and read the row; now the server reads it
  // as the sender's screen language, in the last slot before the country guesses. Sent
  // as the country default it would have put French on every Cameroon invitation from
  // an English screen, which is precisely the bug: three invitations to Brian on
  // 10 Nov 2026, from an English account, all in French. The server still ranks every
  // stored choice above this — see resolveRecipientLang.
  const lang = senderLang;
  // The RPC chooses the inviter and permits only an initial primary assignment.
  // Subsequent project participants are invited as observers through project_viewers.
  const { data, error } = await supabase.rpc('invite_project_contractor', {
    p_project: projectId, p_email: email.toLowerCase().trim(),
  });
  if (error) throw error;
  const invite = (Array.isArray(data) ? data[0] : data) as ContractorInviteRow;
  if (!invite?.token) throw new Error('Invitation was not created');

  // Attempt to send email — always resolve, never block the invite from being shown.
  let emailSent = false;
  try {
    // Production reads every one of these from the invite row instead, keyed on the
    // token — the endpoint used to trust the body and had no auth at all. They are
    // still sent because the vite dev middleware (vite.config.ts) is a separate
    // implementation that does read them, and dev has no service-role key to look
    // the row up with.
    const r = await fetch('/api/send-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toEmail:     email.toLowerCase().trim(),
        projectName,
        inviterName,
        inviteToken: invite.token,
        lang,
      }),
    });
    emailSent = r.ok;
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      console.error('[invite] email send failed:', body);
    }
  } catch (err) {
    console.error('[invite] email fetch error:', err);
  }

  return { invite, emailSent };
}

// =========================================================
// fetchInvites — all invites for a project, newest first
// =========================================================
export async function fetchInvites(projectId: string): Promise<ContractorInviteRow[]> {
  const { data, error } = await supabase
    .from('contractor_invites')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

// =========================================================
// fetchTeam — every contractor across every project you own
//
// Powers the Team section in Settings: the owner's question there is "who has
// access to my builds", which is not answerable from one project's invite list.
// Returns one row per invite, each carrying its project name, so a contractor
// working on two of your builds legitimately appears twice.
// =========================================================
export interface TeamMember extends ContractorInviteRow {
  project_name: string;
}

export async function fetchTeam(projectIds: string[]): Promise<TeamMember[]> {
  if (projectIds.length === 0) return [];

  const { data, error } = await supabase
    .from('contractor_invites')
    .select('*, projects(name)')
    .in('project_id', projectIds)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map(row => {
    const { projects, ...invite } = row as ContractorInviteRow & { projects: { name: string } | null };
    return { ...invite, project_name: projects?.name ?? '' };
  });
}

// =========================================================
// revokeInvite
// =========================================================
export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_project_contractor_invite', { p_invite: inviteId });

  if (error) throw error;
}

// =========================================================
// getInviteByToken — public lookup (RPC with SECURITY DEFINER)
// =========================================================
export interface InviteDetails {
  project_id: string;
  invite_email: string;
  status: string;
  project_name: string;
  inviter_name: string;
}

export async function getInviteByToken(token: string): Promise<InviteDetails | null> {
  const { data, error } = await supabase
    .rpc('get_invite_by_token', { p_token: token });

  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0] as InviteDetails;
}

// =========================================================
// acceptInvite — marks invite accepted, sets contractor role
// =========================================================
export async function acceptInvite(token: string): Promise<string> {
  const { data: projectId, error } = await supabase
    .rpc('accept_contractor_invite', { p_token: token });

  if (error) {
    if (error.message?.includes('invite_invalid')) {
      throw new Error('This invite link is invalid or has already been used.');
    }
    throw error;
  }

  // Tag the user's session so UI can detect contractor role without an extra DB call.
  // Also mark onboarding_complete so returning contractors go to dashboard, not onboarding.
  await supabase.auth.updateUser({
    data: { role: 'contractor', onboarding_complete: true },
  });

  /**
   * Communication Flow §6.1: accepting ends CI02/03/04 to the contractor and
   * CI10/CI11 to the client, and opens either CI05 (onboarding still owed) or CI09
   * (already onboarded, straight onto the build).
   *
   * Which of those two the contractor gets is decided in GoHighLevel off
   * `onboarding_status`, not here — the endpoint reads that from the database on every
   * call, so a contractor who onboarded months ago is never asked to do it again
   * (§9.3 rule 4).
   */
  trackLifecycle('invitation_accepted', projectId as string);
  trackLifecycle('project_membership_active', projectId as string);

  return projectId as string;
}

// =========================================================
// fetchContractorProjects — projects the contractor is invited to
// =========================================================
export async function fetchContractorProjects(userId: string): Promise<import('@/types/project').ProjectRow[]> {
  const { data: invites, error: invErr } = await supabase
    .from('contractor_invites')
    .select('project_id')
    .eq('contractor_user_id', userId)
    .eq('status', 'accepted');

  if (invErr) throw invErr;
  if (!invites?.length) return [];

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .in('id', invites.map((i: { project_id: string }) => i.project_id));

  if (error) throw error;
  return data ?? [];
}
