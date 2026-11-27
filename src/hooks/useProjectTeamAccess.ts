import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { fetchProjectTeamAccess, type ProjectTeamAccess } from '@/lib/supabase/project-team';

function isTransientNetworkError(err: unknown): boolean {
  const msg = err instanceof Error
    ? err.message
    : typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message?: unknown }).message ?? '')
      : String(err ?? '');
  if (/not_permitted|not_signed_in|permission|forbidden|unauthorized|\b401\b|\b403\b/i.test(msg)) {
    return false;
  }
  return /failed to fetch|network|load failed|fetch failed|timeout|timed out|aborted|\b502\b|\b503\b|\b504\b|offline|econnreset|etimedout/i.test(msg);
}

export function useProjectTeamAccess(projectId: string) {
  const { user, accountRole } = useAuth();
  const scope = `${user?.id ?? ''}:${projectId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const request = useRef(0);
  const [state, setState] = useState<{
    scope: string; role: typeof accountRole; access: ProjectTeamAccess | null; error: boolean;
  }>({ scope, role: accountRole, access: null, error: false });
  const latestState = useRef(state);
  latestState.current = state;

  const runRefresh = useCallback(async (background: boolean) => {
    if (!projectId || currentScope.current !== scope) return;
    const version = ++request.current;
    const attempt = () => fetchProjectTeamAccess(projectId);
    try {
      let access: ProjectTeamAccess;
      try {
        access = await attempt();
      } catch (firstErr) {
        if (!isTransientNetworkError(firstErr) || currentScope.current !== scope || request.current !== version) {
          throw firstErr;
        }
        access = await attempt();
      }
      if (currentScope.current === scope && request.current === version) {
        setState({ scope, role: accountRole, access, error: false });
      }
    } catch (err) {
      if (currentScope.current === scope && request.current === version) {
        const prev = latestState.current;
        const hasLoadedAccess = prev.scope === scope && prev.role === accountRole && prev.access !== null;
        // Never wipe an already-open project screen on a transient background network blip.
        // Explicit permission/auth denials always fail closed immediately.
        if (background && hasLoadedAccess && isTransientNetworkError(err)) {
          return;
        }
        setState({ scope, role: accountRole, access: null, error: true });
      }
    }
  }, [projectId, scope, accountRole]);

  const refresh = useCallback(() => runRefresh(false), [runRefresh]);

  useEffect(() => {
    void runRefresh(false);
    const focus = () => { void runRefresh(true); };
    const invalidate = (payload?: { eventType?: string }) => {
      // A new invitation does not revoke this actor's existing membership.
      // Keep the panel mounted for its own INSERT while refreshing reservations.
      // Membership UPDATE/DELETE still close controls immediately; SQL checks
      // the current permissions and reserved roles again for every mutation.
      if (payload?.eventType !== 'INSERT') setState({ scope, role: accountRole, access: null, error: false });
      void runRefresh(false);
    };
    const poll = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void runRefresh(true);
    }, 15_000);
    window.addEventListener('focus', focus);
    const channel = supabase.channel(`project-team:${scope}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_viewers', filter: `project_id=eq.${projectId}` }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contractor_invites', filter: `project_id=eq.${projectId}` }, invalidate)
      .subscribe();
    return () => { ++request.current; clearInterval(poll); window.removeEventListener('focus', focus); void supabase.removeChannel(channel); };
  }, [projectId, scope, accountRole, runRefresh]);

  const current = state.scope === scope && state.role === accountRole ? state : null;
  return { scope, access: current?.access ?? null, error: current?.error ?? false, refresh };
}
