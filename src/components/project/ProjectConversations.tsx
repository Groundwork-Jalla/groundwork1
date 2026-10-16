import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { WhatsAppIcon } from '@/components/ui/WhatsAppIcon';
import { ConversationThread } from '@/components/admin/conversations/ConversationThread';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import {
  ensureProjectConversation, listConversations, listProjectRoles, type Conversation,
} from '@/lib/supabase/conversations';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

/** WhatsApp keeps its own green glyph — a brand people recognise at a glance, where a
 *  grey bubble read as "one more message icon". Groundwork stays monochrome beside it,
 *  so the green means "this one reaches a phone". */
function ChannelIcon({ channel }: { channel: 'jalla' | 'whatsapp' }) {
  return channel === 'whatsapp'
    ? <WhatsAppIcon className="size-3.5 shrink-0" />
    : <MessageSquare className="size-3.5 shrink-0" />;
}

const CHANNELS = ['jalla', 'whatsapp'] as const;
type SendChannel = typeof CHANNELS[number];

/**
 * This project's conversation, and the two ways it can be carried.
 *
 * ── One conversation, two channels ──────────────────────────────────────────────────
 * Not two inboxes. The project has ONE thread and every message stays on its record; the
 * buttons choose how the next one travels — read in Groundwork, or delivered to the other
 * participants' phones over WhatsApp (126/129). That is what makes "on their phone AND on
 * Groundwork" true rather than two half-conversations to reconcile.
 *
 * ── What this deliberately no longer does ───────────────────────────────────────────
 * It used to also list the person's OWN project-less threads and show a second row of
 * tabs to switch between them, and it pre-created a WhatsApp thread before rendering.
 * Both were wrong, and reported as such:
 *
 *   · the second row made the client's screen a different, busier thing than the
 *     contractor's, for a choice that is now just "which channel";
 *   · establishing a thread is a round trip to the CRM and then the provider, and
 *     awaiting it before the first render left Messages stuck on "Loading…" — somebody
 *     unable to open a message that had been sent to them.
 *
 * Nothing a transport does may stand between a person and their conversation. The
 * person's WhatsApp thread is established when a message is actually sent to them, by
 * the fan-out, where the wait costs nobody a screen.
 */
export function ProjectConversations({ projectId, projectName }: { projectId: string; projectName: string }) {
  const t = useT();
  const { user } = useAuth();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  /** How the next message travels. Both are always offered: it is a choice about where
   *  the message goes, not a list of threads that happen to exist — which is exactly why
   *  the client used to see no WhatsApp at all. */
  const [channel, setChannel] = useState<SendChannel>('jalla');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  /** Who is what on this build, so a bubble can say so. Empty until it loads. */
  const [roles, setRoles] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let result = await listConversations({ projectId });
      setAvailable(result.available);
      if (!result.available) { setConversation(null); return; }

      // Created on first visit, so there is always somewhere to write even before
      // anybody has.
      if (!result.rows.some(row => row.channel === 'jalla')) {
        await ensureProjectConversation(projectId);
        result = await listConversations({ projectId });
        setAvailable(result.available);
      }
      setConversation(result.rows.find(r => r.channel === 'jalla') ?? result.rows[0] ?? null);
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
      setConversation(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => { void load(); }, [load]);

  // Separately: a failure here costs the role labels, and must not cost the conversation.
  useEffect(() => { void listProjectRoles(projectId).then(setRoles); }, [projectId]);

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
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('project.chat.channels')}>
        {CHANNELS.map(c => (
          <button
            key={c} type="button" role="tab"
            aria-selected={channel === c}
            onClick={() => setChannel(c)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
              channel === c
                ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                : 'border-brand-border-grey text-brand-mid-grey hover:text-brand-near-black dark:border-[#444]',
            )}
          >
            <ChannelIcon channel={c} />
            {t(`project.chat.channel.${c}` as never)}
          </button>
        ))}
      </div>

      <ConversationThread
        key={conversation.id}
        conversation={conversation}
        staff={null}
        staffName={() => ''}
        onChanged={() => { void load(); }}
        realtimeProjectId={projectId}
        title={projectName}
        memberView
        currentUserId={user.id}
        roleOf={id => (id ? roles[id] ?? null : null)}
        sendChannel={channel}
        showOnlyChannel={channel}
      />
    </div>
  );
}
