import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ConversationThread } from '@/components/admin/conversations/ConversationThread';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import {
  ensureProjectConversation, listConversations, listMyConversations, type Conversation,
} from '@/lib/supabase/conversations';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Every thread this person can read about this build.
 *
 * ── Why it is not just the project's Jalla thread ───────────────────────────────────
 * It was, and that was the bug reported from testing: staff messaged a client and a
 * contractor over WhatsApp and neither could see it anywhere. `project-whatsapp`
 * deliberately never links a WhatsApp chat to a project — the chat belongs to the
 * person — so a view filtered by project is structurally blind to it.
 *
 * So this shows the project's own thread AND the threads that are theirs, and lets
 * them pick. One conversation, no picker; more than one, a row of channels. RLS
 * decides what comes back either way.
 */
export function ProjectConversations({ projectId, projectName }: { projectId: string; projectName: string }) {
  const t = useT();
  const { user } = useAuth();
  const [threads, setThreads] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const conversation = threads.find(c => c.id === activeId) ?? threads[0] ?? null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let result = await listConversations({ projectId });
      setAvailable(result.available);
      if (!result.available) { setThreads([]); return; }

      // The project's own thread, created on first visit so there is always somewhere
      // to write even before anybody has.
      if (!result.rows.some(row => row.channel === 'jalla')) {
        await ensureProjectConversation(projectId);
        result = await listConversations({ projectId });
        setAvailable(result.available);
      }

      // Plus whatever is theirs — the WhatsApp or email thread staff opened with them,
      // which carries no project and would otherwise be invisible here.
      const mine = await listMyConversations();
      const seen = new Set(result.rows.map(r => r.id));
      const all = [...result.rows, ...mine.rows.filter(r => !seen.has(r.id))];

      // The project thread leads; the rest by most recent, so a reply that just
      // arrived on WhatsApp is the next thing they see.
      all.sort((a, b) =>
        (b.channel === 'jalla' ? 1 : 0) - (a.channel === 'jalla' ? 1 : 0)
        || (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));

      setThreads(all);
      setActiveId(prev => (prev && all.some(c => c.id === prev)) ? prev : (all[0]?.id ?? null));
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  const refreshConversation = useCallback(async () => {
    try {
      const [project, mine] = await Promise.all([listConversations({ projectId }), listMyConversations()]);
      setAvailable(project.available);
      const seen = new Set(project.rows.map(r => r.id));
      setThreads([...project.rows, ...mine.rows.filter(r => !seen.has(r.id))]);
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
    }
  }, [projectId, t]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <p role="status" className="flex items-center gap-2 py-8 text-sm text-brand-mid-grey">
      <Loader2 className="size-4 animate-spin" />{t('common.loading')}
    </p>;
  }
  if (!available) {
    return <p role="status" className="rounded-xl border border-brand-border-grey p-5 text-sm text-brand-mid-grey dark:border-[#2c2c2c]">
      {t('project.chat.unavailable')}
    </p>;
  }
  if (error) {
    return <div className="rounded-xl border border-state-alert/40 bg-state-alert/5 p-5 text-sm text-state-alert">
      <p role="alert">{error}</p>
      <button type="button" onClick={() => void load()} className="mt-2 text-xs underline">
        {t('common.retry')}
      </button>
    </div>;
  }
  if (!conversation || !user) return null;

  return (
    <div className="space-y-3">
      {/* Only when there is a choice to make. One thread needs no chooser. */}
      {threads.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('project.chat.channels')}>
          {threads.map(c => (
            <button
              key={c.id} type="button" role="tab"
              aria-selected={c.id === conversation.id}
              onClick={() => setActiveId(c.id)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                c.id === conversation.id
                  ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                  : 'border-brand-border-grey text-brand-mid-grey hover:text-brand-near-black dark:border-[#444]',
              )}
            >
              {t(`project.chat.channel.${c.channel}` as never)}
            </button>
          ))}
        </div>
      )}

    <ConversationThread
      key={conversation.id}
      conversation={conversation}
      staff={null}
      staffName={() => ''}
      onChanged={() => { void refreshConversation(); }}
      realtimeProjectId={projectId}
      title={projectName}
      memberView
      currentUserId={user.id}
    />
    </div>
  );
}
