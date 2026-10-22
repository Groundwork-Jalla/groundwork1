import { supabase } from './client';

// =========================================================
// notifyAdmins — calls SECURITY DEFINER RPC so any
// authenticated user can notify admins without reading user_roles
// =========================================================
export async function notifyAdmins(
  type: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.rpc('notify_admins', {
    p_type:  type,
    p_title: title,
    p_body:  body,
    p_data:  data ?? {},
  });
  if (error) console.error('[notify_admins] rpc error:', error);
}

// =========================================================
// notifyProjectMembers — notifies owner + contractors except sender
// =========================================================
export async function notifyProjectMembers(
  projectId: string,
  senderId: string,
  type: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  /**
   * Dictionary keys for the title and body, so the bell reads in the recipient's own
   * language rather than the sender's (149). The stored `title`/`body` stay as the
   * fallback. `bodyKey` is deliberately omitted where the body is an excerpt of what
   * somebody typed — user content is never translated.
   */
  keys?: { titleKey?: string; bodyKey?: string; params?: Record<string, unknown> },
): Promise<void> {
  const { error } = await supabase.rpc('notify_project_members', {
    p_project_id: projectId,
    p_sender_id:  senderId,
    p_type:       type,
    p_title:      title,
    p_body:       body,
    p_data:       data ?? {},
    p_title_key:  keys?.titleKey ?? null,
    p_body_key:   keys?.bodyKey ?? null,
    p_params:     keys?.params ?? {},
  });
  if (error) console.error('[notify_project_members] rpc error:', error);
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  /** Dictionary keys and their values (149). Null on staff notifications, and on
   *  anything written before 149 — both of which keep rendering their stored English. */
  title_key: string | null;
  body_key: string | null;
  params: Record<string, unknown> | null;
}

export async function fetchNotifications(userId: string, limit = 20): Promise<NotificationRow[]> {
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as NotificationRow[];
}

export async function markNotificationRead(id: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
}
