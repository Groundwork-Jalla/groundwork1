import { supabase } from './client';
import type { ContractorInviteRow } from '@/types/project';

// =========================================================
// inviteContractor — insert invite record
// TODO: Wire email sending via Resend when integration is ready
// =========================================================
export async function inviteContractor(
  projectId: string,
  invitedBy: string,
  email: string,
): Promise<ContractorInviteRow> {
  const { data, error } = await supabase
    .from('contractor_invites')
    .insert({
      project_id:  projectId,
      invited_by:  invitedBy,
      email:       email.toLowerCase().trim(),
      role:        'contractor',
      status:      'pending',
    })
    .select()
    .single<ContractorInviteRow>();

  if (error) throw error;
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
