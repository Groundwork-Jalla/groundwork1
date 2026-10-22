import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bell, CheckCheck, Building2, Upload, MessageSquare, BadgeCheck, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { useT, useLanguage, type TKey } from '@/lib/i18n';
import { useNotificationText } from '@/lib/notification-text';
import { destinationFor } from '@/components/ui/NotificationBell';

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  /**
   * When it was read — NOT a boolean.
   *
   * This page carried `read: boolean` and the column has been `read_at TIMESTAMPTZ`
   * since 009. Nothing failed loudly: `select('*')` returned rows with no `read` field,
   * so `!n.read` was true for every row and EVERYTHING showed as unread forever, while
   * `update({ read: true })` addressed a column that does not exist and was discarded.
   * The bell and the dashboard always used `read_at`; only this page disagreed.
   */
  read_at: string | null;
  created_at: string;
  project_id: string | null;
  /** Where it points. `select('*')` always fetched this; nothing ever read it. */
  data: Record<string, unknown> | null;
  /** Dictionary keys and their values (149); null keeps the stored English. */
  title_key: string | null;
  body_key: string | null;
  params: Record<string, unknown> | null;
}

type FilterTab = 'all' | 'unread' | 'projects' | 'payments' | 'system';

const PROJECT_TYPES = new Set([
  'stage_approved',
  'evidence_uploaded',
  'project_created',
  'verification_requested',
  'message_received',
]);

function filterNotifications(list: Notification[], filter: FilterTab): Notification[] {
  switch (filter) {
    case 'unread':
      return list.filter(n => !n.read_at);
    case 'projects':
      return list.filter(n => PROJECT_TYPES.has(n.type));
    case 'payments':
      return list.filter(n => n.type.includes('payment'));
    case 'system':
      return list.filter(n => n.type.includes('system') || n.type === 'admin');
    default:
      return list;
  }
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  stage_approved:         <BadgeCheck className="size-4 text-state-complete" />,
  evidence_uploaded:      <Upload className="size-4 text-state-active" />,
  message_received:       <MessageSquare className="size-4 text-state-active" />,
  project_created:        <Building2 className="size-4 text-brand-mid-grey" />,
  verification_requested: <AlertCircle className="size-4 text-state-held" />,
};

const FILTER_TABS: { labelKey: TKey; value: FilterTab }[] = [
  { labelKey: 'notifications.filters.all',      value: 'all' },
  { labelKey: 'notifications.filters.unread',   value: 'unread' },
  { labelKey: 'notifications.filters.projects', value: 'projects' },
  { labelKey: 'notifications.filters.payments', value: 'payments' },
  { labelKey: 'notifications.filters.system',   value: 'system' },
];

/**
 * Design B groups the list into NEW and EARLIER rather than running one flat feed.
 *
 * The split is unread-vs-read, not a time window: what makes a notification "new"
 * to a person is that they have not dealt with it, and a 3-day-old unread approval
 * still needs action while this morning's read one does not. A date cut would push
 * exactly the wrong items down.
 */
function splitByAttention(list: Notification[]): { fresh: Notification[]; earlier: Notification[] } {
  return {
    fresh:   list.filter(n => !n.read_at),
    earlier: list.filter(n => n.read_at),
  };
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const { tPlural } = useLanguage();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<FilterTab>('all');

  // Initial load
  useEffect(() => {
    if (!user) return;
    supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (!error && data) setNotifications(data as Notification[]);
        setLoading(false);
      });
  }, [user]);

  // Real-time subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        payload => {
          setNotifications(prev => [payload.new as Notification, ...prev]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  async function markAllRead() {
    if (!user) return;
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('read_at', null);
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
  }

  async function markOneRead(n: Notification) {
    if (n.read_at) return;
    const now = new Date().toISOString();
    await supabase.from('notifications').update({ read_at: now }).eq('id', n.id);
    setNotifications(prev =>
      prev.map(item => (item.id === n.id ? { ...item, read_at: now } : item)),
    );
  }

  /**
   * Open what the notification is about.
   *
   * This page only ever marked a row read — it never navigated, so "New message about
   * clinton" was a dead click, and an ALREADY-READ row was deader still because
   * `markOneRead` returns early. The bell dropdown had been fixed and this page had not,
   * which is the whole of the bug: there are two places a notification is clicked and
   * only one of them went anywhere.
   *
   * `destinationFor` is the bell's, deliberately shared — two answers to "where does this
   * notification go" is how they drifted apart in the first place.
   */
  function openNotification(n: Notification) {
    void markOneRead(n);
    // Older rows pre-date `data` carrying the project; the column has always held it.
    const to = destinationFor(n.data ?? (n.project_id ? { project_id: n.project_id } : null));
    if (to) navigate(to);
  }

  async function loadOlder() {
    if (!user || loadingMore) return;
    setLoadingMore(true);
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(notifications.length, notifications.length + 49);
    if (!error && data) {
      setNotifications(prev => [...prev, ...(data as Notification[])]);
    }
    setLoadingMore(false);
  }

  // One helper for the page and the bell, so the fallback rule cannot drift (149).
  const notificationText = useNotificationText();

  const unreadCount = notifications.filter(n => !n.read_at).length;
  const filtered = filterNotifications(notifications, filter);
  const { fresh, earlier } = splitByAttention(filtered);

  const renderRow = (n: Notification) => {
    const { title, body } = notificationText(n);
    return (
    <button
      key={n.id}
      type="button"
      onClick={() => openNotification(n)}
      className={`w-full text-left flex items-start gap-3 px-5 py-4 transition-colors cursor-pointer ${
        !n.read_at
          ? 'bg-brand-off-white/60 dark:bg-[#1f1f1f]'
          : 'hover:bg-brand-off-white/30 dark:hover:bg-brand-rich-black'
      }`}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-off-white dark:bg-[#222] mt-0.5">
        {TYPE_ICON[n.type] ?? <Bell className="size-4 text-brand-mid-grey" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-semibold text-brand-near-black dark:text-white truncate">
            {title}
          </p>
          {!n.read_at && (
            <span className="size-2 rounded-full bg-brand-near-black dark:bg-white shrink-0" />
          )}
        </div>
        <p className="text-xs text-brand-mid-grey leading-relaxed">{body}</p>
        <p className="text-[10px] text-brand-border-grey dark:text-[#555] mt-1.5 tabular-nums">
          {timeAgo(n.created_at)}
        </p>
      </div>
    </button>
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-brand-near-black dark:text-white">{t('nav.notifications')}</h2>
          <p className="mt-0.5 text-xs text-brand-mid-grey">
            {loading
              ? t('common.loading')
              : unreadCount > 0 ? tPlural('notifications.unreadCount', unreadCount) : t('notifications.allCaughtUp')}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors border border-brand-border-grey dark:border-[#2c2c2c] rounded-lg px-3 py-1.5 bg-white dark:bg-brand-dark-grey"
          >
            <CheckCheck className="size-3.5" /> {t('notifications.markAllRead')}
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setFilter(tab.value)}
            className={
              filter === tab.value
                ? 'bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black rounded-full px-3 py-1.5 text-xs font-semibold'
                : 'text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white rounded-full px-3 py-1.5 text-xs font-medium transition-colors'
            }
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-white dark:bg-brand-dark-grey rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-start gap-3 px-5 py-4 animate-pulse">
              <div className="size-8 rounded-full bg-brand-light-grey dark:bg-[#2c2c2c] shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-48 rounded bg-brand-light-grey dark:bg-[#2c2c2c]" />
                <div className="h-3 w-64 rounded bg-brand-light-grey dark:bg-[#2c2c2c]" />
                <div className="h-2.5 w-20 rounded bg-brand-light-grey dark:bg-[#2c2c2c]" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-brand-border-grey dark:border-[#2c2c2c] py-16 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-brand-off-white dark:bg-[#222]">
            <Bell className="size-7 text-brand-border-grey dark:text-[#444]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">
              {filter === 'all' ? t('notifications.emptyTitle') : t('notifications.emptyFiltered')}
            </p>
            <p className="text-xs text-brand-mid-grey leading-relaxed max-w-xs mx-auto">
              {filter === 'all' ? t('notifications.emptyBody') : t('notifications.emptyFilteredBody')}
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-brand-dark-grey rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
          <div className="divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
            {fresh.length > 0 && (
              <p className="bg-brand-off-white/60 px-5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-brand-mid-grey dark:bg-[#1a1a1a]">
                {t('notifications.groupNew')}
              </p>
            )}
            {fresh.map(renderRow)}
            {earlier.length > 0 && (
              <p className="bg-brand-off-white/60 px-5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-brand-mid-grey dark:bg-[#1a1a1a]">
                {t('notifications.groupEarlier')}
              </p>
            )}
            {earlier.map(renderRow)}
          </div>

          {/* Load older button */}
          {notifications.length >= 50 && filter === 'all' && (
            <div className="px-5 py-4 border-t border-brand-off-white dark:border-[#2c2c2c] flex justify-center">
              <button
                type="button"
                onClick={loadOlder}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 text-xs font-medium text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors disabled:opacity-50"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    {t('common.loading')}
                  </>
                ) : (
                  t('notifications.loadOlder')
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
