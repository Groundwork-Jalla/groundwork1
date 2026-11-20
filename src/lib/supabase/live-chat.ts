import { supabase } from './client';

export type LiveChatStatus = 'open' | 'waiting_on_us' | 'waiting_on_user' | 'resolved';
export type LiveChatSenderType = 'user' | 'staff' | 'internal';

export interface LiveChatSettings {
  online: boolean;
  greetingEn: string;
  greetingFr: string;
  awayEn: string;
  awayFr: string;
}

export interface LiveChatSession {
  id: string;
  userId: string | null;
  visitorName: string;
  visitorEmail: string;
  visitorRole: 'visitor' | 'homeowner' | 'contractor';
  topic: string | null;
  pagePath: string;
  projectId: string | null;
  lang: 'en' | 'fr';
  status: LiveChatStatus;
  assignedTo: string | null;
  unreadForStaff: number;
  unreadForUser: number;
  lastMessageAt: string;
  lastMessagePreview: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface LiveChatMessage {
  id: string;
  sessionId: string;
  senderType: LiveChatSenderType;
  senderId: string | null;
  senderName: string;
  body: string;
  createdAt: string;
}

const DEFAULT_SETTINGS: LiveChatSettings = {
  online: true,
  greetingEn: 'Hi! How can we help with your build today?',
  greetingFr: 'Bonjour ! Comment pouvons-nous vous aider pour votre chantier ?',
  awayEn: 'Our team is currently away. Leave your message and we will reply shortly.',
  awayFr: 'Notre équipe est momentanément absente. Laissez votre message et nous vous répondrons rapidement.',
};

function mapSession(r: Record<string, unknown>): LiveChatSession {
  return {
    id: String(r.id ?? ''),
    userId: typeof r.user_id === 'string' ? r.user_id : null,
    visitorName: String(r.visitor_name ?? ''),
    visitorEmail: String(r.visitor_email ?? ''),
    visitorRole: (r.visitor_role === 'homeowner' || r.visitor_role === 'contractor' ? r.visitor_role : 'visitor'),
    topic: typeof r.topic === 'string' ? r.topic : null,
    pagePath: String(r.page_path ?? '/'),
    projectId: typeof r.project_id === 'string' ? r.project_id : null,
    lang: r.lang === 'fr' ? 'fr' : 'en',
    status: (['open', 'waiting_on_us', 'waiting_on_user', 'resolved'].includes(String(r.status)) ? r.status : 'waiting_on_us') as LiveChatStatus,
    assignedTo: typeof r.assigned_to === 'string' ? r.assigned_to : null,
    unreadForStaff: Number(r.unread_for_staff ?? 0),
    unreadForUser: Number(r.unread_for_user ?? 0),
    lastMessageAt: String(r.last_message_at ?? r.created_at ?? ''),
    lastMessagePreview: String(r.last_message_preview ?? ''),
    createdAt: String(r.created_at ?? ''),
    resolvedAt: typeof r.resolved_at === 'string' ? r.resolved_at : null,
  };
}

function mapMessage(r: Record<string, unknown>): LiveChatMessage {
  return {
    id: String(r.id ?? ''),
    sessionId: String(r.session_id ?? ''),
    senderType: (r.sender_type === 'staff' || r.sender_type === 'internal' ? r.sender_type : 'user'),
    senderId: typeof r.sender_id === 'string' ? r.sender_id : null,
    senderName: String(r.sender_name ?? ''),
    body: String(r.body ?? ''),
    createdAt: String(r.created_at ?? ''),
  };
}

export function isLiveChatMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as Record<string, unknown>).code ?? '');
  return code === '42P01' || code === 'PGRST205';
}

// ── Settings (Online / Away status) ──────────────────────────────────

export async function fetchLiveChatSettings(): Promise<LiveChatSettings> {
  const { data, error } = await supabase
    .from('live_chat_settings')
    .select('online, greeting_en, greeting_fr, away_message_en, away_message_fr')
    .eq('id', true)
    .maybeSingle();
  if (error || !data) return DEFAULT_SETTINGS;
  return {
    online: Boolean(data.online),
    greetingEn: String(data.greeting_en ?? DEFAULT_SETTINGS.greetingEn),
    greetingFr: String(data.greeting_fr ?? DEFAULT_SETTINGS.greetingFr),
    awayEn: String(data.away_message_en ?? DEFAULT_SETTINGS.awayEn),
    awayFr: String(data.away_message_fr ?? DEFAULT_SETTINGS.awayFr),
  };
}

export async function setLiveChatOnline(online: boolean, userId: string): Promise<void> {
  const { error } = await supabase
    .from('live_chat_settings')
    .update({ online, updated_at: new Date().toISOString(), updated_by: userId })
    .eq('id', true);
  if (error) throw error;
}

// ── Signed-in user session helpers (Direct Supabase + Realtime) ──────

export async function fetchMyLiveChatSession(userId: string): Promise<LiveChatSession | null> {
  const { data, error } = await supabase
    .from('live_chat_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isLiveChatMissing(error)) return null;
    throw error;
  }
  return data ? mapSession(data as Record<string, unknown>) : null;
}

export async function startSignedInLiveChat(input: {
  userId: string;
  name: string;
  email: string;
  role: 'homeowner' | 'contractor';
  topic?: string | null;
  pagePath: string;
  projectId?: string | null;
  lang: 'en' | 'fr';
  firstMessage: string;
}): Promise<{ session: LiveChatSession; message: LiveChatMessage }> {
  const { data: sess, error: sessErr } = await supabase
    .from('live_chat_sessions')
    .insert({
      user_id: input.userId,
      visitor_name: input.name,
      visitor_email: input.email,
      visitor_role: input.role,
      topic: input.topic ?? null,
      page_path: input.pagePath,
      project_id: input.projectId ?? null,
      lang: input.lang,
      status: 'waiting_on_us',
    })
    .select('*')
    .single();
  if (sessErr || !sess) throw sessErr ?? new Error('live_chat_start_failed');

  const { data: msg, error: msgErr } = await supabase
    .from('live_chat_messages')
    .insert({
      session_id: sess.id,
      sender_type: 'user',
      sender_id: input.userId,
      sender_name: input.name,
      body: input.firstMessage.trim(),
    })
    .select('*')
    .single();
  if (msgErr || !msg) throw msgErr ?? new Error('live_chat_send_failed');

  return {
    session: mapSession(sess as Record<string, unknown>),
    message: mapMessage(msg as Record<string, unknown>),
  };
}

export async function sendSignedInLiveChatMessage(
  sessionId: string,
  userId: string,
  senderName: string,
  body: string,
): Promise<LiveChatMessage> {
  const { data, error } = await supabase
    .from('live_chat_messages')
    .insert({
      session_id: sessionId,
      sender_type: 'user',
      sender_id: userId,
      sender_name: senderName,
      body: body.trim(),
    })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('live_chat_send_failed');
  return mapMessage(data as Record<string, unknown>);
}

export async function markUserLiveChatRead(sessionId: string): Promise<void> {
  await supabase.from('live_chat_sessions').update({ unread_for_user: 0 }).eq('id', sessionId);
}

// ── Public visitor helpers (/api/events?action=live-chat) ────────────

export async function startPublicLiveChat(input: {
  name: string;
  email: string;
  topic?: string | null;
  pagePath: string;
  lang: 'en' | 'fr';
  message: string;
}): Promise<{ sessionId: string; visitorToken: string; session: LiveChatSession; messages: LiveChatMessage[] }> {
  const r = await fetch('/api/events?action=live-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'start', ...input }),
  });
  const json = await r.json().catch(() => null);
  if (!r.ok || !json?.ok) throw new Error(json?.error ?? 'live_chat_start_failed');
  return {
    sessionId: String(json.sessionId),
    visitorToken: String(json.visitorToken),
    session: mapSession(json.session as Record<string, unknown>),
    messages: (Array.isArray(json.messages) ? json.messages : []).map((m: unknown) => mapMessage(m as Record<string, unknown>)),
  };
}

export async function pollPublicLiveChat(
  sessionId: string,
  visitorToken: string,
  markRead = false,
): Promise<{ session: LiveChatSession; messages: LiveChatMessage[] }> {
  const r = await fetch('/api/events?action=live-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'poll', sessionId, visitorToken, markRead }),
  });
  const json = await r.json().catch(() => null);
  if (!r.ok || !json?.ok) throw new Error(json?.error ?? 'live_chat_poll_failed');
  return {
    session: mapSession(json.session as Record<string, unknown>),
    messages: (Array.isArray(json.messages) ? json.messages : []).map((m: unknown) => mapMessage(m as Record<string, unknown>)),
  };
}

export async function sendPublicLiveChatMessage(
  sessionId: string,
  visitorToken: string,
  message: string,
): Promise<LiveChatMessage> {
  const r = await fetch('/api/events?action=live-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'send', sessionId, visitorToken, message }),
  });
  const json = await r.json().catch(() => null);
  if (!r.ok || !json?.ok) throw new Error(json?.error ?? 'live_chat_send_failed');
  return mapMessage(json.message as Record<string, unknown>);
}

// ── Admin / Staff console helpers ────────────────────────────────────

export async function listLiveChatSessions(limit = 100): Promise<{ rows: LiveChatSession[]; available: boolean }> {
  const { data, error } = await supabase
    .from('live_chat_sessions')
    .select('*')
    .order('last_message_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isLiveChatMissing(error)) return { rows: [], available: false };
    throw error;
  }
  return { rows: (data ?? []).map(r => mapSession(r as Record<string, unknown>)), available: true };
}

export async function listLiveChatMessages(sessionId: string): Promise<LiveChatMessage[]> {
  const { data, error } = await supabase
    .from('live_chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map(r => mapMessage(r as Record<string, unknown>));
}

export async function sendStaffLiveChatMessage(
  sessionId: string,
  staffId: string,
  staffName: string,
  body: string,
  senderType: 'staff' | 'internal' = 'staff',
): Promise<LiveChatMessage> {
  const { data, error } = await supabase
    .from('live_chat_messages')
    .insert({
      session_id: sessionId,
      sender_type: senderType,
      sender_id: staffId,
      sender_name: staffName,
      body: body.trim(),
    })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('live_chat_send_failed');
  return mapMessage(data as Record<string, unknown>);
}

export async function updateLiveChatSession(
  sessionId: string,
  patch: Partial<{ status: LiveChatStatus; assigned_to: string | null; unread_for_staff: number; resolved_at: string | null }>,
): Promise<void> {
  const { error } = await supabase
    .from('live_chat_sessions')
    .update(patch)
    .eq('id', sessionId);
  if (error) throw error;
}
