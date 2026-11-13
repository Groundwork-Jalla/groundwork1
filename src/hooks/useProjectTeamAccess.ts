import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { fetchProjectTeamAccess, type ProjectTeamAccess } from '@/lib/supabase/project-team';

export function useProjectTeamAccess(projectId: string) {
  const { user, accountRole } = useAuth();
  const scope = `${user?.id ?? ''}:${projectId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const request = useRef(0);
  const [state, setState] = useState<{
    scope: string; role: typeof accountRole; access: ProjectTeamAccess | null; error: boolean;
  }>({ scope, role: accountRole, access: null, error: false });

  const refresh = useCallback(async () => {
    if (currentScope.current !== scope) return;
    const version = ++request.current;
    try {
      const access = await fetchProjectTeamAccess(projectId);
      if (currentScope.current === scope && request.current === version) {
        setState({ scope, role: accountRole, access, error: false });
      }
    } catch {
      if (currentScope.current === scope && request.current === version) {
        setState({ scope, role: accountRole, access: null, error: true });
      }
    }
  }, [projectId, scope, accountRole]);

  useEffect(() => {
    void refresh();
    const focus = () => { void refresh(); };
    const invalidate = () => {
      setState({ scope, role: accountRole, access: null, error: false });
      void refresh();
    };
    const poll = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void refresh();
    }, 15_000);
    window.addEventListener('focus', focus);
    const channel = supabase.channel(`project-team:${scope}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_viewers', filter: `project_id=eq.${projectId}` }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contractor_invites', filter: `project_id=eq.${projectId}` }, invalidate)
      .subscribe();
    return () => { ++request.current; clearInterval(poll); window.removeEventListener('focus', focus); void supabase.removeChannel(channel); };
  }, [projectId, scope, accountRole, refresh]);

  const current = state.scope === scope && state.role === accountRole ? state : null;
  return { scope, access: current?.access ?? null, error: current?.error ?? false, refresh };
}
