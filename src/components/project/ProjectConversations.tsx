import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, MessageSquare, Phone } from 'lucide-react';
import { WhatsAppIcon } from '@/components/ui/WhatsAppIcon';
import { ConversationThread } from '@/components/admin/conversations/ConversationThread';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import {
  ensureProjectConversation, listConversations, listMyConversations, listProjectRoles,
  type Conversation,
} from '@/lib/supabase/conversations';
import { cn } from '@/lib/utils';
import { ensureMyWhatsApp } from '@/lib/supabase/my-whatsapp';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Which channel a thread is, at a glance.
 *
 * WhatsApp keeps its own green glyph here for the same reason it does in the admin top
 * bar: it is a brand people recognise instantly, and rendering it as one more grey
 * message bubble is what made the tab unreadable as "this one reaches my phone". The
 * other three stay monochrome, so the green means something.
 */
function ChannelIcon({ channel }: { channel: string }) {
  if (channel === 'whatsapp') return <WhatsAppIcon className="size-3.5 shrink-0" />;
  if (channel === 'email')    return <Mail className="size-3.5 shrink-0" />;
  if (channel === 'call')     return <Phone className="size-3.5 shrink-0" />;
  return <MessageSquare className="size-3.5 shrink-0" />;
}

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
  const userId = user?.id ?? null;
  const [threads, setThreads] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  /**
   * Which way the project's conversation is being carried.
   *
   * Not two inboxes. The project thread is ONE conversation, and this is the choice of
   * how the next message travels: read in Groundwork, or delivered to the other
   * participants' phones over WhatsApp (126). Every message stays on the project's
   * record either way, which is what makes "on their phone AND on Groundwork" true
   * rather than two half-conversations to reconcile.
   */
  const [channel, setChannel] = useState<'jalla' | 'whatsapp'>('jalla');
  const conversation = threads.find(c => c.id === activeId) ?? threads[0] ?? null;
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
      let mine = await listMyConversations();

      // A contractor saw a WhatsApp tab here and the client saw only Groundwork. Nothing
      // had ever created the client's thread: it took an admin pressing the WhatsApp
      // button, a message arriving from their phone, or 126's fan-out. Seeing the channel
      // that reaches your own phone should not wait on any of those, so if the person has
      // a number on file and no thread, establish it and list again.
      if (!mine.rows.some(r => r.channel === 'whatsapp') && userId) {
        if (await ensureMyWhatsApp(userId)) mine = await listMyConversations();
      }
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
  }, [projectId, t, userId]);

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

  // Separately from the threads: a failure here costs the labels, and must not cost
  // the conversation.
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
      {/* The project's conversation, and the two ways it can be carried. Shown whenever
          this is the project thread — the choice exists even before either has been used,
          because it is how you decide where the message goes, not a list of what exists. */}
      {conversation.projectId && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('project.chat.channels')}>
          {(['jalla', 'whatsapp'] as const).map(c => (
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
      )}

      {/* Threads that are not this project's — a WhatsApp or email chat staff opened with
          this person, which carries no project and would otherwise be invisible here. */}
      {threads.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('project.chat.channels')}>
          {threads.map(c => (
            <button
              key={c.id} type="button" role="tab"
              aria-selected={c.id === conversation.id}
              onClick={() => setActiveId(c.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                c.id === conversation.id
                  ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                  : 'border-brand-border-grey text-brand-mid-grey hover:text-brand-near-black dark:border-[#444]',
              )}
            >
              <ChannelIcon channel={c.channel} />
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
      // Only on the project's own thread. A one-to-one WhatsApp chat has two people in
      // it and tagging every line with a role there is noise, not clarity.
      roleOf={conversation.projectId ? (id => (id ? roles[id] ?? null : null)) : undefined}
      sendChannel={conversation.projectId ? channel : undefined}
      showOnlyChannel={conversation.projectId ? channel : undefined}
    />
    </div>
  );
}
