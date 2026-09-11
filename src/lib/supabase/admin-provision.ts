import { supabase } from './client';
import type { Lang } from '@/lib/i18n/types';

// =========================================================
// Admin creates a client's account.
//
// The browser sends the client's details and gets back the one thing it must show and
// then forget: the temporary password. It is not written anywhere on this side — not
// localStorage, not the URL, not state that outlives the page. See
// api/_handlers/admin-provision-user.ts for what the server does with the request.
// =========================================================

export interface ProvisionInput {
  email: string;
  fullName: string;
  phone?: string;
  country?: string;
  lang?: Lang;
}

export interface ProvisionedAccount {
  userId: string;
  email: string;
  /** Shown once. Never persisted. */
  password: string;
}

/** Error codes the server returns; anything else is a generic failure. */
export type ProvisionError = 'invalid_email' | 'name_required' | 'invalid_country' | 'email_taken' | 'create_failed' | 'not_signed_in' | 'forbidden';

export class ProvisionFailed extends Error {
  constructor(public readonly code: ProvisionError) {
    super(code);
    this.name = 'ProvisionFailed';
  }
}

export async function provisionClientAccount(input: ProvisionInput): Promise<ProvisionedAccount> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new ProvisionFailed('not_signed_in');

  const r = await fetch('/api/events?action=admin-provision-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(input),
  });

  const body = await r.json().catch(() => ({}));
  if (r.status === 404) throw new ProvisionFailed('forbidden');
  if (!r.ok) {
    const code = body?.error as ProvisionError | undefined;
    throw new ProvisionFailed(
      code && ['invalid_email', 'name_required', 'invalid_country', 'email_taken', 'create_failed'].includes(code)
        ? code
        : 'create_failed',
    );
  }
  return { userId: body.userId, email: body.email, password: body.password };
}
