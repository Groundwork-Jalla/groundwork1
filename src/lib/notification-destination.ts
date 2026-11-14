import { fetchProjectTeamAccess, type ProjectTeamAccess } from '@/lib/supabase/project-team';

export interface NotificationViewer {
  isAdmin?: boolean;
  isContractor?: boolean;
  isVerifier?: boolean;
  projectRole?: ProjectTeamAccess['projectRole'];
}
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function notificationFocus(data: Record<string, unknown>): { key: string; id: string } | null {
  for (const [key, prefix] of [['receipt_id', 'receipt'], ['proposal_id', 'price-proposal'], ['substage_id', 'substage'], ['document_id', 'document'], ['message_id', 'message'], ['stage_id', 'stage-payment']]) {
    if (safeId(data[key])) return { key, id: `${prefix}-${data[key]}` };
  }
  return null;
}

/** Legacy notifications remain routable; clicks also resolve current project membership. */
export function destinationFor(data: Record<string, unknown> | null | undefined, viewer?: NotificationViewer): string | null {
  if (!data) return null;
  const s = (key: string) => typeof data[key] === 'string' && data[key] ? data[key] as string : null;
  if (s('communication_followup_id')) return viewer?.isAdmin ? '/admin/sequences' : null;
  if (safeId(data.application_id)) return `/admin/applications/${data.application_id}`;
  if (s('ticket_id')) return '/admin/support';
  if (s('inquiry_id')) return '/admin/inquiries';
  // An invitation must be accepted before its project can be read.
  if (safeId(data.invitation_token) && data.invitation_kind === 'contractor') return `/invite/${data.invitation_token}`;
  if (safeId(data.invitation_token) && data.invitation_kind === 'viewer') return `/share/${data.invitation_token}`;
  if (safeId(data.project_id)) {
    if (viewer?.projectRole === 'verifier' && safeId(data.verification_id)) return `/verifiers/${data.verification_id}`;
    if (viewer?.projectRole === 'staff') {
      const tabs: Record<string, string> = { work: 'stages', stages: 'stages', money: 'financials', costing: 'financials', documents: 'documents', messages: 'conversations', people: 'team', team: 'team', timeline: 'activity', overview: 'overview' };
      const query = new URLSearchParams({ tab: s('conversation_id') ? 'conversations' : tabs[s('project_tab') ?? ''] ?? 'overview' });
      if (safeId(data.stage_id)) query.set('stage', data.stage_id);
      if (safeId(data.conversation_id)) query.set('conversation', data.conversation_id);
      for (const key of ['receipt_id', 'proposal_id', 'substage_id', 'document_id', 'message_id']) if (safeId(data[key])) query.set(key, data[key]);
      return `/admin/projects/${data.project_id}?${query}`;
    }
    const role = viewer?.projectRole
      ? ['primary_contractor', 'contractor'].includes(viewer.projectRole) ? 'contractor' : viewer.projectRole === 'verifier' ? 'verifier' : 'client'
      : s('financial_event') && s('role') ? s('role') : viewer?.isContractor ? 'contractor' : viewer?.isVerifier ? 'verifier' : s('role');
    const target = s('project_tab') ?? (data.proposal_id ? 'costing' : data.receipt_id || data.stage_id || data.substage_id ? 'stages' : data.document_id ? 'documents' : null);
    const allowed = role === 'contractor' ? ['work', 'money', 'documents', 'messages', 'people'] : ['overview', 'stages', 'costing', 'timeline', 'documents', 'messages', 'team'];
    // Tabs reflect the current project role, even for notifications written before a role change.
    const mapped = role === 'contractor' ? ({ stages: 'work', costing: 'money', team: 'people' } as Record<string, string>)[target ?? ''] ?? target
      : ({ work: 'stages', money: 'costing', people: 'team' } as Record<string, string>)[target ?? ''] ?? target;
    const selected = s('conversation_id') ? 'messages' : mapped && allowed.includes(mapped) ? mapped : null;
    const query = new URLSearchParams();
    if (selected) query.set('tab', selected);
    if (/^\d{1,3}$/.test(String(data.stage_number ?? ''))) query.set('stage', String(data.stage_number));
    for (const key of ['receipt_id', 'proposal_id', 'substage_id', 'document_id', 'message_id', 'stage_id', 'conversation_id']) {
      if (safeId(data[key])) query.set(key, data[key]);
    }
    const base = role === 'contractor' ? '/work/projects' : role === 'verifier' ? '/verifiers/projects' : '/projects';
    return `${base}/${data.project_id}${query.size ? `?${query}` : ''}`;
  }
  if (s('conversation_id')) return viewer?.isContractor ? '/work' : viewer?.isVerifier ? '/verifiers' : '/messages';
  return null;
}

export async function resolveNotificationDestination(data: Record<string, unknown> | null | undefined, viewer?: NotificationViewer): Promise<string | null> {
  if (!data || data.invitation_token || !safeId(data.project_id)) return destinationFor(data, viewer);
  const access = await fetchProjectTeamAccess(data.project_id);
  if (!access.projectRole) throw new Error('project_access_unavailable');
  return destinationFor(data, { ...viewer, projectRole: access.projectRole });
}
