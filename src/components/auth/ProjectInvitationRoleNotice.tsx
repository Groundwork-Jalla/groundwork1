import { useT } from '@/lib/i18n';
import { useProjectInvitationRole } from '@/hooks/useProjectInvitationRole';

export function ProjectInvitationRoleNotice({ search }: { search: string }) {
  const state = useProjectInvitationRole(search); const t = useT();
  if (!state.invitation) return null;
  return <p role={state.failed ? 'alert' : 'status'} className="mt-3 text-sm text-brand-mid-grey">
    {t(state.failed ? 'invite.loadFailed' : state.role === 'contractor' ? 'projectLinks.contractorSignIn'
      : state.role === 'client' ? 'projectLinks.clientSignIn' : state.role === 'observer' ? 'projectLinks.observerSignIn' : 'common.loading')}
    {state.failed && <button type="button" onClick={state.retry} className="ml-2 underline">{t('common.retry')}</button>}
  </p>;
}
