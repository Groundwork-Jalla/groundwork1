import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { fetchClientProjects } from '@/lib/supabase/projects';
import { supabase } from '@/lib/supabase/client';
import { useT } from '@/lib/i18n';
import type { ProjectRow } from '@/types/project';

/** Account-level contractor status does not hide memberships on other people's projects. */
export function SharedProjects({ assignedIds }: { assignedIds: string[] }) {
  const { user } = useAuth(); const t = useT();
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{ actor: string; projects: ProjectRow[]; error: boolean } | null>(null);
  useEffect(() => {
    if (!user) return;
    let live = true, generation = 0;
    async function load() {
      const version = ++generation;
      try {
        const result = await fetchClientProjects(user!.id);
        if (live && version === generation) setRead({ actor: user!.id, projects: result.shared, error: !!result.loadFailed });
      } catch { if (live && version === generation) setRead({ actor: user!.id, projects: [], error: true }); }
    }
    void load();
    const onFocus = () => { void load(); }; window.addEventListener('focus', onFocus);
    const channel = supabase.channel(`shared-work:${user.id}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_viewers', filter: `user_id=eq.${user.id}` }, onFocus).subscribe();
    return () => { live = false; window.removeEventListener('focus', onFocus); void supabase.removeChannel(channel); };
  }, [user?.id, attempt]);
  const current = read?.actor === user?.id ? read : null;
  const projects = current?.projects.filter(project => !assignedIds.includes(project.id) && project.status !== 'archived') ?? [];
  if (!projects.length && !current?.error) return null;
  return <section className="space-y-3">
    <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('project.reviewFollowUp.sharedProjects')}</h2>
    <p className="text-xs text-brand-mid-grey">{t('project.reviewFollowUp.sharedProjectsBody')}</p>
    {current?.error && <p role="alert" className="text-xs text-brand-mid-grey">{t('projects.loadFailed')}{' '}
      <button type="button" className="font-semibold underline" onClick={() => setAttempt(value => value + 1)}>{t('common.retry')}</button></p>}
    <ul className="space-y-2">{projects.map(project => <li key={project.id}>
      <Link to={`/projects/${project.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-brand-border-grey p-4 text-sm dark:border-[#2c2c2c]">
        <span className="font-semibold text-brand-near-black dark:text-white">{project.name}</span>
        <span className="text-xs text-brand-mid-grey">{t('dashboard.shared.badge')}</span>
      </Link>
    </li>)}</ul>
  </section>;
}
