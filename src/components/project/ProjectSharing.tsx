import { useId, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectTeamAccess } from '@/hooks/useProjectTeamAccess';
import { useT } from '@/lib/i18n';
import type { ProjectInvitationRole } from '@/lib/supabase/project-invitation-links';
import { Button } from '@/components/ui/button';
import ContractorInvite from './ContractorInvite';
import { ShareProject } from './ShareProject';
type SharingRole = ProjectInvitationRole | 'family';

/** The sender chooses the project role before any invitation is generated. */
export function ProjectSharing({ projectId, projectName }: { projectId: string; projectName: string }) {
  const t = useT(); const { user } = useAuth();
  const { scope, access, error, refresh } = useProjectTeamAccess(projectId);
  const id = useId();
  const [selection, setSelection] = useState<{ scope: string; role: SharingRole } | null>(null);
  const roles: SharingRole[] = !access?.canInvite ? [] : [
    ...(access.primaryContractor && (access.canInviteClient || access.hasClientInvitation) ? ['client' as const] : []),
    ...(access.primaryClient || access.canInviteAdditionalContractor ? ['contractor' as const] : []),
    'observer', 'family',
  ];
  const role = selection?.scope === scope && roles.includes(selection.role) ? selection.role : '';
  if (access && !access.canInvite) return null;
  return <div className="space-y-4" data-tour={access?.canInviteClient ? 'invite-client' : access?.canInviteContractor ? 'invite-contractor' : undefined}>
    <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h3 className="text-sm font-semibold">{t('projectLinks.chooseTitle')}</h3>
      <p className="mt-1 text-xs text-brand-mid-grey">{t('projectLinks.chooseBody')}</p>
      {!access ? <p role={error ? 'alert' : 'status'} className="mt-3 text-xs">{t(error ? 'teamAccess.loadFailed' : 'common.loading')}
        {error && <Button type="button" variant="outline" className="ml-2 h-8 text-xs" onClick={() => void refresh()}>{t('common.retry')}</Button>}</p>
        : <>
          <label htmlFor={id} className="mt-4 block text-xs font-semibold">{t('projectLinks.recipientRole')}</label>
          <select id={id} value={role} onChange={event => {
            const chosen = event.target.value as SharingRole;
            if (roles.includes(chosen)) setSelection({ scope, role: chosen });
          }} className="mt-2 w-full rounded-lg border border-brand-border-grey bg-transparent p-3 text-sm">
            <option value="" disabled>{t('projectLinks.choosePlaceholder')}</option>
            {roles.map(value => <option key={value} value={value}>{t(value === 'client' ? 'adminRole.client' : value === 'contractor' ? 'adminRole.contractor' : value === 'family' ? 'projectLinks.familyRole' : 'teamAccess.observer')}</option>)}
          </select>
          {role && <p role="status" className="mt-3 text-xs text-brand-mid-grey">{t(role === 'client' ? 'projectLinks.clientRoleHelp'
            : role === 'family' ? 'projectLinks.familyRoleHelp' : role === 'observer' ? 'projectLinks.observerRoleHelp' : access.canInviteAdditionalContractor ? 'projectLinks.additionalContractorHelp' : 'projectLinks.primaryContractorHelp')}</p>}
        </>}
    </section>
    {role === 'contractor' && <div key={`${scope}:contractor`}>
      <ContractorInvite projectId={projectId} projectName={projectName} userId={user?.id ?? ''}/>
    </div>}
    {role === 'client' && <ShareProject key={`${scope}:client`} projectId={projectId} asClient/>}
    {(role === 'observer' || role === 'family') && <ShareProject key={`${scope}:${role}`} projectId={projectId}/>}
  </div>;
}
