import { UserRound, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/lib/i18n';
import { useProjectTeamAccess } from '@/hooks/useProjectTeamAccess';
import { Button } from '@/components/ui/button';
import ContractorInvite from './ContractorInvite';
import { ShareProject } from './ShareProject';
import type { ProjectRow } from '@/types/project';

/** Project-scoped invitations, using the same accepted-role checks as the work view. */
export function ProjectTeam({ project }: { project: Pick<ProjectRow, 'id' | 'name'> }) {
  const t = useT();
  const { user } = useAuth();
  const { scope, access, error, refresh } = useProjectTeamAccess(project.id);

  const roleKey = access?.primaryClient ? 'teamAccess.primaryClient'
    : access?.primaryContractor ? 'teamAccess.primaryContractor'
    : access?.assignedContractor ? 'adminRole.contractor'
    : access?.projectRole === 'verifier' ? 'project.chat.role.verifier'
    : access?.projectRole === 'observer' ? 'teamAccess.observer'
    : access?.canChangeRoles ? 'adminRole.admin' : 'teamAccess.observer';

  return (
    <div key={scope} className="space-y-5">
      <header>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-brand-near-black dark:text-white">
          <Users className="size-5 shrink-0" aria-hidden />{t('projectTeam.title')}
        </h2>
        <p className="mt-1 text-sm text-brand-mid-grey">{t('projectTeam.body')}</p>
      </header>

      {!access ? (
        <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          {error ? <>
            <p role="alert" className="text-sm text-state-alert">{t('teamAccess.loadFailed')}</p>
            <Button type="button" variant="outline" className="mt-3 h-8 text-xs" onClick={() => { void refresh(); }}>{t('common.retry')}</Button>
          </> : <p role="status" className="text-sm text-brand-mid-grey">{t('common.loading')}</p>}
        </section>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[3fr_2fr]">
          <div className="min-w-0 space-y-5">
            <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
              <h3 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('projectTeam.yourRole')}</h3>
              <div className="mt-3 flex items-start gap-3">
                <UserRound className="mt-0.5 size-4 shrink-0 text-brand-mid-grey" aria-hidden />
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-brand-near-black dark:text-white">{user?.user_metadata?.full_name || user?.email || t('contractorPeople.you')}</p>
                  <p className="mt-0.5 text-xs text-brand-mid-grey">{t(roleKey)}</p>
                </div>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-brand-mid-grey">{t(access.canInvite ? 'projectTeam.manageAccess' : 'projectTeam.viewAccess')}</p>
            </section>

            {access.primaryClient && <div data-tour={access.canInviteContractor ? 'invite-contractor' : undefined}>
              <ContractorInvite projectId={project.id} projectName={project.name} userId={user?.id ?? ''} />
            </div>}
            {access.primaryContractor && <ShareProject projectId={project.id} asClient />}
          </div>

          {access.canInvite && <div className="min-w-0 space-y-3">
            <ShareProject projectId={project.id} />
            <p className="px-1 text-xs leading-relaxed text-brand-mid-grey">{t('teamAccess.roleChange')}</p>
          </div>}
        </div>
      )}
    </div>
  );
}
