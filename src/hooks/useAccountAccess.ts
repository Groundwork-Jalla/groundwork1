import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { readAccountAccess, type AccountAccess } from '@/lib/auth/account-access';

import { ACCOUNT_ROLE_CHANGED } from '@/lib/auth/account-role';

export function useAccountAccess(userId: string | undefined, loading: boolean, token?: string) {
  const scope = userId ?? '';
  const current = useRef(scope); current.current = scope;
  const mounted = useRef(false);
  const version = useRef(0);
  const last = useRef<AccountAccess | null>(null);
  const [state, setState] = useState<{ userId: string; access: AccountAccess | null }>({ userId: scope, access: null });
  const refresh = useCallback(async () => {
    if (!userId || loading || !mounted.current || current.current !== userId) return;
    const request = ++version.current;
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await readAccountAccess(userId);
      if (!mounted.current || current.current !== userId || request !== version.current) return;
      if (result.ok) {
        const changed = last.current?.userId === userId && last.current.roles !== result.access.roles;
        last.current = result.access;
        setState({ userId, access: result.access });
        // Refresh stale signup intent/display metadata too. Permissions never use it.
        if (changed) void supabase.auth.refreshSession().catch(() => {});
        return;
      }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt));
    }
    // Unknown is not a client role. Realtime invalidations remain pending until a
    // successful read; focus/polling also recover after an interrupted connection.
  }, [userId, loading]);

  useEffect(() => {
    mounted.current = true;
    if (loading || !userId) return () => { mounted.current = false; ++version.current; };
    let queued: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      ++version.current;
      setState({ userId, access: null });
      clearTimeout(queued);
      queued = setTimeout(() => { void refresh(); }, 50);
    };
    const focus = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    const localChange = (event: Event) => {
      if ((event as CustomEvent<{ userId: string }>).detail?.userId === userId) invalidate();
    };
    void refresh();
    const channel = supabase.channel(`account-access:${userId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_roles', filter: `user_id=eq.${userId}` }, invalidate)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, () => { void refresh(); })
      .subscribe();
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    window.addEventListener(ACCOUNT_ROLE_CHANGED, localChange);
    const poll = setInterval(focus, 15_000);
    return () => {
      mounted.current = false; ++version.current; clearTimeout(queued); clearInterval(poll);
      window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus);
      window.removeEventListener(ACCOUNT_ROLE_CHANGED, localChange); void supabase.removeChannel(channel);
    };
  }, [userId, loading, token, refresh]);

  const access = state.userId === scope ? state.access : null;
  const checked = !loading && (!userId || access !== null);
  return { access, checked, refresh };
}
