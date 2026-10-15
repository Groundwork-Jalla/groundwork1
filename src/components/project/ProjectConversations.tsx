import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ConversationThread } from '@/components/admin/conversations/ConversationThread';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { ensureProjectConversation, listConversations, type Conversation } from '@/lib/supabase/conversations';
import { useAuth } from '@/contexts/AuthContext';

/** The project's Jalla thread, shared by its client, assigned contractors and verifiers. */
export function ProjectConversations({ projectId, projectName }: { projectId: string; projectName: string }) {
  const t = useT();
  const { user } = useAuth();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let result = await listConversations({ projectId });
      setAvailable(result.available);
      if (!result.available) {
        setConversation(null);
        return;
      }

      let thread = result.rows.find(row => row.channel === 'jalla');
      if (!thread) {
        const id = await ensureProjectConversation(projectId);
        result = await listConversations({ projectId });
        setAvailable(result.available);
        thread = result.rows.find(row => row.id === id && row.channel === 'jalla')
          ?? result.rows.find(row => row.channel === 'jalla');
      }
      setConversation(thread ?? null);
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
      setConversation(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  const refreshConversation = useCallback(async () => {
    try {
      const result = await listConversations({ projectId });
      setAvailable(result.available);
      setConversation(result.rows.find(row => row.channel === 'jalla') ?? null);
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
  );
}
