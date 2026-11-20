import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { Loader2, MessageCircle, Send, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage, useT, type TKey } from '@/lib/i18n';
import { supabase } from '@/lib/supabase/client';
import {
  fetchLiveChatSettings,
  fetchMyLiveChatSession,
  listLiveChatMessages,
  markUserLiveChatRead,
  pollPublicLiveChat,
  sendPublicLiveChatMessage,
  sendSignedInLiveChatMessage,
  startPublicLiveChat,
  startSignedInLiveChat,
  type LiveChatMessage,
  type LiveChatSession,
  type LiveChatSettings,
} from '@/lib/supabase/live-chat';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'gw.livechat.visitor.v1';
const TOPICS = ['payments', 'project', 'contractor', 'other'] as const;
const UUID_IN_PATH = /\/(?:work\/)?projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

interface StoredVisitor {
  sessionId: string;
  visitorToken: string;
}

function readStoredVisitor(): StoredVisitor | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredVisitor>;
    if (typeof parsed.sessionId === 'string' && typeof parsed.visitorToken === 'string') {
      return { sessionId: parsed.sessionId, visitorToken: parsed.visitorToken };
    }
  } catch { /* ignore storage errors */ }
  return null;
}

/**
 * Floating Groundwork Live Chat widget for both signed-in users (Homeowners &
 * Contractors) and public website visitors. Managed directly from
 * `/admin/inbox?channel=live_chat`.
 */
export function LiveChatWidget() {
  const t = useT();
  const { lang } = useLanguage();
  const location = useLocation();
  const { user, accountRole } = useAuth();

  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<LiveChatSettings | null>(null);
  const [session, setSession] = useState<LiveChatSession | null>(null);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  // Visitor pre-chat / first-message state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState<string>('other');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visitorRef = useRef<StoredVisitor | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isStaff = accountRole === 'admin';
  const currentProjectId = location.pathname.match(UUID_IN_PATH)?.[1] ?? null;

  // Load availability settings once
  useEffect(() => {
    let alive = true;
    fetchLiveChatSettings()
      .then(s => { if (alive) setSettings(s); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Load existing session for signed-in user or returning visitor
  const loadExisting = useCallback(async (markRead = false) => {
    if (isStaff) return;
    if (user?.id) {
      try {
        const s = await fetchMyLiveChatSession(user.id);
        setSession(s);
        if (s) {
          const msgs = await listLiveChatMessages(s.id);
          setMessages(msgs.filter(m => m.senderType !== 'internal'));
          if (markRead && s.unreadForUser > 0) {
            void markUserLiveChatRead(s.id).catch(() => {});
            setSession(prev => (prev ? { ...prev, unreadForUser: 0 } : prev));
          }
        }
      } catch { /* non-blocking */ }
      return;
    }
    const stored = visitorRef.current ?? readStoredVisitor();
    if (!stored) return;
    visitorRef.current = stored;
    try {
      const res = await pollPublicLiveChat(stored.sessionId, stored.visitorToken, markRead);
      setSession(res.session);
      setMessages(res.messages);
    } catch {
      // Stale/expired token — reset cleanly so visitor can start fresh
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      visitorRef.current = null;
      setSession(null);
      setMessages([]);
    }
  }, [isStaff, user?.id]);

  useEffect(() => {
    setLoading(true);
    void loadExisting(false).finally(() => setLoading(false));
  }, [loadExisting]);

  // Realtime subscription for signed-in users; gentle 5s poll for open public visitors
  useEffect(() => {
    if (isStaff || !session?.id) return;
    if (user?.id) {
      const ch = supabase
        .channel(`live-chat-user:${session.id}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'live_chat_messages',
          filter: `session_id=eq.${session.id}`,
        }, () => { void loadExisting(open); })
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'live_chat_sessions',
          filter: `id=eq.${session.id}`,
        }, () => { void loadExisting(open); })
        .subscribe();
      return () => { void supabase.removeChannel(ch); };
    }
    if (!open) return;
    const timer = setInterval(() => { void loadExisting(true); }, 5000);
    return () => clearInterval(timer);
  }, [isStaff, session?.id, user?.id, open, loadExisting]);

  // Mark read when opening drawer & scroll to newest message
  useEffect(() => {
    if (!open) return;
    if (session && session.unreadForUser > 0) {
      void loadExisting(true);
    }
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages.length, session, loadExisting]);

  // Do not render the customer launcher on admin pages or for super admins
  if (isStaff || location.pathname.startsWith('/admin')) return null;

  const online = settings?.online ?? true;
  const greeting = lang === 'fr'
    ? (online ? settings?.greetingFr : settings?.awayFr)
    : (online ? settings?.greetingEn : settings?.awayEn);
  const unread = session?.unreadForUser ?? 0;

  async function handleStartOrSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);

    try {
      if (user?.id) {
        const displayName = String(user.user_metadata?.full_name ?? '').trim() || user.email || 'User';
        const role: 'homeowner' | 'contractor' = accountRole === 'contractor' ? 'contractor' : 'homeowner';
        if (!session) {
          const started = await startSignedInLiveChat({
            userId: user.id,
            name: displayName,
            email: user.email ?? '',
            role,
            topic,
            pagePath: location.pathname,
            projectId: currentProjectId,
            lang: lang === 'fr' ? 'fr' : 'en',
            firstMessage: text,
          });
          setSession(started.session);
          setMessages([started.message]);
        } else {
          const msg = await sendSignedInLiveChatMessage(session.id, user.id, displayName, text);
          setMessages(prev => [...prev, msg]);
        }
        setDraft('');
        return;
      }

      // Public visitor flow
      if (!session || !visitorRef.current) {
        if (name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
          setError(t('admin.liveChat.errorStart'));
          return;
        }
        const started = await startPublicLiveChat({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          topic,
          pagePath: location.pathname,
          lang: lang === 'fr' ? 'fr' : 'en',
          message: text,
        });
        visitorRef.current = { sessionId: started.sessionId, visitorToken: started.visitorToken };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(visitorRef.current)); } catch { /* ignore */ }
        setSession(started.session);
        setMessages(started.messages);
        setDraft('');
      } else {
        const msg = await sendPublicLiveChatMessage(session.id, visitorRef.current.visitorToken, text);
        setMessages(prev => [...prev, msg]);
        setDraft('');
      }
    } catch {
      setError(t('admin.liveChat.errorSend'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] right-4 z-40 sm:bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:right-5" data-live-chat-widget>
      {open && (
        <section
          role="dialog"
          aria-label={t('admin.liveChat.widgetTitle')}
          className="mb-3 flex h-[min(32rem,calc(100vh-7rem))] w-[min(22.5rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-brand-border-grey bg-white shadow-2xl dark:border-[#2c2c2c] dark:bg-[#1a1a1a]"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 bg-brand-green px-4 py-3 text-white">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{t('admin.liveChat.widgetTitle')}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/85">
                <span className={cn('inline-block size-2 rounded-full', online ? 'bg-[#4ade80]' : 'bg-amber-300')} />
                {t(online ? 'admin.liveChat.widgetSubOnline' : 'admin.liveChat.widgetSubAway')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('common.close')}
              className="rounded-lg p-1 text-white/85 hover:bg-white/10 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Messages / Starter */}
          <div ref={listRef} data-clarity-mask="true" className="flex-1 space-y-2.5 overflow-y-auto bg-brand-off-white p-3.5 dark:bg-[#121212]">
            {greeting && (
              <div className="max-w-[88%] rounded-2xl rounded-tl-sm border border-brand-border-grey bg-white px-3.5 py-2.5 text-xs leading-relaxed text-brand-near-black shadow-xs dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white">
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-green dark:text-[#b4d8bf]">
                  {t('admin.liveChat.staffLabel')}
                </p>
                {greeting}
              </div>
            )}

            {loading ? (
              <p className="flex items-center gap-1.5 py-4 text-xs text-brand-mid-grey">
                <Loader2 className="size-3.5 animate-spin" /> {t('common.loading')}
              </p>
            ) : messages.length === 0 ? (
              <div className="space-y-2 pt-1">
                <div className="flex flex-wrap gap-1.5">
                  {TOPICS.map(key => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTopic(key)}
                      aria-pressed={topic === key}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                        topic === key
                          ? 'border-brand-green bg-brand-green text-white'
                          : 'border-brand-border-grey bg-white text-brand-mid-grey hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e]',
                      )}
                    >
                      {t(`admin.liveChat.topics.${key}` as TKey)}
                    </button>
                  ))}
                </div>

                {!user && (
                  <div className="space-y-2 pt-1">
                    <input
                      type="text"
                      value={name}
                      onChange={e => { setName(e.target.value); setError(null); }}
                      placeholder={t('admin.liveChat.startName')}
                      aria-label={t('admin.liveChat.startName')}
                      className="w-full rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-xs text-brand-near-black outline-none focus:border-brand-green dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
                    />
                    <input
                      type="email"
                      value={email}
                      onChange={e => { setEmail(e.target.value); setError(null); }}
                      placeholder={t('admin.liveChat.startEmail')}
                      aria-label={t('admin.liveChat.startEmail')}
                      className="w-full rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-xs text-brand-near-black outline-none focus:border-brand-green dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white"
                    />
                  </div>
                )}
              </div>
            ) : (
              <>
                {messages.map(m => {
                  const mine = m.senderType === 'user';
                  return (
                    <div key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                      <div
                        className={cn(
                          'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-xs leading-relaxed shadow-xs',
                          mine
                            ? 'rounded-tr-sm bg-brand-green text-white'
                            : 'rounded-tl-sm border border-brand-border-grey bg-white text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white',
                        )}
                      >
                        {!mine && (
                          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-green dark:text-[#b4d8bf]">
                            {m.senderName || t('admin.liveChat.staffLabel')}
                          </p>
                        )}
                        {m.body}
                      </div>
                    </div>
                  );
                })}
                {session?.status === 'resolved' && (
                  <p className="rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-center text-[11px] text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
                    {t('admin.liveChat.resolvedNote')}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Composer */}
          <form onSubmit={handleStartOrSend} className="border-t border-brand-border-grey bg-white p-2.5 dark:border-[#2c2c2c] dark:bg-[#1a1a1a]">
            {error && <p role="alert" className="mb-1.5 text-[11px] text-state-alert">{error}</p>}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={draft}
                disabled={sending}
                onChange={e => { setDraft(e.target.value); setError(null); }}
                placeholder={messages.length === 0 ? t('admin.liveChat.startMessage') : t('admin.liveChat.typingPlaceholder')}
                aria-label={t('admin.liveChat.typingPlaceholder')}
                className="min-w-0 flex-1 rounded-xl border border-brand-border-grey bg-brand-off-white px-3 py-2 text-xs text-brand-near-black outline-none focus:border-brand-green dark:border-[#2c2c2c] dark:bg-[#121212] dark:text-white"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                aria-label={t('admin.liveChat.send')}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-green text-white transition-colors hover:bg-brand-green-hover disabled:opacity-40"
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Floating Launcher Pill */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        data-action="toggle-live-chat"
        aria-expanded={open}
        className="ml-auto flex items-center gap-2 rounded-full bg-brand-green px-4 py-2.5 text-xs font-bold text-white shadow-lg transition-transform hover:scale-[1.02] hover:bg-brand-green-hover"
      >
        <span className="relative flex items-center">
          <MessageCircle className="size-4" aria-hidden />
          <span className={cn('absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-brand-green', online ? 'bg-[#4ade80]' : 'bg-amber-300')} />
        </span>
        <span>{t('admin.liveChat.widgetLauncher')}</span>
        {unread > 0 && (
          <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-white px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-brand-green">
            {unread}
          </span>
        )}
      </button>
    </div>
  );
}
