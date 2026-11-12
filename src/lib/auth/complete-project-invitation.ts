import { acceptInvite } from '@/lib/supabase/invites';
import { acceptProjectViewer } from '@/lib/supabase/project-viewers';
import { fetchProject } from '@/lib/supabase/projects';
import {
  forgetProjectInvitation, rememberProjectInvitation, type ProjectInvitation,
} from './project-invitation';

/** Every fully authenticated entry point completes the same membership operation. */
export async function completeProjectInvitation(invitation: ProjectInvitation): Promise<string> {
  rememberProjectInvitation(invitation);
  const projectId = invitation.kind === 'viewer'
    ? await acceptProjectViewer(invitation.token)
    : await acceptInvite(invitation.token);
  // Membership writes and project reads are distinct permissions. Preserve the
  // continuation until this very session can read the destination through RLS.
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) throw new Error('invitation_access_pending');
  try {
    const project = await fetchProject(projectId);
    if (!project || project.id !== projectId) throw new Error('membership_not_visible');
  } catch (cause) {
    throw new Error('invitation_access_pending', { cause });
  }
  forgetProjectInvitation(invitation);
  return `${invitation.kind === 'viewer' ? '/projects' : '/work/projects'}/${projectId}`;
}
