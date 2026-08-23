import type { Lang } from '../i18n/types.js';

// =========================================================
// Contractor application — the browser-free half
//
// Split out of src/lib/supabase/contractor-applications.ts so that the email
// template can reach it from a Vercel function. That module imports the Supabase
// client (which reads `import.meta.env`) and `@/lib/analytics` (a path alias);
// api/README.md forbids both in anything reachable from api/, and pulling the
// whole module in is what broke the contractor application emails.
//
// Nothing here may import Supabase, analytics, or anything that touches the DOM.
// Relative imports carry `.js` because this file is in the api/ graph.
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

/** True when every Section-6 standard was accepted. */
export function qualifies(input: ContractorApplicationInput): boolean {
  return input.acceptsMilestones && input.acceptsVerification && input.acceptsNoSidePay;
}

/**
 * A stored `contractor_applications` row, as the templates need it.
 *
 * The table is snake_case and the form's shape is camelCase, and the email templates were
 * being handed the row directly with `as any`. Most fields silently came out blank, and
 * `a.projectTypes.length` threw outright — so every applicant acknowledgement failed with
 * a 502 long after the import bug above it was fixed. Two independent faults on the same
 * line of code, which is why fixing the first one changed nothing visible.
 *
 * `as any` is what hid it: the compiler had the answer and was told not to look.
 */
export function applicationFromRow(row: Record<string, any>): ContractorApplicationInput {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  return {
    fullName:     str(row.full_name),
    businessName: str(row.business_name),
    phone:        str(row.phone),
    email:        str(row.email),
    country:      str(row.country),
    city:         str(row.city),
    portfolioUrl: str(row.portfolio_url),

    role:      (row.role ?? 'other') as ContractorRole,
    roleOther: str(row.role_other),

    yearsExperience: str(row.years_experience),
    operatesAs:      str(row.operates_as),
    teamSize:        str(row.team_size),
    projectTypes:    arr<string>(row.project_types),

    credentials: (row.credentials && typeof row.credentials === 'object'
                   ? row.credentials : {}) as Record<string, unknown>,
    uploads:  arr<UploadedFile>(row.uploads),
    projects: arr<ProjectEntry>(row.projects),

    acceptsMilestones:   row.accepts_milestones === true,
    acceptsVerification: row.accepts_verification === true,
    acceptsNoSidePay:    row.accepts_no_side_pay === true,

    videoUrl:       str(row.video_url),
    whyJoin:        str(row.why_join),
    differentiator: str(row.differentiator),
    readyForEarly:  row.ready_for_early === true,

    regions:            str(row.regions),
    concurrentProjects: str(row.concurrent_projects),

    agreedToTerms: row.agreed_to_terms === true,
    lang: row.lang === 'fr' ? 'fr' : 'en',
  };
}
