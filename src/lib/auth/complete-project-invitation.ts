import { acceptInvite } from '@/lib/supabase/invites';
import { acceptProjectViewer } from '@/lib/supabase/project-viewers';
import {
  forgetProjectInvitation, rememberProjectInvitation, type ProjectInvitation,
} from './project-invitation';

/** Every fully authenticated entry point completes the same membership operation. */
export async function completeProjectInvitation(invitation: ProjectInvitation): Promise<string> {
  rememberProjectInvitation(invitation);
  const projectId = invitation.kind === 'viewer'
    ? await acceptProjectViewer(invitation.token)
    : await acceptInvite(invitation.token);
  forgetProjectInvitation(invitation);
  return `${invitation.kind === 'viewer' ? '/projects' : '/work/projects'}/${projectId}`;
}
