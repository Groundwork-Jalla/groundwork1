import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotifications } from '@/hooks/useNotifications';
import { notificationData, resolveNotificationDestination } from '@/lib/notification-destination';
import { formatRelative } from '@/lib/format';
import { useNotificationText } from '@/lib/notification-text';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

export { destinationFor } from '@/lib/notification-destination';
export type { NotificationViewer } from '@/lib/notification-destination';

interface NotificationBellProps {
  userId: string;
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const t = useT();
  const [open, setOpen]               = useState(false);
  const [limit, setLimit] = useState(20);
  const feed = useNotifications(userId, limit);
  const { rows: notifs, loaded, unread: unreadCount } = feed;
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const account = useRef(userId); account.current = userId;
  const clickVersion = useRef(0);
  const navigate = useNavigate();
  const { isAdmin, isContractor, isVerifier } = useAuth();
  const historyPath = isAdmin ? '/admin/notifications' : !isContractor && !isVerifier ? '/notifications' : null;
  const notificationText = useNotificationText();
  useEffect(() => { setOpen(false); setError(null); setOpening(null); setLimit(20); return () => { ++clickVersion.current; }; }, [userId]);

  async function openNotification(n: typeof notifs[number]) {
    const recipient = userId;
    const turn = ++clickVersion.current;
    setOpening(n.id); setError(null);
    try {
      const to = await resolveNotificationDestination(notificationData(n), { isAdmin, isContractor, isVerifier });
      if (account.current !== recipient || clickVersion.current !== turn) return;
      if (!to) { setError(t('notifications.noDestination')); return; }
      // A read-state failure must not prevent someone opening the action.
      if (!n.read_at) void feed.markRead(n.id).catch(() => { if (account.current === recipient) setError(t('notifications.readFailed')); });
      if (to) { setOpen(false); navigate(to); }
    } catch {
      if (account.current === recipient && clickVersion.current === turn) setError(t('notifications.openFailed'));
    } finally { if (account.current === recipient && clickVersion.current === turn) setOpening(null); }
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function handleMarkAllRead() {
    try { await feed.markAllRead(); setError(null); }
    catch { setError(t('notifications.readFailed')); }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        aria-label={`${t('nav.notifications')}${unreadCount > 0 ? `, ${t('notifications.unreadCount', { count: unreadCount })}` : ''}`}
        aria-expanded={open}
        className="relative flex size-8 items-center justify-center rounded-full hover:bg-brand-off-white dark:hover:bg-[#2c2c2c] transition-colors"
      >
        <Bell className="size-4.5 text-brand-mid-grey" />
        {unreadCount > 0 && (
          /* Brand Green (`#1f4d36`) stays constant across light and dark themes, so
             `text-white` remains high-contrast in both (avoiding the old
             `--color-state-active` white-on-near-white dark-mode bug). */
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-brand-green text-[9px] font-bold text-white tabular-nums">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="fixed inset-x-4 top-16 z-50 flex max-h-[calc(100dvh-5rem)] flex-col overflow-hidden rounded-2xl border border-brand-border-grey bg-white shadow-lg dark:border-[#2c2c2c] dark:bg-[#1e1e1e] sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-80"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between px-4 py-3 border-b border-brand-border-grey dark:border-[#2c2c2c]">
              <span className="text-xs font-semibold text-brand-near-black dark:text-white">{t('nav.notifications')}</span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-[10px] text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors"
                >
                  {t('notifications.markAllRead')}
                </button>
              )}
            </div>

            {(error || feed.failed) && <p role="alert" className="px-4 py-2 text-xs text-state-alert">{error ?? t('notifications.loadFailed')} <button type="button" className="underline" onClick={() => void feed.refresh()}>{t('common.retry')}</button></p>}
            {/* List */}
            <div className="min-h-0 max-h-80 overflow-y-auto divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
              {!loaded ? (
                <div className="px-4 py-6 text-xs text-brand-mid-grey text-center">{t('common.loading')}</div>
              ) : notifs.length === 0 ? (
                <div className="px-4 py-8 text-xs text-brand-mid-grey text-center">
                  {t('notifications.emptyTitle')}
                </div>
              ) : (
                notifs.map(n => {
                  const { title, body } = notificationText(n);
                  return <button key={n.id} type="button" disabled={opening === n.id} onClick={() => void openNotification(n)}
                    className={cn('w-full text-left px-4 py-3 flex gap-3 items-start transition-colors hover:bg-brand-off-white dark:hover:bg-[#2c2c2c] disabled:opacity-60', !n.read_at && 'bg-brand-off-white/60 dark:bg-[#252525]')}>
                    {!n.read_at && <span className="mt-1.5 shrink-0 size-2 rounded-full bg-state-active" />}
                    <div className={cn('flex-1 min-w-0', n.read_at && 'pl-5')}>
                      <p className="text-xs font-semibold text-brand-near-black dark:text-white leading-snug">{title}</p>
                      <p className="text-xs text-brand-mid-grey mt-0.5 leading-relaxed line-clamp-2">{body}</p>
                      <p className="text-[10px] text-brand-mid-grey mt-1">{formatRelative(n.created_at)}</p>
                    </div>
                  </button>;
                })
              )}
            </div>
            {notifs.length >= limit && <button type="button" disabled={feed.loadingMore} onClick={() => setLimit(value => value + 20)} className="min-h-11 w-full shrink-0 border-t border-brand-border-grey px-4 py-3 text-xs text-brand-mid-grey disabled:opacity-50">
              {t(feed.loadingMore ? 'common.loading' : 'notifications.loadOlder')}
            </button>}
            {historyPath && <Link to={historyPath} onClick={() => { ++clickVersion.current; setOpening(null); setOpen(false); }}
              className="flex min-h-11 shrink-0 items-center justify-center border-t border-brand-border-grey px-4 py-3 text-xs font-semibold text-brand-green hover:bg-brand-off-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-green dark:text-[#b4d8bf]">
              {t('notifications.viewAll')}
            </Link>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
