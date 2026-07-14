import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase/client';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/supabase/notifications';
import type { NotificationRow } from '@/lib/supabase/notifications';
import { cn } from '@/lib/utils';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function NotifItem({
  notif,
  onRead,
}: {
  notif: NotificationRow;
  onRead: (id: string) => void;
}) {
  const navigate = useNavigate();

  function handleClick() {
    if (!notif.read_at) onRead(notif.id);
    const projectId = notif.data?.project_id as string | undefined;
    if (projectId) navigate(`/projects/${projectId}`);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'w-full text-left px-4 py-3 flex gap-3 items-start hover:bg-brand-off-white transition-colors',
        !notif.read_at && 'bg-blue-50/60 hover:bg-blue-50',
      )}
    >
      {!notif.read_at && (
        <span className="mt-1.5 shrink-0 size-2 rounded-full bg-blue-500" />
      )}
      <div className={cn('flex-1 min-w-0', notif.read_at && 'pl-5')}>
        <p className="text-xs font-semibold text-brand-near-black leading-snug">{notif.title}</p>
        <p className="text-xs text-brand-mid-grey mt-0.5 leading-relaxed line-clamp-2">{notif.body}</p>
        <p className="text-[10px] text-brand-mid-grey mt-1">{timeAgo(notif.created_at)}</p>
      </div>
    </button>
  );
}

interface NotificationBellProps {
  userId: string;
}

export function NotificationBell({ userId }: NotificationBellProps) {
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
        className="relative flex size-8 items-center justify-center rounded-full hover:bg-brand-off-white transition-colors"
      >
        <Bell className="size-4.5 text-brand-mid-grey" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white tabular-nums">
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
            className="absolute right-0 top-10 z-50 w-80 rounded-2xl border border-brand-border-grey bg-white shadow-lg overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border-grey">
              <span className="text-xs font-semibold text-brand-near-black">Notifications</span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-[10px] text-brand-mid-grey hover:text-brand-near-black transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto divide-y divide-brand-border-grey">
              {!loaded ? (
                <div className="px-4 py-6 text-xs text-brand-mid-grey text-center">Loading…</div>
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
