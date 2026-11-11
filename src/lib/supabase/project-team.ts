import { supabase } from './client';

export interface ProjectTeamAccess {
  canInvite: boolean;
  primaryClient: boolean;
  primaryContractor: boolean;
  assignedContractor: boolean;
  canInviteClient: boolean;
  canInviteContractor: boolean;
  hasClientInvitation: boolean;
  hasContractor: boolean;
  hasPendingContractor: boolean;
  canChangeRoles: boolean;
  needsPrimaryReview: boolean;
}

/** Project roles come from accepted database memberships, never account metadata. */
export async function fetchProjectTeamAccess(projectId: string): Promise<ProjectTeamAccess> {
  const { data, error } = await supabase.rpc('project_team_access', { p_project: projectId });
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('Project permissions unavailable');
  return {
    canInvite: data.can_invite === true,
    primaryClient: data.primary_client === true,
    primaryContractor: data.primary_contractor === true,
    assignedContractor: data.assigned_contractor === true,
    canInviteClient: data.can_invite_client === true,
    canInviteContractor: data.can_invite_contractor === true,
    hasClientInvitation: data.has_client_invitation === true,
    hasContractor: data.has_contractor === true,
    hasPendingContractor: data.has_pending_contractor === true,
    canChangeRoles: data.can_change_roles === true,
    needsPrimaryReview: data.needs_primary_review === true,
  };
}

export async function setProjectClient(viewerId: string): Promise<void> {
  const { error } = await supabase.rpc('set_project_client', { p_viewer: viewerId });
  if (error) throw error;
}
