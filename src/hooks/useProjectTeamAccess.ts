import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { fetchProjectTeamAccess, type ProjectTeamAccess } from '@/lib/supabase/project-team';

export function useProjectTeamAccess(projectId: string) {
  const { user } = useAuth();
  const scope = `${user?.id ?? ''}:${projectId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const request = useRef(0);
  const [state, setState] = useState<{
    scope: string; access: ProjectTeamAccess | null; error: boolean;
  }>({ scope, access: null, error: false });

  const refresh = useCallback(async () => {
    if (currentScope.current !== scope) return;
    const version = ++request.current;
    try {
      const access = await fetchProjectTeamAccess(projectId);
      if (currentScope.current === scope && request.current === version) {
        setState({ scope, access, error: false });
      }
    } catch {
      if (currentScope.current === scope && request.current === version) {
        setState({ scope, access: null, error: true });
      }
    }
  }, [projectId, scope]);

  useEffect(() => {
    void refresh();
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    const channel = supabase.channel(`project-team:${scope}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_viewers', filter: `project_id=eq.${projectId}` }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contractor_invites', filter: `project_id=eq.${projectId}` }, () => { void refresh(); })
      .subscribe();
    return () => { ++request.current; window.removeEventListener('focus', focus); void supabase.removeChannel(channel); };
  }, [projectId, scope, refresh]);

  const current = state.scope === scope ? state : null;
  return { scope, access: current?.access ?? null, error: current?.error ?? false, refresh };
}
