import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, MessageSquare } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/lib/i18n';
import { listMyProjectsWithThreads, type ProjectThread } from '@/lib/supabase/my-threads';
import { ProjectConversations } from '@/components/project/ProjectConversations';
import { cn } from '@/lib/utils';

/**
 * Every conversation this person has, in one place.
 *
 * ── Why it exists ───────────────────────────────────────────────────────────────────
 * Messaging lived only inside a project, on a tab, so "talk to my contractor" meant
 * knowing which build to open first. The client's sidebar had no Messages at all — the
 * conversation was there and the door was not. `destinationFor` has been pointing a
 * project-less thread at `/messages` for a while, which until now was a dead link.
 *
 * ── One build at a time ─────────────────────────────────────────────────────────────
 * A conversation belongs to a project: it is about a building, the people on it, and the
 * stage it has reached. So this lists the builds and opens one, rather than merging
 * everything into a single stream where "is the slab fine?" loses the only context that
 * makes it answerable.
 */
export default function MessagesPage() {
  const t = useT();
  const { user } = useAuth();
  const [rows, setRows] = useState<ProjectThread[] | null>(null);
  const [active, setActive] = useState<ProjectThread | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    void listMyProjectsWithThreads().then(list => {
      if (!live) return;
      setRows(list);
      setActive(prev => prev ?? list[0] ?? null);
    });
    return () => { live = false; };
  }, [user]);

  if (!user || rows === null) {
    return <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <p role="status" className="flex items-center gap-2 py-8 text-sm text-brand-mid-grey">
        <Loader2 className="size-4 animate-spin" />{t('common.loading')}
      </p>
    </div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-brand-near-black dark:text-white">
          {t('nav.messages')}
        </h1>
        <p className="text-sm text-brand-mid-grey mt-0.5">{t('messages.sub')}</p>
      </div>

      {rows.length === 0 ? (
        /* Empty because nothing is there, never a sample thread. */
        <div className="rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] px-5 py-10 text-center">
          <MessageSquare className="size-6 text-brand-mid-grey mx-auto mb-3" />
          <p className="text-sm font-semibold text-brand-near-black dark:text-white">
            {t('messages.emptyTitle')}
          </p>
          <p className="text-xs text-brand-mid-grey mt-1">{t('messages.emptyBody')}</p>
          <Link to="/projects" className="mt-4 inline-block text-xs font-semibold underline">
            {t('nav.myProjects')}
          </Link>
        </div>
      ) : (
        <>
          {/* Which build. Only when there is more than one — a single project needs no
              chooser above its own conversation. */}
          {rows.length > 1 && (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('nav.myProjects')}>
              {rows.map(r => (
                <button
                  key={r.projectId} type="button" role="tab"
                  aria-selected={active?.projectId === r.projectId}
                  onClick={() => setActive(r)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                    active?.projectId === r.projectId
                      ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                      : 'border-brand-border-grey text-brand-mid-grey hover:text-brand-near-black dark:border-[#444]',
                  )}
                >
                  {r.projectName}
                </button>
              ))}
            </div>
          )}

          {active && (
            /* The same component the project tab uses, so the channel buttons, the role
               labels and the composer are one implementation rather than two that drift. */
            <ProjectConversations
              key={active.projectId}
              projectId={active.projectId}
              projectName={active.projectName}
            />
          )}
        </>
      )}
    </div>
  );
}
