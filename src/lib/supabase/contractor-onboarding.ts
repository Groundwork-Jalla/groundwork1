import { supabase } from './client';

// =========================================================
// Contractor onboarding (116).
//
// The same sequence for every contractor — an approved applicant, somebody who signed up
// at /contractor-signup, or a contractor invited onto one project. Tier (Founding,
// Certified, Strategic, per Schedule B of the partner agreement) changes what they are
// paid, never what Jalla holds on file about them.
//
// ── Nothing here decides whether a step is done ─────────────────────────────────────
// `contractor_onboarding_status` does, in SQL, and this module just carries the answer.
// That is deliberate: the dashboard banner, the checklist, the gate and the admin list
// all need the same answer, and a second opinion in TypeScript is how a contractor ends
// up being told they are finished by one screen and blocked by another.
//
// ── The payout step is not stored here ───────────────────────────────────────────────
// It is satisfied by a row in `payout_destinations` (099), which already models bank and
// mobile money properly. The step links to /work/payouts rather than asking for account
// numbers a second time.
// =========================================================

/** The six steps, in the order the UI walks them. */
export const ONBOARDING_STEPS = [
  'identity', 'professional', 'payout', 'emergency', 'documents', 'agreements',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type OnboardingStatus = {
  steps: Record<OnboardingStep, boolean>;
  /** 'registered' | 'independent' | null while unanswered. */
  businessStatus: 'registered' | 'independent' | null;
  /** A registered business owes a registration document; an independent contractor does not. */
  needsBusinessDoc: boolean;
  emergencyCount: number;
  complete: boolean;
};

export type EmergencyContact = { fullName: string; relationship: string; phone: string };

export type ContractorDocumentKind = 'professional_license' | 'business_registration';

const EMPTY_STEPS: Record<OnboardingStep, boolean> = {
  identity: false, professional: false, payout: false,
  emergency: false, documents: false, agreements: false,
};

function toStatus(raw: unknown): OnboardingStatus {
  const r = (raw ?? {}) as Record<string, unknown>;
  const s = (r.steps ?? {}) as Record<string, unknown>;
  const steps = { ...EMPTY_STEPS };
  for (const k of ONBOARDING_STEPS) steps[k] = s[k] === true;
  const business = r.business_status;
  return {
    steps,
    businessStatus: business === 'registered' || business === 'independent' ? business : null,
    needsBusinessDoc: r.needs_business_doc === true,
    emergencyCount: typeof r.emergency_count === 'number' ? r.emergency_count : 0,
    // Trusted from SQL rather than recomputed from `steps`: one definition, and if the
    // two ever disagreed the database is the one that governs.
    complete: r.complete === true,
  };
}

/**
 * Is 116 on this database at all?
 *
 * The same guard `partnerOnboardingAvailable` uses, and for the same reason: a surface
 * that cannot work yet should be absent, not an error. A contractor must never be shown
 * a checklist that 500s when they press it.
 */
export async function onboardingAvailable(): Promise<boolean> {
  const { error } = await supabase.rpc('contractor_onboarding_status', { p_user: null });
  if (!error) return true;
  // PGRST202: the function is absent (or its argument names differ). 42P01: no table.
  if (error.code === 'PGRST202' || error.code === '42P01' || error.code === 'PGRST205') return false;
  // Anything else — a refusal, a network blip — is not evidence the feature is missing.
  return true;
}

export async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  const { data, error } = await supabase.rpc('contractor_onboarding_status', { p_user: null });
  if (error) throw error;
  return toStatus(data);
}

export async function saveIdentity(dateOfBirth: string, address: string): Promise<OnboardingStatus> {
  const { data, error } = await supabase.rpc('save_contractor_identity', {
    p_date_of_birth: dateOfBirth,
    p_address: address,
  });
  if (error) throw error;
  return toStatus(data);
}

export async function saveBusiness(input: {
  licenseNumber: string;
  businessStatus: 'registered' | 'independent';
  businessName?: string;
  businessRegNumber?: string;
}): Promise<OnboardingStatus> {
  const { data, error } = await supabase.rpc('save_contractor_business', {
    p_license_number: input.licenseNumber,
    p_business_status: input.businessStatus,
    p_business_name: input.businessName ?? null,
    p_business_reg_number: input.businessRegNumber ?? null,
  });
  if (error) throw error;
  return toStatus(data);
}

/** All three at once — a half-filled set must never sit there looking finished. */
export async function saveEmergencyContacts(contacts: EmergencyContact[]): Promise<OnboardingStatus> {
  const { data, error } = await supabase.rpc('save_contractor_emergency_contacts', {
    p_contacts: contacts.map(c => ({
      full_name: c.fullName, relationship: c.relationship, phone: c.phone,
    })),
  });
  if (error) throw error;
  return toStatus(data);
}

/**
 * Upload a required document, then record where it went.
 *
 * The file goes to the private `contractor-docs` bucket under this contractor's own
 * folder. Both the storage policy and `record_contractor_document` check that prefix, so
 * a tampered path fails twice rather than recording a row pointing at somebody else's
 * file.
 */
export async function uploadDocument(
  kind: ContractorDocumentKind,
  file: File,
): Promise<OnboardingStatus> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('not_signed_in');

  // The extension is kept so the admin can open it; the rest of the name is ours, because
  // an uploaded filename is user input that ends up in a storage path.
  const ext = (/\.([a-zA-Z0-9]{1,8})$/.exec(file.name)?.[1] ?? 'bin').toLowerCase();
  const path = `onboarding/${uid}/${kind}-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('contractor-docs')
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;

  const { data, error } = await supabase.rpc('record_contractor_document', {
    p_kind: kind,
    p_path: path,
    p_filename: file.name,
    p_size: file.size,
    p_mime: file.type || null,
  });
  if (error) throw error;
  return toStatus(data);
}

export type AgreementDocument = 'terms_of_service' | 'partner_agreement';

/**
 * Sign an agreement.
 *
 * The VERSION is not passed. The database decides which version is current, so a browser
 * cannot claim to have signed a document it was never shown.
 */
export async function acceptAgreement(
  document: AgreementDocument,
  signedName: string,
): Promise<OnboardingStatus> {
  const { data, error } = await supabase.rpc('accept_agreement', {
    p_document: document,
    p_signed_name: signedName,
  });
  if (error) throw error;
  return toStatus(data);
}

/** What is already on file, so the forms open filled in rather than blank. */
export async function fetchOnboardingRecord(): Promise<{
  dateOfBirth: string | null;
  address: string | null;
  licenseNumber: string | null;
  /**
   * Load-bearing. Without it the business step reopens with no option selected, and
   * saving the wrong one clears the company name and number and deletes the uploaded
   * registration document — `save_contractor_business` tidies up after an answer of
   * 'independent'. A blank radio must never be able to cause that.
   */
  businessStatus: 'registered' | 'independent' | null;
  businessName: string | null;
  businessRegNumber: string | null;
  contacts: EmergencyContact[];
  documents: { kind: ContractorDocumentKind; filename: string }[];
}> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('not_signed_in');

  const [row, contacts, docs] = await Promise.all([
    supabase.from('contractor_onboarding')
      .select('date_of_birth, residential_address, license_number, business_status, business_name, business_reg_number')
      .eq('user_id', uid).maybeSingle(),
    supabase.from('contractor_emergency_contacts')
      .select('full_name, relationship, phone').eq('user_id', uid).order('position'),
    supabase.from('contractor_documents')
      .select('kind, filename').eq('user_id', uid),
  ]);

  return {
    dateOfBirth:      row.data?.date_of_birth ?? null,
    address:          row.data?.residential_address ?? null,
    licenseNumber:    row.data?.license_number ?? null,
    businessStatus:   row.data?.business_status === 'registered' ? 'registered'
                    : row.data?.business_status === 'independent' ? 'independent'
                    : null,
    businessName:     row.data?.business_name ?? null,
    businessRegNumber: row.data?.business_reg_number ?? null,
    contacts: (contacts.data ?? []).map(c => ({
      fullName: c.full_name, relationship: c.relationship, phone: c.phone,
    })),
    documents: (docs.data ?? []) as { kind: ContractorDocumentKind; filename: string }[],
  };
}
