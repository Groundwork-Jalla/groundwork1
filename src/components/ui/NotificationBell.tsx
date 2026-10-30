import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase/client';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/supabase/notifications';
import type { NotificationRow } from '@/lib/supabase/notifications';
import { useNotificationText } from '@/lib/notification-text';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Where a notification goes when clicked.
 *
 * Used to be `project_id` or nothing. The support and inquiry triggers carry `ticket_id`
 * and `inquiry_id` instead, so those notifications were a dead click — they marked
 * themselves read and stayed put. Each id the triggers write now has a page.
 */
/**
 * Who is reading this notification.
 *
 * Added 31 Oct 2026. The stamped `role` below was never enough: `notify_project_members`
 * (013) inserts the SAME `data` for the owner and for every accepted contractor, and
 * stamps no role at all. 123 added the stamp for message notifications only, so every
 * other kind — "your project is now being tracked" among them — reached a contractor
 * with no role and fell through to `/projects/<id>`, which is the CLIENT view.
 *
 * Reported by Philip, who opened a notification as a contractor and landed in the
 * client app.
 *
 * The viewer's own role is the better answer in every case, because a notification row
 * belongs to ONE person: whoever is reading it is the recipient. So this is preferred
 * over the stamp, and the stamp is kept only as a fallback for a caller that has no
 * viewer to hand. Fixing the trigger alone would not have helped the notifications
 * already sitting in the table.
 */
export interface NotificationViewer {
  isAdmin?: boolean;
  isContractor?: boolean;
  isVerifier?: boolean;
}

export function destinationFor(
  data: Record<string, unknown> | null | undefined,
  viewer?: NotificationViewer,
): string | null {
  if (!data) return null;
  const s = (k: string) => (typeof data[k] === 'string' && data[k] ? (data[k] as string) : null);
  const application = s('application_id');
  if (application)       return `/admin/applications/${application}`;
  if (s('ticket_id'))    return '/admin/support';
  if (s('inquiry_id'))   return '/admin/inquiries';
  const project = s('project_id');
  if (project) {
    // Role-aware, because /projects/<id> assumes an owner: a contractor or verifier
    // sent there is bounced, which reads as the product being broken rather than as a
    // message waiting. 123 stamps the recipient's role on the notification for this.
    //
    // And a MESSAGE notification opens the messages tab. Landing on the project
    // overview was the reported bug: somebody is told they have a message, presses
    // the thing that says so, and arrives at a page that does not show it.
    // The viewer first, the stamp second. See NotificationViewer above.
    const role = viewer?.isContractor ? 'contractor'
      : viewer?.isVerifier ? 'verifier'
      : s('role');
    const tab  = s('conversation_id') ? '?tab=messages' : '';
    if (role === 'contractor') return `/work/projects/${project}${tab}`;
    if (role === 'verifier')   return `/verifiers/projects/${project}${tab}`;
    return `/projects/${project}${tab}`;
  }
  // A thread with no project — a WhatsApp or email chat, which belongs to the person
  // rather than to a build. 123 notifies on these too; without this they were a bell
  // that went nowhere when pressed.
  // A conversation with no project. `/messages` lives under the CLIENT layout and
  // there is no contractor equivalent, so a contractor is sent to their own dashboard
  // instead: not ideal, but the rule is that no button puts a contractor in somebody
  // else's app, and a thread with no build has nowhere else to be.
  if (s('conversation_id')) {
    if (viewer?.isContractor) return '/work';
    if (viewer?.isVerifier)   return '/verifiers';
    return '/messages';
  }
  return null;
}

function NotifItem({
  notif,
  onRead,
}: {
  notif: NotificationRow;
  onRead: (id: string) => void;
}) {
  const navigate = useNavigate();
  const { isAdmin, isContractor, isVerifier } = useAuth();

  function handleClick() {
    if (!notif.read_at) onRead(notif.id);
    const to = destinationFor(notif.data, { isAdmin, isContractor, isVerifier });
    if (to) navigate(to);
  }

  const { title, body } = useNotificationText()(notif);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'w-full text-left px-4 py-3 flex gap-3 items-start transition-colors',
        'hover:bg-brand-off-white dark:hover:bg-[#2c2c2c]',
        !notif.read_at && 'bg-brand-off-white/60 dark:bg-[#252525]',
      )}
    >
      {!notif.read_at && (
        <span className="mt-1.5 shrink-0 size-2 rounded-full bg-state-active" />
      )}
      <div className={cn('flex-1 min-w-0', notif.read_at && 'pl-5')}>
        <p className="text-xs font-semibold text-brand-near-black dark:text-white leading-snug">{title}</p>
        <p className="text-xs text-brand-mid-grey mt-0.5 leading-relaxed line-clamp-2">{body}</p>
        <p className="text-[10px] text-brand-mid-grey mt-1">{timeAgo(notif.created_at)}</p>
      </div>
    </button>
  );
}

interface NotificationBellProps {
  userId: string;
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const t = useT();
  const [open, setOpen]               = useState(false);
  const [notifs, setNotifs]           = useState<NotificationRow[]>([]);
  const [loaded, setLoaded]           = useState(false);
  const containerRef                  = useRef<HTMLDivElement>(null);

  const unreadCount = notifs.filter(n => !n.read_at).length;

  const load = useCallback(async () => {
    const rows = await fetchNotifications(userId);
    setNotifs(rows);
    setLoaded(true);
  }, [userId]);

  // Initial load + realtime subscription
  useEffect(() => {
    load();

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          setNotifs(prev => [payload.new as NotificationRow, ...prev]);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, load]);

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
    await markAllNotificationsRead(userId);
    setNotifs(prev => prev.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
  }

  async function handleRead(id: string) {
    await markNotificationRead(id);
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        className="relative flex size-8 items-center justify-center rounded-full hover:bg-brand-off-white dark:hover:bg-[#2c2c2c] transition-colors"
      >
        <Bell className="size-4.5 text-brand-mid-grey" />
        {unreadCount > 0 && (
          /* `--color-state-active` is "the colour of text" and FLIPS with the theme:
             #0a0a0a in light, #f0f0f0 in dark. Against a fixed `text-white` that made
             the count white-on-near-white — an unread badge with an invisible number,
             which is what was reported. The ink flips with its background. */
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-state-active text-[9px] font-bold text-white dark:text-brand-near-black tabular-nums">
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
            className="absolute right-0 top-10 z-50 w-80 rounded-2xl border border-brand-border-grey bg-white shadow-lg overflow-hidden dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border-grey dark:border-[#2c2c2c]">
              <span className="text-xs font-semibold text-brand-near-black dark:text-white">{t('nav.notifications')}</span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-[10px] text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
              {!loaded ? (
                <div className="px-4 py-6 text-xs text-brand-mid-grey text-center">{t('common.loading')}</div>
              ) : notifs.length === 0 ? (
                <div className="px-4 py-8 text-xs text-brand-mid-grey text-center">
                  No notifications yet
                </div>
              ) : (
                notifs.map(n => (
                  <NotifItem key={n.id} notif={n} onRead={handleRead} />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
