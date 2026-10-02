import { supabase } from './client';
import type { PayoutDestination, PayoutMethod } from '@/lib/payments/payout-destination';

// =========================================================
// Reading and writing where a contractor is paid (099, 101).
//
// Every write is an RPC. The table grants no INSERT/UPDATE/DELETE to anybody (099), for two
// reasons that matter: swapping the default has to be one transaction, and the audit line
// has to be written by the same thing that made the change. A direct `.insert()` here would
// simply be refused — which is the design working, not a bug to route around.
//
// Reads are bounded by RLS: the owner sees their own rows and staff see all of them. So
// `select *` returns the current contractor's destinations and nobody else's, and one
// contractor can never enumerate another's accounts.
// =========================================================

const COLUMNS =
  'id, owner_id, country_code, method, mobile_no, bank_key, account_number, account_name, status, is_default, created_at, verified_at';

interface Row {
  id: string;
  owner_id: string;
  country_code: string;
  method: PayoutMethod;
  mobile_no: string | null;
  bank_key: string | null;
  account_number: string | null;
  account_name: string | null;
  status: PayoutDestination['status'];
  is_default: boolean;
  created_at: string;
  verified_at: string | null;
}

const toDestination = (r: Row): PayoutDestination => ({
  id: r.id,
  ownerId: r.owner_id,
  countryCode: r.country_code,
  method: r.method,
  mobileNo: r.mobile_no,
  bankKey: r.bank_key,
  accountNumber: r.account_number,
  accountName: r.account_name,
  status: r.status,
  isDefault: r.is_default,
  createdAt: r.created_at,
  verifiedAt: r.verified_at,
});

/**
 * The signed-in contractor's own destinations, retired ones included.
 *
 * Retired rows are returned rather than hidden: somebody checking why a payout went to an
 * old number needs to see that the old number is still on file and stood down.
 */
export async function fetchMyPayoutDestinations(): Promise<PayoutDestination[]> {
  const { data, error } = await supabase
    .from('payout_destinations')
    .select(COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Row[]).map(toDestination);
}

/** One person's destinations, for the admin who has to run the payout. RLS decides. */
export async function fetchPayoutDestinationsFor(ownerId: string): Promise<PayoutDestination[]> {
  const { data, error } = await supabase
    .from('payout_destinations')
    .select(COLUMNS)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Row[]).map(toDestination);
}

export interface NewDestination {
  ownerId: string;
  countryCode: string;
  method: PayoutMethod;
  /** E.164, including the country code. 099 rejects anything else. */
  mobileNo?: string | null;
  /** Groundwork's key for the bank, from `banks.ts`. Never a provider routing code. */
  bankKey?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  makeDefault?: boolean;
}

/**
 * Add a destination. It arrives `unverified` and is not yet somewhere money may be sent —
 * `add_payout_destination` has no path to `verified`, by design.
 *
 * Only the fields belonging to the chosen method are sent. 099's shape CHECK refuses a row
 * that carries both, so passing a stale bank code alongside a phone number would be
 * rejected outright rather than stored as a blur of the two.
 */
export async function addPayoutDestination(d: NewDestination): Promise<string> {
  const mobile = d.method === 'mobile_money';
  const { data, error } = await supabase.rpc('add_payout_destination', {
    p_owner: d.ownerId,
    p_country: d.countryCode,
    p_method: d.method,
    p_mobile: mobile ? (d.mobileNo ?? null) : null,
    p_bank_key: mobile ? null : (d.bankKey ?? null),
    p_account_number: mobile ? null : (d.accountNumber ?? null),
    p_account_name: d.accountName ?? null,
    p_make_default: d.makeDefault ?? false,
  });
  if (error) throw error;
  return data as string;
}

export async function setDefaultPayoutDestination(id: string): Promise<void> {
  const { error } = await supabase.rpc('set_default_payout_destination', { p_destination: id });
  if (error) throw error;
}

export async function retirePayoutDestination(id: string): Promise<void> {
  const { error } = await supabase.rpc('retire_payout_destination', { p_destination: id });
  if (error) throw error;
}

/**
 * Staff only — 099 refuses anybody else. This is the act that turns numbers on file into
 * permission to send money to them, which is why no contractor-facing screen calls it.
 */
export async function verifyPayoutDestination(id: string): Promise<void> {
  const { error } = await supabase.rpc('verify_payout_destination', { p_destination: id });
  if (error) throw error;
}

// ── What a release would do (101) ────────────────────────

/** Why a release to this person cannot be sent yet. NULL/null means it can. */
export type PayoutBlocker = 'no_contractor' | 'no_details' | 'no_default' | 'unverified' | null;

/** Reasons `project_payout_target` can give on top of a person's own. */
export type ProjectPayoutBlocker = PayoutBlocker | 'no_primary';

export interface ProjectPayoutTarget {
  contractorId: string | null;
  /** The invite's email — the primary contractor's name is not on the invite row. */
  contractorName: string | null;
  inviteId: string | null;
  destinationId: string | null;
  blocker: ProjectPayoutBlocker;
}

/**
 * Who this project pays and whether money can move, straight from the database so a screen
 * cannot promise something `authorise_release` will then refuse. Carries no account digits.
 */
export async function fetchProjectPayoutTarget(projectId: string): Promise<ProjectPayoutTarget> {
  const { data, error } = await supabase.rpc('project_payout_target', { p_project: projectId });
  if (error) throw error;
  const j = (data ?? {}) as Record<string, unknown>;
  return {
    contractorId: (j.contractor_id as string | null) ?? null,
    contractorName: (j.contractor_name as string | null) ?? null,
    inviteId: (j.invite_id as string | null) ?? null,
    destinationId: (j.destination_id as string | null) ?? null,
    blocker: (j.blocker as ProjectPayoutBlocker) ?? null,
  };
}

/** Why a named contractor cannot be paid yet. */
export async function fetchPayoutBlocker(contractorId: string): Promise<PayoutBlocker> {
  const { data, error } = await supabase.rpc('contractor_payout_blocker', { p_contractor: contractorId });
  if (error) throw error;
  return (data as PayoutBlocker) ?? null;
}

/**
 * Name the contractor this project pays by default. Staff or the project owner; 101 refuses
 * an assignment that is not accepted, and one whose holder has no Groundwork account.
 */
export async function setPrimaryContractor(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('set_primary_contractor', { p_invite: inviteId });
  if (error) throw error;
}
