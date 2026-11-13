import { supabase } from './client';

export type ProjectInvitationRole = 'client' | 'contractor' | 'observer';
export interface ProjectInvitationLink {
  token: string;
}

/** Creation is separate from email delivery. Only the server chooses the token. */
export async function createProjectInvitationLink(projectId: string, role: ProjectInvitationRole): Promise<void> {
  const { data, error } = await supabase.rpc('create_project_invitation_link', { p_project: projectId, p_role: role });
  if (error) throw error;
  if (!data || typeof data.token !== 'string') throw new Error('invitation_link_unavailable');
}

export function projectInvitationLinkPath(role: ProjectInvitationRole, token: string): string {
  return `/${role === 'contractor' ? 'invite' : 'share'}/${encodeURIComponent(token)}`;
}
