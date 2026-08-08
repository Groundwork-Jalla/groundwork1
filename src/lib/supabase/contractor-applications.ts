import { supabase } from './client';
import { trackEvent } from '@/lib/analytics';
import type { Lang } from '@/lib/i18n/types';

// =========================================================
// Contractor application — submission pipeline
//
// Supabase is the source of truth. GoHighLevel receives a lead-shaped summary
// and drives CRM + notifications. The applicant receives a full copy by email.
//
// Ordering matters: the row is saved FIRST. Everything after it (CRM forward,
// emails) is a mirror, and a failure in any of them must never turn a saved
// application into a visible error for the person applying.
// =========================================================

export const CONTRACTOR_ROLES = [
  'general_contractor', 'land_lawyer', 'structural_engineer', 'architect',
  'quantity_surveyor', 'land_surveyor', 'electrician', 'plumber', 'mason',
  'carpenter', 'roofing', 'interior_finishing', 'other',
] as const;
export type ContractorRole = typeof CONTRACTOR_ROLES[number];

/**
 * Which Section-4 credential block a role sees. The spec groups thirteen roles
 * into four credential paths — this is that mapping in one place, so the form
 * and the email agree on what was asked.
 */
export type CredentialTrack = 'contractor' | 'lawyer' | 'technical' | 'trade';

export function credentialTrack(role: ContractorRole): CredentialTrack {
  switch (role) {
    case 'land_lawyer':
      return 'lawyer';
    case 'structural_engineer':
    case 'architect':
    case 'quantity_surveyor':
    case 'land_surveyor':
      return 'technical';
    case 'electrician':
    case 'plumber':
    case 'mason':
    case 'carpenter':
    case 'roofing':
    case 'interior_finishing':
      return 'trade';
    default:
      return 'contractor';
  }
}

export interface ProjectEntry {
  name: string;
  location: string;
  budget: string;
  role: string;
  year: string;
  refName: string;
  refPhone: string;
  refEmail: string;
}

export interface UploadedFile {
  label: string;
  path: string;
  size: number;
}

export interface ContractorApplicationInput {
  // Section 1
  fullName: string;
  businessName: string;
  phone: string;
  email: string;
  country: string;
  city: string;
  portfolioUrl: string;
  // Section 2
  role: ContractorRole;
  roleOther: string;
  // Section 3
  yearsExperience: string;
  operatesAs: string;
  teamSize: string;
  projectTypes: string[];
  // Section 4 (shape depends on credentialTrack)
  credentials: Record<string, unknown>;
  uploads: UploadedFile[];
  // Section 5
  projects: ProjectEntry[];
  // Section 6
  acceptsMilestones: boolean;
  acceptsVerification: boolean;
  acceptsNoSidePay: boolean;
  // Section 7
  videoUrl: string;
  whyJoin: string;
  differentiator: string;
  readyForEarly: boolean;
  // Section 8
  regions: string;
  concurrentProjects: string;
  // Section 9
  agreedToTerms: boolean;
  // Meta
  lang: Lang;
}

/**
 * Upload one credential file to the private `contractor-docs` bucket.
 *
 * Applicants are anonymous, so the path is namespaced by a random id rather than
 * a user id. The bucket is insert-only to the public — nobody but an admin can
 * read a file back, so an unguessable path is belt-and-braces, not the control.
 */
export async function uploadCredential(
  file: File,
  label: string,
  submissionId: string,
): Promise<UploadedFile> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${submissionId}/${Date.now()}_${safeName}`;

  const { error } = await supabase.storage
    .from('contractor-docs')
    .upload(path, file, { cacheControl: '3600', upsert: false });

  if (error) throw error;
  return { label, path, size: file.size };
}

/** True when every Section-6 standard was accepted. */
export function qualifies(input: ContractorApplicationInput): boolean {
  return input.acceptsMilestones && input.acceptsVerification && input.acceptsNoSidePay;
}

/**
 * Persist the application and mirror it to GoHighLevel.
 *
 * Returns the new row id. Throws only if the Supabase insert fails — that is the
 * one step that actually loses the application if it goes wrong.
 *
 * The id is minted here rather than read back from the insert. Applicants are
 * anonymous and the table has no SELECT policy for `anon` — deliberately, since rows
 * hold phone numbers, client references and credentials. Asking PostgREST to return
 * the inserted row (`.select()`) makes it re-read that row under RLS, which anon
 * cannot do, and the whole insert fails with 42501. Supplying the UUID sidesteps the
 * read-back entirely, so the write path needs no read permission at all.
 */
export async function submitContractorApplication(
  input: ContractorApplicationInput,
): Promise<string> {
  const status = qualifies(input) ? 'pending' : 'disqualified';
  const id = crypto.randomUUID();

  const { error } = await supabase
    .from('contractor_applications')
    .insert({
      id,
      full_name:     input.fullName.trim(),
      business_name: input.businessName.trim() || null,
      phone:         input.phone.trim(),
      email:         input.email.trim().toLowerCase(),
      country:       input.country.trim(),
      city:          input.city.trim(),
      portfolio_url: input.portfolioUrl.trim() || null,

      role:       input.role,
      role_other: input.roleOther.trim() || null,

      years_experience: input.yearsExperience,
      operates_as:      input.operatesAs,
      team_size:        input.teamSize.trim() || null,
      project_types:    input.projectTypes,

      credentials: input.credentials,
      uploads:     input.uploads,
      projects:    input.projects,

      accepts_milestones:   input.acceptsMilestones,
      accepts_verification: input.acceptsVerification,
      accepts_no_side_pay:  input.acceptsNoSidePay,

      video_url:       input.videoUrl.trim() || null,
      why_join:        input.whyJoin.trim(),
      differentiator:  input.differentiator.trim(),
      ready_for_early: input.readyForEarly,

      regions:             input.regions.trim(),
      concurrent_projects: input.concurrentProjects,

      agreed_to_terms: input.agreedToTerms,
      status,
      lang: input.lang,
    });

  if (error) throw error;

  // Mirror into GoHighLevel. Deliberately not awaited: the application is already
  // saved, and a CRM outage must not surface as a failed submission.
  void fetch('/api/ghl/contractor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      applicationId: id,
      fullName:  input.fullName.trim(),
      email:     input.email.trim().toLowerCase(),
      phone:     input.phone.trim(),
      businessName: input.businessName.trim() || null,
      country:   input.country.trim(),
      city:      input.city.trim(),
      role:      input.role,
      roleOther: input.roleOther.trim() || null,
      yearsExperience:    input.yearsExperience,
      operatesAs:         input.operatesAs,
      concurrentProjects: input.concurrentProjects,
      regions:      input.regions.trim(),
      portfolioUrl: input.portfolioUrl.trim() || null,
      videoUrl:     input.videoUrl.trim() || null,
      projectCount: input.projects.length,
      uploadCount:  input.uploads.length,
      status,
      lang: input.lang,
    }),
  }).catch(() => { /* mirror only — never blocks the applicant */ });

  trackEvent('contractor_application_submitted', { role: input.role, status });

  return id;
}
