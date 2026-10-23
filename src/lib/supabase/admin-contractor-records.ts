import { supabase } from './client';
import type { ClientIntent, OnboardingStatus } from './contractor-onboarding';

// =========================================================
// What a contractor filled in, for staff (118).
//
// Separate from /admin/contractors, which is the published DIRECTORY — the list clients
// browse. A contractor has an onboarding record whether or not they are published, and
// most of the ones Philip needs to look at are not published yet. Keying this off the
// directory would have hidden exactly the people it exists to show.
//
// Everything here is read-only. Staff manage the actor; they do not fill the form in
// for them — the contractor's own answers are the record.
// =========================================================

export interface ContractorRecordRow {
  userId: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  clientIntent: ClientIntent | null;
  signedAt: string | null;
  status: OnboardingStatus;
}

export interface EmergencyContactRow {
  position: number;
  full_name: string;
  relationship: string;
  phone: string;
}

export interface PayoutRow {
  id: string;
  country_code: string;
  method: 'mobile_money' | 'bank';
  mobile_no: string | null;
  /** A Groundwork bank slug, not a provider routing code — renamed in 101, and the
   *  dossier payload caught up in 158. */
  bank_key: string | null;
  account_number: string | null;
  account_name: string | null;
  status: string;
  is_default: boolean;
}

export interface ContractorDossier {
  profile: { email: string | null; full_name: string | null; phone: string | null } | null;
  onboarding: {
    date_of_birth: string | null;
    residential_address: string | null;
    license_number: string | null;
    business_status: 'registered' | 'independent' | null;
    business_name: string | null;
    business_reg_number: string | null;
    client_intent: ClientIntent | null;
    client_intent_at: string | null;
  } | null;
  emergency_contacts: EmergencyContactRow[];
  payout_destinations: PayoutRow[];
  agreements: { document: string; version: string; signed_name: string; accepted_at: string }[];
  documents: { kind: string; filename: string; path: string; uploaded_at: string }[];
  status: OnboardingStatus;
}

/** Is 118 on this database? Same guard as the rest — absent means hide, not error. */
export async function contractorRecordsAvailable(): Promise<boolean> {
  const { error } = await supabase.rpc('admin_contractor_onboarding');
  if (!error) return true;
  if (error.code === 'PGRST202' || error.code === '42P01' || error.code === 'PGRST205') return false;
  return true;
}

export async function fetchContractorRecords(): Promise<ContractorRecordRow[]> {
  const { data, error } = await supabase.rpc('admin_contractor_onboarding');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    userId:   String(r.user_id),
    email:    (r.email as string) ?? null,
    fullName: (r.full_name as string) ?? null,
    phone:    (r.phone as string) ?? null,
    clientIntent: r.client_intent === 'onboard_client' || r.client_intent === 'no_client'
      ? r.client_intent : null,
    signedAt: (r.signed_at as string) ?? null,
    status:   r.status as OnboardingStatus,
  }));
}

/**
 * The whole record for one contractor.
 *
 * Account numbers come back UNMASKED. That is the point of the call and the reason the
 * database refuses it to anyone who is not an administrator: somebody releasing a
 * payment has to check the number against what the contractor told them, and a masked
 * number cannot be checked.
 */
export async function fetchContractorDossier(userId: string): Promise<ContractorDossier> {
  const { data, error } = await supabase.rpc('admin_contractor_dossier', { p_user: userId });
  if (error) throw error;
  return data as ContractorDossier;
}
