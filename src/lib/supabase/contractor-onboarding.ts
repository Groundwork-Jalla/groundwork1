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

/**
 * The six steps, in the order the UI walks them.
 *
 * The agreement is FIRST, and the five that follow are locked until it is signed. That
 * is the order the relationship actually has: §3.2 lets Jalla withhold activation until
 * the forms are complete, but the forms ask for a date of birth, a home address, bank
 * details and three next of kin — and the document explaining what Jalla may do with all
 * of that is the agreement itself. Collecting it first and explaining afterwards is
 * backwards.
 *
 * Nothing in SQL depends on this order; `contractor_onboarding_status` returns an object.
 * Reordering here reorders the checklist and the "first unfinished" jump, nothing else.
 */
export type OnboardingStep =
  'agreements' | 'identity' | 'professional' | 'payout' | 'emergency' | 'documents';

/**
 * What they answered at the end: do you have a client to bring on?
 *
 * `null` means not asked yet, and that is what makes the question appear exactly once.
 * A contractor here is either a partner with their own client or somebody waiting to be
 * assigned; the product used to guess, and now it asks.
 */
export type ClientIntent = 'onboard_client' | 'no_client';

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'agreements', 'identity', 'professional', 'payout', 'emergency',
] as const;

/**
 * Reported by the database but no longer required (118).
 *
 * Uploading a licence scan was a step most people cannot finish on a phone on a site,
 * and it gated everything behind it. The column and the RPC remain, so a document
 * already uploaded is still readable by staff and asking again later is one line here.
 */
export const REPORTED_BUT_NOT_REQUIRED: readonly OnboardingStep[] = ['documents'];

/**
 * The step that gates the rest. Separate from the array so the lock has a name rather
 * than being "index 0", which a future reorder would silently change the meaning of.
 */
export const GATING_STEP: OnboardingStep = 'agreements';



export type OnboardingStatus = {
  steps: Record<OnboardingStep, boolean>;
  /** What they do (142). One of CONTRACTOR_ROLES, or 'other'. */
  specialty: string | null;
  /** What they typed when the list did not have it. */
  specialtyOther: string | null;
  /** Whether their profession is one of the regulated five. */
  needsLicence: boolean;
  /** 'registered' | 'independent' | null while unanswered. */
  businessStatus: 'registered' | 'independent' | null;
  /** A registered business owes a registration document; an independent contractor does not. */
  needsBusinessDoc: boolean;
  emergencyCount: number;
  /** null until they answer the question at the end of the form. */
  clientIntent: ClientIntent | null;
  complete: boolean;
};

export type EmergencyContact = { fullName: string; relationship: string; phone: string };

export type ContractorDocumentKind = 'professional_license' | 'business_registration';

const EMPTY_STEPS: Record<OnboardingStep, boolean> = {
  identity: false, professional: false, payout: false,
  emergency: false, documents: false, agreements: false,
};

/** Both the required steps and the ones merely reported, for reading a status. */
const ALL_STEPS = Object.keys(EMPTY_STEPS) as OnboardingStep[];

function toStatus(raw: unknown): OnboardingStatus {
  const r = (raw ?? {}) as Record<string, unknown>;
  const s = (r.steps ?? {}) as Record<string, unknown>;
  const steps = { ...EMPTY_STEPS };
  for (const k of ALL_STEPS) steps[k] = s[k] === true;
  const business = r.business_status;
  return {
    steps,
    specialty: typeof r.specialty === 'string' ? r.specialty : null,
    specialtyOther: typeof r.specialty_other === 'string' ? r.specialty_other : null,
    needsLicence: r.needs_licence === true,
    businessStatus: business === 'registered' || business === 'independent' ? business : null,
    needsBusinessDoc: r.needs_business_doc === true,
    emergencyCount: typeof r.emergency_count === 'number' ? r.emergency_count : 0,
    clientIntent: r.client_intent === 'onboard_client' || r.client_intent === 'no_client'
      ? r.client_intent : null,
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

export interface SpecialtyAnswer {
  specialty: string;
  /** Only when they chose "other" — what they typed. */
  specialtyOther: string | null;
  /** Kept when offered, even where the profession does not require one. */
  licenseNumber: string | null;
}

/**
 * What they do, and a licence only where the profession is regulated (142).
 *
 * Replaces `saveBusiness`. The old call demanded a licence number from everybody and
 * also recorded whether they trade as a registered business — a question onboarding no
 * longer asks, because the partner application asks it where it matters.
 */
export async function saveSpecialty(a: SpecialtyAnswer): Promise<OnboardingStatus> {
  const { data, error } = await supabase.rpc('save_contractor_specialty', {
    p_specialty:       a.specialty,
    p_specialty_other: a.specialtyOther,
    p_license_number:  a.licenseNumber,
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

/**
 * The DB still accepts both, because `agreement_acceptances` is append-only and any
 * Terms of Service signature taken before 117 stays on file.
 */
export type AgreementDocument = 'terms_of_service' | 'partner_agreement';

/**
 * The one document a contractor signs (117).
 *
 * The Terms of Service are the CLIENT's contract. Everything a contractor must agree to
 * — platform access and acceptable use (§6), data (§11 + Schedule C), IP (§12),
 * warranties (§16), liability (§19), governing law (§22) — is in the partner agreement,
 * written for them. `current_agreement_version` returns NULL for anything else, so this
 * is not merely the one we show: it is the only one that can be signed.
 */
// 160: the Contractor Platform Terms of Service. The Partner Agreement is still a
// current, signable document — it is just no longer the price of using the platform,
// which §5 of the Terms states outright.
export const SIGNABLE_AGREEMENTS: readonly AgreementDocument[] = ['terms_of_service'];

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
  /** What they do (142), so the specialty step reopens on their answer. */
  specialty: string | null;
  specialtyOther: string | null;
  /** Kept for the admin dossier: answered by everyone who onboarded before 142. */
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
      .select('date_of_birth, residential_address, license_number, specialty, specialty_other, business_status, business_name, business_reg_number')
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
    specialty:        row.data?.specialty ?? null,
    specialtyOther:   row.data?.specialty_other ?? null,
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

/**
 * Answer the question at the end of the form.
 *
 * Recorded in the database rather than the browser because it must survive a new
 * device — being asked again at every sign-in would read as the product forgetting
 * them. It also tells staff which contractors are partners, without anybody asking.
 */
export async function setClientIntent(intent: ClientIntent): Promise<OnboardingStatus> {
  const { data, error } = await supabase.rpc('set_contractor_client_intent', {
    p_intent: intent,
  });
  if (error) throw error;
  return toStatus(data);
}
