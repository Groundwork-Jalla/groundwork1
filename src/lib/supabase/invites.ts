import { supabase } from './client';
import type { ContractorInviteRow } from '@/types/project';

// =========================================================
// inviteContractor — insert invite + fire-and-forget email
// =========================================================
export async function inviteContractor(
  projectId: string,
  invitedBy: string,
  email: string,
  projectName: string,
  inviterName: string,
): Promise<ContractorInviteRow> {
  const { data, error } = await supabase
    .from('contractor_invites')
    .insert({
      project_id: projectId,
      invited_by: invitedBy,
      email:      email.toLowerCase().trim(),
      role:       'contractor',
      status:     'pending',
    })
    .select()
    .single<ContractorInviteRow>();

  if (error) {
    if (error.message?.includes('starter_limit') || error.message?.includes('self_verify_limit')) {
      throw new Error('Self Verify plan allows 1 contractor per project. Upgrade to Jalla Verify for unlimited.');
    }
    throw error;
  }

  // Fire-and-forget email — invite record is the source of truth.
  fetch('/api/send-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toEmail:     email.toLowerCase().trim(),
      projectName,
      inviterName,
      inviteToken: data.token,
    }),
  }).catch(() => {});

  return data;
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
// revokeInvite
// =========================================================
export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await supabase
    .from('contractor_invites')
    .delete()
    .eq('id', inviteId);

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
