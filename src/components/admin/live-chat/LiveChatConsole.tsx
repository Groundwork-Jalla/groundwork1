import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, ExternalLink, Loader2, MessageSquare, RotateCcw, Search, Send, UserCheck, Zap } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useT, type TKey } from '@/lib/i18n';
import { supabase } from '@/lib/supabase/client';
import {
  fetchLiveChatSettings,
  listLiveChatMessages,
  listLiveChatSessions,
  sendStaffLiveChatMessage,
  setLiveChatOnline,
  updateLiveChatSession,
  type LiveChatMessage,
  type LiveChatSession,
  type LiveChatSettings,
} from '@/lib/supabase/live-chat';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

type QueueFilter = 'all' | 'waiting' | 'mine' | 'resolved';

const QUICK_REPLIES: { key: TKey; bodyKey: TKey }[] = [
  { key: 'admin.liveChat.qrFollowUp', bodyKey: 'admin.liveChat.qrFollowUpText' },
  { key: 'admin.liveChat.qrReceipt',  bodyKey: 'admin.liveChat.qrReceiptText' },
  { key: 'admin.liveChat.qrInvite',   bodyKey: 'admin.liveChat.qrInviteText' },
  { key: 'admin.liveChat.qrStage',    bodyKey: 'admin.liveChat.qrStageText' },
];

const ROLE_TONE: Record<LiveChatSession['visitorRole'], string> = {
  homeowner:  'bg-brand-green/10 text-brand-green dark:text-[#b4d8bf]',
  contractor: 'bg-state-held/15 text-state-held',
  visitor:    'bg-brand-light-grey text-brand-mid-grey dark:bg-[#2a2a2a]',
};

/**
 * Admin Live Chat Console (`/admin/inbox?channel=live_chat`).
 * Manages real-time chats from both signed-in users and public website visitors.
 */
export function LiveChatConsole() {
  const t = useT();
  const { user } = useAuth();

  const [sessions, setSessions] = useState<LiveChatSession[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [settings, setSettings] = useState<LiveChatSettings | null>(null);
  const [togglingOnline, setTogglingOnline] = useState(false);

  const [filter, setFilter] = useState<QueueFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const [composerMode, setComposerMode] = useState<'staff' | 'internal'>('staff');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    try {
      const [res, cfg] = await Promise.all([listLiveChatSessions(), fetchLiveChatSettings()]);
      setSessions(res.rows);
      setAvailable(res.available);
      setSettings(cfg);
      setError(null);
    } catch (err) {
      setSessions([]);
      setError(errorMessage(err, t('common.somethingWrong')));
    }
  }, [t]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  const selected = useMemo(
    () => (sessions ?? []).find(s => s.id === selectedId) ?? (sessions ?? [])[0] ?? null,
    [sessions, selectedId],
  );

  const loadMessages = useCallback(async (sessionId: string) => {
    setLoadingMsgs(true);
    try {
      const rows = await listLiveChatMessages(sessionId);
      setMessages(rows);
    } catch { /* non-blocking */ }
    finally { setLoadingMsgs(false); }
  }, []);

  useEffect(() => {
    if (!selected?.id) { setMessages([]); return; }
    void loadMessages(selected.id);
    if (selected.unreadForStaff > 0) {
      void updateLiveChatSession(selected.id, { unread_for_staff: 0 }).catch(() => {});
      setSessions(prev => prev?.map(s => (s.id === selected.id ? { ...s, unreadForStaff: 0 } : s)) ?? null);
    }
  }, [selected?.id, selected?.unreadForStaff, loadMessages]);

  // Real-time subscription for new sessions & messages
  useEffect(() => {
    const ch = supabase
      .channel('admin-live-chat-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_chat_sessions' }, () => {
        void loadSessions();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_chat_messages' }, payload => {
        const sid = (payload.new as { session_id?: string } | null)?.session_id;
        if (sid && sid === selected?.id) void loadMessages(sid);
        void loadSessions();
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [loadSessions, loadMessages, selected?.id]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const counts = useMemo(() => {
    const list = sessions ?? [];
    return {
      all: list.filter(s => s.status !== 'resolved').length,
      waiting: list.filter(s => s.status === 'waiting_on_us').length,
      mine: list.filter(s => !!user?.id && s.assignedTo === user.id && s.status !== 'resolved').length,
      resolved: list.filter(s => s.status === 'resolved').length,
    };
  }, [sessions, user?.id]);

  const shown = useMemo(() => {
    const list = sessions ?? [];
    const q = query.trim().toLowerCase();
    return list.filter(s => {
      if (filter === 'all' && s.status === 'resolved') return false;
      if (filter === 'waiting' && s.status !== 'waiting_on_us') return false;
      if (filter === 'mine' && (!user?.id || s.assignedTo !== user.id || s.status === 'resolved')) return false;
      if (filter === 'resolved' && s.status !== 'resolved') return false;
      if (!q) return true;
      return `${s.visitorName} ${s.visitorEmail} ${s.lastMessagePreview} ${s.pagePath}`.toLowerCase().includes(q);
    });
  }, [sessions, filter, query, user?.id]);

  async function toggleOnline() {
    if (!user?.id || !settings || togglingOnline) return;
    const next = !settings.online;
    setTogglingOnline(true);
    try {
      await setLiveChatOnline(next, user.id);
      setSettings(prev => (prev ? { ...prev, online: next } : prev));
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
    } finally {
      setTogglingOnline(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !user?.id || !draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const staffName = String(user.user_metadata?.full_name ?? '').trim() || user.email || 'Groundwork';
      const msg = await sendStaffLiveChatMessage(selected.id, user.id, staffName, draft.trim(), composerMode);
      setMessages(prev => [...prev, msg]);
      setDraft('');
      if (composerMode === 'staff' && !selected.assignedTo) {
        await updateLiveChatSession(selected.id, { assigned_to: user.id }).catch(() => {});
      }
      await loadSessions();
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
    } finally {
      setSending(false);
    }
  }

  async function handleAssignMe() {
    if (!selected || !user?.id) return;
    await updateLiveChatSession(selected.id, { assigned_to: user.id });
    await loadSessions();
  }

  async function handleResolveToggle() {
    if (!selected) return;
    const resolving = selected.status !== 'resolved';
    await updateLiveChatSession(selected.id, {
      status: resolving ? 'resolved' : 'waiting_on_us',
      resolved_at: resolving ? new Date().toISOString() : null,
    });
    await loadSessions();
  }

  const card = 'rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]';

  return (
    <div className="space-y-4 p-4 sm:p-6" data-live-chat-console>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-brand-near-black dark:text-white">
            <MessageSquare className="size-5 text-brand-green" aria-hidden />
            {t('admin.liveChat.title')}
          </h1>
          <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.liveChat.sub')}</p>
        </div>

        {/* Live Online / Away availability toggle */}
        <div className="flex items-center gap-3 rounded-xl border border-brand-border-grey bg-white px-3.5 py-2 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-near-black dark:text-white">
            <span className={cn('size-2 rounded-full', settings?.online ? 'bg-state-complete' : 'bg-state-held')} />
            {t(settings?.online ? 'admin.liveChat.online' : 'admin.liveChat.away')}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(settings?.online)}
            aria-label={t('admin.liveChat.statusToggle')}
            data-action="toggle-online"
            disabled={togglingOnline || !settings}
            onClick={() => void toggleOnline()}
            className={cn(
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40',
              settings?.online ? 'bg-brand-green' : 'bg-brand-border-grey dark:bg-[#3a3a3a]',
            )}
          >
            <span className={cn('inline-block size-3.5 rounded-full bg-white shadow transition-transform', settings?.online ? 'translate-x-4.5' : 'translate-x-1')} />
          </button>
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl border border-state-alert/30 bg-white px-4 py-2.5 text-xs text-state-alert dark:bg-[#1e1e1e]">{error}</p>}

      {sessions === null ? (
        <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>
      ) : !available ? (
        <div className={cn(card, 'p-6 text-sm text-brand-mid-grey')}>{t('admin.liveChat.unavailable')}</div>
      ) : (
        <div className="grid min-h-[36rem] gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)_17.5rem]">
          {/* Pane 1: Queue */}
          <section className={cn(card, 'flex flex-col overflow-hidden')}>
            <label className="m-3 flex items-center gap-2 rounded-xl border border-brand-border-grey px-3 py-2 text-xs dark:border-[#2c2c2c]">
              <Search className="size-3.5 text-brand-muted-grey" aria-hidden />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('admin.liveChat.search')}
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
            </label>
            <div className="flex flex-wrap gap-1.5 px-3 pb-3">
              {([
                ['all', t('admin.liveChat.filterAll'), counts.all],
                ['waiting', t('admin.liveChat.filterWaiting'), counts.waiting],
                ['mine', t('admin.liveChat.filterMine'), counts.mine],
                ['resolved', t('admin.liveChat.filterResolved'), counts.resolved],
              ] as [QueueFilter, string, number][]).map(([key, label, n]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                    filter === key
                      ? 'border-brand-green bg-brand-green text-white'
                      : 'border-brand-border-grey text-brand-mid-grey hover:text-brand-near-black dark:border-[#2c2c2c]',
                  )}
                >
                  {label} <span className="font-mono opacity-70">{n}</span>
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <p className="border-t border-brand-border-grey px-4 py-10 text-center text-xs text-brand-mid-grey dark:border-[#2c2c2c]">{t('admin.liveChat.empty')}</p>
            ) : (
              <ul className="max-h-[38rem] flex-1 divide-y divide-brand-border-grey overflow-y-auto border-t border-brand-border-grey dark:divide-[#2c2c2c] dark:border-[#2c2c2c]">
                {shown.map(s => {
                  const on = s.id === selected?.id;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(s.id)}
                        className={cn(
                          'flex w-full flex-col gap-1 px-3.5 py-3 text-left transition-colors',
                          on ? 'bg-brand-green/[0.06] shadow-[inset_3px_0_0_var(--color-brand-green)]' : 'hover:bg-brand-off-white dark:hover:bg-[#242424]',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-xs font-bold text-brand-near-black dark:text-white">{s.visitorName || s.visitorEmail || t('admin.liveChat.visitor')}</span>
                            <span className={cn('shrink-0 rounded-md px-1.5 py-px text-[9.5px] font-bold uppercase', ROLE_TONE[s.visitorRole])}>{s.visitorRole}</span>
                          </span>
                          <span className="shrink-0 text-[10.5px] text-brand-muted-grey">{formatRelative(s.lastMessageAt)}</span>
                        </div>
                        <p className="truncate text-xs text-brand-mid-grey">{s.lastMessagePreview || '—'}</p>
                        <div className="flex items-center justify-between text-[10.5px] text-brand-muted-grey">
                          <span className="truncate font-mono">{s.pagePath}</span>
                          {s.unreadForStaff > 0 && (
                            <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-brand-green px-1.5 font-mono text-[10px] font-bold text-white">
                              {s.unreadForStaff}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Pane 2: Live Thread */}
          {selected ? (
            <>
              <section className={cn(card, 'flex flex-col overflow-hidden')}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-border-grey px-4 py-3 dark:border-[#2c2c2c]">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-bold text-brand-near-black dark:text-white">
                      <span className="truncate">{selected.visitorName || selected.visitorEmail}</span>
                      <span className={cn('rounded-md px-1.5 py-px text-[10px] font-bold uppercase', ROLE_TONE[selected.visitorRole])}>{selected.visitorRole}</span>
                    </p>
                    <p className="truncate text-xs text-brand-mid-grey">{selected.visitorEmail}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => void handleAssignMe()}
                      className="inline-flex items-center gap-1 rounded-xl border border-brand-border-grey px-2.5 py-1.5 text-xs font-semibold hover:border-brand-near-black dark:border-[#2c2c2c]">
                      <UserCheck className="size-3.5" aria-hidden />{t('admin.liveChat.assignMe')}
                    </button>
                    <button type="button" onClick={() => void handleResolveToggle()}
                      className="inline-flex items-center gap-1 rounded-xl border border-brand-border-grey px-2.5 py-1.5 text-xs font-semibold hover:border-brand-near-black dark:border-[#2c2c2c]">
                      {selected.status === 'resolved'
                        ? <><RotateCcw className="size-3.5" aria-hidden />{t('admin.liveChat.reopen')}</>
                        : <><CheckCircle2 className="size-3.5 text-state-complete" aria-hidden />{t('admin.liveChat.resolve')}</>}
                    </button>
                  </div>
                </div>

                {/* Messages stream */}
                <div className="flex-1 space-y-2.5 overflow-y-auto bg-brand-off-white p-4 dark:bg-[#121212]">
                  {loadingMsgs ? (
                    <p className="flex items-center gap-1.5 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>
                  ) : (
                    messages.map(m => {
                      if (m.senderType === 'internal') {
                        return (
                          <div key={m.id} className="rounded-xl border border-state-held/35 border-l-4 border-l-state-held bg-state-held/10 px-3.5 py-2.5 text-xs">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-state-held">{t('admin.liveChat.noteBanner')}</p>
                            <p className="mt-1 whitespace-pre-wrap text-brand-near-black dark:text-white">{m.body}</p>
                            <p className="mt-1 text-right text-[10px] text-state-held">{m.senderName} · {formatRelative(m.createdAt)}</p>
                          </div>
                        );
                      }
                      const isStaffMsg = m.senderType === 'staff';
                      return (
                        <div key={m.id} className={cn('flex flex-col', isStaffMsg ? 'items-end' : 'items-start')}>
                          <div className={cn(
                            'max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-xs',
                            isStaffMsg
                              ? 'rounded-tr-sm bg-brand-green text-white'
                              : 'rounded-tl-sm border border-brand-border-grey bg-white text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white',
                          )}>
                            {m.body}
                            <p className={cn('mt-1 text-right text-[10px]', isStaffMsg ? 'text-white/75' : 'text-brand-muted-grey')}>
                              {m.senderName} · {formatRelative(m.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={threadEndRef} />
                </div>

                {/* Quick replies + Composer */}
                <form onSubmit={handleSend} className="space-y-2 border-t border-brand-border-grey bg-white p-3 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => setComposerMode('staff')}
                        className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', composerMode === 'staff' ? 'bg-brand-green text-white' : 'border border-brand-border-grey text-brand-mid-grey dark:border-[#2c2c2c]')}>
                        {t('admin.liveChat.replyTab')}
                      </button>
                      <button type="button" onClick={() => setComposerMode('internal')}
                        className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', composerMode === 'internal' ? 'bg-state-held text-white' : 'border border-brand-border-grey text-brand-mid-grey dark:border-[#2c2c2c]')}>
                        {t('admin.liveChat.noteTab')}
                      </button>
                    </div>
                    {composerMode === 'staff' && (
                      <div className="flex flex-wrap items-center gap-1">
                        <Zap className="size-3 text-brand-green" aria-hidden />
                        {QUICK_REPLIES.map(qr => (
                          <button key={qr.key} type="button" onClick={() => setDraft(t(qr.bodyKey))}
                            className="rounded-lg border border-brand-border-grey px-2 py-0.5 text-[10.5px] font-medium text-brand-mid-grey hover:border-brand-green hover:text-brand-green dark:border-[#2c2c2c]">
                            {t(qr.key)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      value={draft}
                      disabled={sending}
                      onChange={e => setDraft(e.target.value)}
                      placeholder={t(composerMode === 'internal' ? 'admin.liveChat.notePlaceholder' : 'admin.liveChat.placeholder')}
                      className="min-w-0 flex-1 rounded-xl border border-brand-border-grey bg-brand-off-white px-3 py-2 text-xs outline-none focus:border-brand-green dark:border-[#2c2c2c] dark:bg-[#141414]"
                    />
                    <button
                      type="submit"
                      disabled={sending || !draft.trim()}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-40',
                        composerMode === 'internal' ? 'bg-state-held' : 'bg-brand-green hover:bg-brand-green-hover',
                      )}
                    >
                      {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" aria-hidden />}
                      {t(composerMode === 'internal' ? 'admin.liveChat.saveNote' : 'admin.liveChat.send')}
                    </button>
                  </div>
                </form>
              </section>

              {/* Pane 3: Visitor / Account Context */}
              <aside className={cn(card, 'divide-y divide-brand-border-grey overflow-hidden xl:self-start dark:divide-[#2c2c2c]')}>
                <div className="p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-brand-muted-grey">{t('admin.whatsappCrm.contact')}</p>
                  <dl className="mt-2 space-y-1.5 text-xs">
                    <div className="flex justify-between gap-2"><dt className="text-brand-mid-grey">{t('admin.whatsappCrm.email')}</dt><dd className="truncate font-medium">{selected.visitorEmail || '—'}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-brand-mid-grey">{t('admin.liveChat.fromPage')}</dt><dd className="truncate font-mono text-[11px]">{selected.pagePath}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-brand-mid-grey">{t('admin.liveChat.topic')}</dt><dd className="font-medium capitalize">{selected.topic || '—'}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-brand-mid-grey">{t('admin.whatsappCrm.templateLanguage')}</dt><dd className="font-mono uppercase">{selected.lang}</dd></div>
                  </dl>
                </div>

                {selected.projectId && (
                  <div className="p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-brand-muted-grey">{t('admin.liveChat.linkedProject')}</p>
                    <Link to={`/admin/projects/${selected.projectId}`}
                      className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand-border-grey px-3 py-2 text-xs font-semibold text-brand-green hover:border-brand-green dark:border-[#2c2c2c] dark:text-[#b4d8bf]">
                      {t('admin.liveChat.openProject')} <ExternalLink className="size-3.5" aria-hidden />
                    </Link>
                  </div>
                )}

                <div className="p-4">
                  <Link to="/admin/inbox?channel=whatsapp"
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand-border-grey px-3 py-2 text-xs font-semibold hover:border-brand-near-black dark:border-[#2c2c2c]">
                    {t('admin.liveChat.openWhatsApp')} <ExternalLink className="size-3.5" aria-hidden />
                  </Link>
                </div>
              </aside>
            </>
          ) : (
            <section className={cn(card, 'flex items-center justify-center xl:col-span-2')}>
              <EmptyState icon={<MessageSquare className="size-8" />} title={t('admin.liveChat.pick')} description={t('admin.liveChat.pickBody')} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
