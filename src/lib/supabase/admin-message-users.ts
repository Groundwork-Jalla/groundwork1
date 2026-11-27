import { supabase } from './client';
import type { Lang } from '@/lib/i18n/types';

export interface AdminMessageUsersInput {
  userIds: string[];
  subject: string;
  message: string;
  lang: Lang;
  includeActionLink: boolean;
  actionLabel?: string;
  actionPath?: string;
}

export interface AdminMessageUsersResult {
  ok: boolean;
  batchId: string;
  sent: number;
  failed: number;
  skipped: number;
  failures: { email: string; error: string }[];
}

export type AdminMessageUsersErrorCode =
  | 'not_signed_in'
  | 'forbidden'
  | 'recipients_required'
  | 'subject_required'
  | 'message_required'
  | 'invalid_action_url'
  | 'no_valid_recipients'
  | 'send_failed';

export class AdminMessageUsersError extends Error {
  constructor(public readonly code: AdminMessageUsersErrorCode) {
    super(code);
    this.name = 'AdminMessageUsersError';
  }
}

const KNOWN_ERRORS: readonly AdminMessageUsersErrorCode[] = [
  'recipients_required',
  'subject_required',
  'message_required',
  'invalid_action_url',
  'no_valid_recipients',
];

export async function sendAdminUsersMessage(
  input: AdminMessageUsersInput,
): Promise<AdminMessageUsersResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new AdminMessageUsersError('not_signed_in');

  const response = await fetch('/api/events?action=admin-message-users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(input),
  });

  const body = await response.json().catch(() => ({}));
  if (response.status === 401) throw new AdminMessageUsersError('not_signed_in');
  if (response.status === 404 || response.status === 403) {
    throw new AdminMessageUsersError('forbidden');
  }
  if (!response.ok) {
    const code = body?.error as AdminMessageUsersErrorCode | undefined;
    throw new AdminMessageUsersError(
      code && KNOWN_ERRORS.includes(code) ? code : 'send_failed',
    );
  }

  return {
    ok: Boolean(body.ok),
    batchId: typeof body.batchId === 'string' ? body.batchId : '',
    sent: Number(body.sent ?? 0),
    failed: Number(body.failed ?? 0),
    skipped: Number(body.skipped ?? 0),
    failures: Array.isArray(body.failures) ? body.failures : [],
  };
}
