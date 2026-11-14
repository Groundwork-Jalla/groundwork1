import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { fetchNotifications, fetchUnreadNotificationCount, markAllNotificationsRead, markNotificationRead, type NotificationRow } from '@/lib/supabase/notifications';

/** One account-scoped feed, with realtime and a reconnect/focus fallback. */
export function useNotifications(userId: string | undefined, limit = 20) {
  const current = useRef(userId); current.current = userId;
  const version = useRef(0);
  const [state, setState] = useState<{ userId?: string; rows: NotificationRow[]; unread: number; loaded: boolean; failed: boolean; limit: number }>({ rows: [], unread: 0, loaded: false, failed: false, limit: 0 });
  const refresh = useCallback(async () => {
    if (!userId || current.current !== userId) return;
    const turn = ++version.current;
    try {
      const [rows, unread] = await Promise.all([fetchNotifications(userId, limit), fetchUnreadNotificationCount(userId)]);
      if (current.current === userId && version.current === turn) setState({ userId, rows, unread, loaded: true, failed: false, limit });
    } catch {
      if (current.current === userId && version.current === turn) setState(prev => ({ userId, rows: prev.userId === userId ? prev.rows : [], unread: prev.userId === userId ? prev.unread : 0, loaded: true, failed: true, limit }));
    }
  }, [userId, limit]);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const update = () => { if (alive) void refresh(); };
    const visible = () => { if (document.visibilityState !== 'hidden') update(); };
    const channel = supabase.channel(`notifications:${userId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, update)
      .subscribe(status => { if (status === 'SUBSCRIBED') update(); });
    update();
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', visible);
    const poll = setInterval(visible, 30_000);
    return () => { alive = false; ++version.current; clearInterval(poll); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', visible); void supabase.removeChannel(channel); };
  }, [userId, refresh]);
  const markRead = async (id: string) => { await markNotificationRead(id); await refresh(); };
  const markAllRead = async () => { if (userId) { await markAllNotificationsRead(userId); await refresh(); } };
  return { ...(state.userId === userId ? state : { rows: [], unread: 0, loaded: false, failed: false }), loadingMore: state.userId === userId && state.loaded && state.limit < limit && !state.failed, refresh, markRead, markAllRead };
}
