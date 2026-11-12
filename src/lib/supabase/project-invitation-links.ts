import { supabase } from './client';

export type ProjectInvitationRole = 'client' | 'contractor' | 'observer';
export interface ProjectInvitationLink {
  token: string;
  expiresAt: string;
}

/** Creation is separate from email delivery. Only the server chooses the token and expiry. */
export async function createProjectInvitationLink(projectId: string, role: ProjectInvitationRole): Promise<void> {
  const { data, error } = await supabase.rpc('create_project_invitation_link', { p_project: projectId, p_role: role });
  if (error) throw error;
  if (!data || typeof data.token !== 'string' || typeof data.expires_at !== 'string') throw new Error('invitation_link_unavailable');
}

export function projectInvitationLinkPath(role: ProjectInvitationRole, token: string): string {
  return `/${role === 'contractor' ? 'invite' : 'share'}/${encodeURIComponent(token)}`;
}

export function invitationLinkExpired(expiresAt?: string | null): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() <= Date.now();
}
