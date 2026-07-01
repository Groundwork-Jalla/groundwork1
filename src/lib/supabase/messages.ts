import { supabase } from './client';
import type { ProjectMessageRow } from '@/types/project';

// =========================================================
// fetchMessages — ordered by oldest first (chat order)
// =========================================================
export async function fetchMessages(projectId: string): Promise<ProjectMessageRow[]> {
  const { data, error } = await supabase
    .from('project_messages')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

// =========================================================
// sendMessage
// =========================================================
export async function sendMessage(
  projectId: string,
  senderId: string,
  senderName: string,
  content: string,
): Promise<void> {
  const { error } = await supabase
    .from('project_messages')
    .insert({ project_id: projectId, sender_id: senderId, sender_name: senderName, content });

  if (error) throw error;
}

// =========================================================
// subscribeToMessages — Supabase Realtime channel
// Returns an unsubscribe function
// =========================================================
export function subscribeToMessages(
  projectId: string,
  onMessage: (msg: ProjectMessageRow) => void,
): () => void {
  const channel = supabase
    .channel(`project-messages-${projectId}`)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'project_messages',
        filter: `project_id=eq.${projectId}`,
      },
      payload => onMessage(payload.new as ProjectMessageRow),
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

// =========================================================
// formatRelativeTime — "2 min ago", "just now", etc.
// =========================================================
export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
