import type { LoadedWorkspace } from '@/lib/supabase/workspace';
import { TeamCard } from './TeamCard';
import { DomainNote } from './DomainNote';
import { formatRelative } from '@/lib/format';
import { useT, type TKey } from '@/lib/i18n';

// =========================================================
// Workspace → Team (01 §3 PEOPLE, 06 §21).
//
// Who is on this project, and who may act on it. An ADMINISTRATIVE surface: it shows the
// assignments and changes them through the RPCs that already exist. It is not the
// contractor's or the verifier's screen — those are /contractors and /verifiers, separate
// products over the same rows (`contractor_invites` 029/030, `project_verifiers` 086).
//
// The tab was advertised in the tab bar before it existed. This is that promise kept: the
// card that briefly lived on the Overview tab is here, where the tab bar says it is, plus
// the assignment history the card has no room for.
// =========================================================

export function TeamTab({ loaded, onChanged, onNotice }: {
  loaded: LoadedWorkspace;
  onChanged: () => void;
  onNotice: (message: string) => void;
}) {
  const t = useT();
  const ws = loaded.workspace;
  const verifiersAvailable = ws.available.verifiers;
  const invitesAvailable = ws.available.invites;

  return (
    <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:p-8">
      <TeamCard ws={ws} available={verifiersAvailable} onChanged={onChanged} onNotice={onNotice} />

      {/* ── When each person joined, and on whose authority ───────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <header className="border-b border-brand-border-grey px-5 py-3.5 dark:border-[#2c2c2c]">
          <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('admin.workspace.team.historyTitle')}</h2>
          <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.workspace.team.historySub')}</p>
        </header>

        {!invitesAvailable && !verifiersAvailable ? (
          <DomainNote state="unavailable" />
        ) : ws.team.contractors.length === 0 && ws.team.verifiers.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-brand-mid-grey">{t('admin.workspace.team.historyEmpty')}</p>
        ) : (
          <ol className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
            {ws.team.contractors.map(c => (
              <li key={`c-${c.id}`} className="px-5 py-3">
                <p className="text-sm text-brand-near-black dark:text-white">{c.name}</p>
                <p className="mt-0.5 text-[11px] text-brand-mid-grey">
                  {t('admin.workspace.team.contractors')}
                  {' · '}{t(`admin.workspace.team.inviteStatus.${c.status}` as TKey)}
                  {c.created_at && ` · ${t('admin.workspace.team.invitedWhen', { when: formatRelative(c.created_at) })}`}
                  {c.accepted_at && ` · ${t('admin.workspace.team.acceptedWhen', { when: formatRelative(c.accepted_at) })}`}
                </p>
              </li>
            ))}
            {ws.team.verifiers.map(v => (
              <li key={`v-${v.id}`} className="px-5 py-3">
                <p className="text-sm text-brand-near-black dark:text-white">{v.name}</p>
                <p className="mt-0.5 text-[11px] text-brand-mid-grey">
                  {t('admin.workspace.team.verifiers')}
                  {v.discipline && ` · ${v.discipline}`}
                  {v.assignedAt && ` · ${t('admin.workspace.team.assignedWhen', { when: formatRelative(v.assignedAt) })}`}
                  {v.status === 'removed' && ` · ${t('admin.workspace.team.inviteStatus.rejected')}`}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
