import { supabase } from './client';

// =========================================================
// A partner contractor's own clients (109).
//
// The thing that makes a partner a partner: they bring the client, and the client's
// project is theirs to build. Until 109 only an admin could do this, so the distinction
// existed in conversation and nowhere in the product.
//
// ── The contractor never holds a credential ──────────────────────────────────────────
// Inviting goes through the server, which uses Supabase's own invite — the account and
// the only way into it are created together, and the client chooses their own password.
// A contractor who could sign in as their client would make every project that client
// owns repudiable.
// =========================================================

export interface ContractorClient {
  id: string;
  clientId: string;
  invitedAt: string;
  /** Null until they open the invitation and set a password. */
  acceptedAt: string | null;
}

interface Row {
  id: string;
  client_id: string;
  invited_at: string;
  accepted_at: string | null;
}

/**
 * Whether the partner feature is actually available on this database.
 *
 * The button used to be unconditional, so before 109 was applied a contractor could press
 * it, fill in a client, and get a generic 500 from a missing table. Nothing in the page
 * could tell the difference between "not deployed yet" and "broken".
 *
 * Null while unknown, so the caller can render nothing rather than flashing a button on
 * and off.
 */
export async function partnerOnboardingAvailable(): Promise<boolean> {
  const { error } = await supabase
    .from('contractor_clients').select('id').limit(1);
  if (!error) return true;
  if (error.code === '42P01' || error.code === 'PGRST205') return false;
  // Any other error (a network blip, RLS) is not evidence the feature is missing.
  return true;
}

/**
 * The clients this contractor brought on.
 *
 * Returns an empty list rather than throwing when 109 is not applied: a dashboard that
 * will not load because one panel has no table is worse than a panel with nothing in it.
 */
export async function fetchMyClients(): Promise<ContractorClient[]> {
  const { data, error } = await supabase
    .from('contractor_clients')
    .select('id, client_id, invited_at, accepted_at')
    .order('invited_at', { ascending: false });

  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return [];
    throw error;
  }
  return (data ?? []).map((r: Row) => ({
    id: r.id, clientId: r.client_id, invitedAt: r.invited_at, acceptedAt: r.accepted_at,
  }));
}

export class InviteClientFailed extends Error {
  constructor(public code: string) { super(code); }
}

export interface PendingContractorClient {
  clientId: string;
  fullName: string;
  email: string;
  invitedAt: string;
}

/** Accounts this contractor can resume, with no project already owned by the client. */
export async function fetchPendingClients(): Promise<PendingContractorClient[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new InviteClientFailed('not_signed_in');

  const response = await fetch('/api/events?action=contractor-invite-client', {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new InviteClientFailed(String(json?.error ?? `http_${response.status}`));
  if (!Array.isArray(json?.clients) || !json.clients.every((client: PendingContractorClient) =>
    client && typeof client.clientId === 'string' && client.clientId.length > 0
      && typeof client.fullName === 'string' && typeof client.email === 'string'
      && typeof client.invitedAt === 'string')) {
    throw new InviteClientFailed('pending_clients_failed');
  }
  return json.clients.map(({ clientId, fullName, email, invitedAt }: PendingContractorClient) =>
    ({ clientId, fullName, email, invitedAt }));
}

/**
 * Create the client's account and record them as this contractor's.
 *
 * Returns their id after Supabase sends the client an invitation. The client must open
 * that link and choose their own password before accessing their account. No credential
 * is returned to the contractor.
 *
 * Refused for an address that already has an account: the client must invite the
 * contractor to their own project instead.
 */
export async function inviteMyClient(
  fullName: string, email: string, phone: string,
): Promise<{ clientId: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new InviteClientFailed('not_signed_in');

  const r = await fetch('/api/events?action=contractor-invite-client', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName, email, phone }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new InviteClientFailed(String(json?.error ?? `http_${r.status}`));
  return { clientId: String(json.clientId) };
}

/**
 * Take their place on the project they just created: a member of it, and the primary
 * contractor — which is who a release pays (101).
 *
 * Creating the project does not do this. Membership is `contractor_invites`, and a
 * partner who built a project but was not on it would have made it for somebody else.
 */
export async function takeOwnClientProject(projectId: string): Promise<void> {
  const { error } = await supabase.rpc('contractor_take_own_client_project', { p_project: projectId });
  if (error) throw error;
}
