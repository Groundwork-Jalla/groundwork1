import { useEffect, useState } from 'react';
import { getInviteByToken } from '@/lib/supabase/invites';
import { getViewerInvitePreview } from '@/lib/supabase/project-viewers';
import { readProjectInvitation } from '@/lib/auth/project-invitation';

const noStoredInvitation = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
type Role = 'client' | 'contractor' | 'observer';

/** Copy follows the server's invitation; no URL value grants a project/account role. */
export function useProjectInvitationRole(search: string) {
  const invitation = readProjectInvitation(search, noStoredInvitation);
  const scope = invitation ? `${invitation.kind}:${invitation.token}` : '';
  const [read, setRead] = useState<{ scope: string; role?: Role; failed?: boolean }>({ scope: '' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!invitation) return;
    const load = async () => {
      try {
        const preview = invitation.kind === 'contractor' ? await getInviteByToken(invitation.token) : await getViewerInvitePreview(invitation.token);
        if (!preview) throw new Error('invitation_unavailable');
        const role: Role = invitation.kind === 'contractor' ? 'contractor' : 'isClient' in preview && preview.isClient ? 'client' : 'observer';
        if (alive) setRead({ scope, role });
      } catch { if (alive) setRead({ scope, failed: true }); }
    };
    void load(); return () => { alive = false; };
  }, [scope, attempt]);
  const role = read.scope === scope ? read.role : undefined;
  const failed = read.scope === scope && read.failed === true;
  return { invitation, role, failed, loading: !!invitation && !role && !failed,
    retry: () => { setRead({ scope }); setAttempt(value => value + 1); } };
}
