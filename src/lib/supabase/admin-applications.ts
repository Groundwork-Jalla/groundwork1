import { supabase } from './client';
import type { ProjectEntry, UploadedFile } from './contractor-applications';

// =========================================================
// Contractor applications + waitlist — admin reads
//
// Separate from contractor-applications.ts, which is the public submission path
// and ships in the bundle every visitor downloads. Nothing here is reachable
// without an admin session: `admins_read_applications` (026) and
// `admins_read_waitlist` (031) gate every query at the database.
//
// Note what that means for failures — a non-admin does not get an error, they get
// an empty array. So "no applications" and "not actually an admin" look identical
// from here. The layout guard is what distinguishes them.
// =========================================================

export const APPLICATION_STATUSES = [
  'pending', 'reviewing', 'accepted', 'rejected', 'disqualified',
] as const;
export type ApplicationStatus = typeof APPLICATION_STATUSES[number];

/** Statuses an admin may set. `disqualified` is derived at submission, never chosen. */
export const ASSIGNABLE_STATUSES = [
  'reviewing', 'accepted', 'rejected',
] as const satisfies readonly ApplicationStatus[];

/** Row shape for the list — deliberately narrow, the detail view fetches the rest. */
export interface ApplicationSummary {
  id: string;
  fullName: string;
  businessName: string | null;
  email: string;
  phone: string;
  country: string;
  city: string;
  role: string;
  yearsExperience: string;
  status: ApplicationStatus;
  lang: 'en' | 'fr';
  syncedToGhl: boolean;
  createdAt: string;
}

export interface ApplicationDetail extends ApplicationSummary {
  roleOther: string | null;
  portfolioUrl: string | null;
  videoUrl: string | null;
  operatesAs: string;
  teamSize: string | null;
  projectTypes: string[];
  credentials: Record<string, unknown>;
  uploads: UploadedFile[];
  projects: ProjectEntry[];
  acceptsMilestones: boolean;
  acceptsVerification: boolean;
  acceptsNoSidePay: boolean;
  whyJoin: string;
  differentiator: string;
  readyForEarly: boolean;
  regions: string;
  concurrentProjects: string;
  agreedToTerms: boolean;
  syncedToGhlAt: string | null;
}



const LIST_COLUMNS =
  'id, full_name, business_name, email, phone, country, city, role, ' +
  'years_experience, status, lang, synced_to_ghl, created_at';

type Row = Record<string, unknown>;
const s  = (v: unknown): string => (typeof v === 'string' ? v : '');
const sn = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function toSummary(r: Row): ApplicationSummary {
  return {
    id:              s(r.id),
    fullName:        s(r.full_name),
    businessName:    sn(r.business_name),
    email:           s(r.email),
    phone:           s(r.phone),
    country:         s(r.country),
    city:            s(r.city),
    role:            s(r.role),
    yearsExperience: s(r.years_experience),
    status:          (APPLICATION_STATUSES as readonly string[]).includes(s(r.status))
                       ? (r.status as ApplicationStatus) : 'pending',
    lang:            r.lang === 'fr' ? 'fr' : 'en',
    syncedToGhl:     r.synced_to_ghl === true,
    createdAt:       s(r.created_at),
  };
}

/**
 * Newest first. There is no pagination yet — the founding network is a few hundred
 * applications at most, and a filter plus a search covers it. Add a range() here
 * before that stops being true.
 */
export async function listApplications(): Promise<ApplicationSummary[]> {
  const { data, error } = await supabase
    .from('contractor_applications')
    .select(LIST_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) throw error;
  // supabase-js only infers row types from a literal column string; LIST_COLUMNS is a
  // const, so the inferred type degrades to a union with GenericStringError.
  return ((data ?? []) as unknown as Row[]).map(toSummary);
}

export async function getApplication(id: string): Promise<ApplicationDetail | null> {
  const { data, error } = await supabase
    .from('contractor_applications')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const r = data as Row;
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  return {
    ...toSummary(r),
    roleOther:           sn(r.role_other),
    portfolioUrl:        sn(r.portfolio_url),
    videoUrl:            sn(r.video_url),
    operatesAs:          s(r.operates_as),
    teamSize:            sn(r.team_size),
    projectTypes:        arr<string>(r.project_types),
    credentials:         (r.credentials && typeof r.credentials === 'object'
                           ? r.credentials as Record<string, unknown> : {}),
    uploads:             arr<UploadedFile>(r.uploads),
    projects:            arr<ProjectEntry>(r.projects),
    acceptsMilestones:   r.accepts_milestones === true,
    acceptsVerification: r.accepts_verification === true,
    acceptsNoSidePay:    r.accepts_no_side_pay === true,
    whyJoin:             s(r.why_join),
    differentiator:      s(r.differentiator),
    readyForEarly:       r.ready_for_early === true,
    regions:             s(r.regions),
    concurrentProjects:  s(r.concurrent_projects),
    agreedToTerms:       r.agreed_to_terms === true,
    syncedToGhlAt:       sn(r.synced_to_ghl_at),
  };
}

export async function setApplicationStatus(
  id: string,
  status: typeof ASSIGNABLE_STATUSES[number],
): Promise<void> {
  const { error } = await supabase
    .from('contractor_applications')
    .update({ status })
    .eq('id', id);

  if (error) throw error;
}

/**
 * `contractor-docs` is a private bucket — the applicant can write to it but nobody
 * can read it back without `is_admin()`. So a stored path is not a URL; it has to be
 * signed on demand. One hour is long enough to open a PDF and short enough that a
 * copied link is not a lasting leak.
 */
export async function signCredentialUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('contractor-docs')
    .createSignedUrl(path, 60 * 60);

  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Publish an accepted application into the public contractor directory.
 *
 * The mapping lives in `admin_promote_application()` (migration 033) rather than here:
 * it reads an admin-only table and writes another in one transaction, and doing it in
 * SQL keeps the field translation — experience bucket to a number, city+country to one
 * location string, project types to specialties — in a single place that cannot drift.
 * Idempotent on contractors.application_id, so accepting twice updates one row.
 */
export async function promoteApplication(applicationId: string): Promise<string> {
  const { data, error } = await supabase
    .rpc('admin_promote_application', { p_application_id: applicationId });
  if (error) throw error;
  return String(data ?? '');
}

/**
 * Email the applicant their decision. The endpoint takes only an id and the decision —
 * it reads the address, name and language from the row itself, so the admin's browser
 * never chooses who gets mail from our sending domain.
 */
export async function sendDecisionEmail(
  applicationId: string,
  decision: 'accepted' | 'rejected',
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('not signed in');

  const r = await fetch('/api/send-application-decision', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ applicationId, decision }),
  });
  if (!r.ok) throw new Error(`decision email failed: ${r.status}`);
}

// ── Contractor directory ───────────────────────────────────

export interface DirectoryEntry {
  id: string;
  name: string;
  trade: string;
  location: string;
  yearsExp: number;
  completedProjects: number;
  specialties: string[];
  verified: boolean;
  active: boolean;
  email: string | null;
  phone: string | null;
  /** Set when this entry was published from an application. */
  applicationId: string | null;
  createdAt: string;
}

/**
 * Admins see inactive entries too — `admins_read_all_contractors` (033) sits alongside
 * the public policy, which only exposes active ones.
 */
export async function listDirectory(): Promise<DirectoryEntry[]> {
  const { data, error } = await supabase
    .from('contractors')
    .select('id, name, trade, location, years_exp, completed_projects, specialties, ' +
            'verified, active, email, phone, application_id, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;

  return ((data ?? []) as unknown as Row[]).map(r => ({
    id:                s(r.id),
    name:              s(r.name),
    trade:             s(r.trade),
    location:          s(r.location),
    yearsExp:          typeof r.years_exp === 'number' ? r.years_exp : 0,
    completedProjects: typeof r.completed_projects === 'number' ? r.completed_projects : 0,
    specialties:       Array.isArray(r.specialties) ? (r.specialties as string[]) : [],
    verified:          r.verified === true,
    active:            r.active === true,
    email:             sn(r.email),
    phone:             sn(r.phone),
    applicationId:     sn(r.application_id),
    createdAt:         s(r.created_at),
  }));
}

/**
 * Remove a directory entry permanently. Prefer setDirectoryActive() — hiding keeps the
 * row, and its link back to the application it was published from, so the decision can
 * be reversed. Delete is for entries that should never have existed.
 */
export async function deleteDirectoryEntry(id: string): Promise<void> {
  const { error } = await supabase.from('contractors').delete().eq('id', id);
  if (error) throw error;
}

/** Take an entry down without deleting it — reviews and history stay intact. */
export async function setDirectoryActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('contractors').update({ active }).eq('id', id);
  if (error) throw error;
}

// ── Waitlist ───────────────────────────────────────────────

export interface WaitlistEntry {
  id: string;
  email: string;
  /** Language the signup form was in (migration 034). */
  lang: 'en' | 'fr';
  syncedToGhl: boolean;
  syncedToGhlAt: string | null;
  createdAt: string;
}

/** Remove someone from the waitlist. Requires migration 035 for the DELETE policy. */
export async function deleteWaitlistEntry(id: string): Promise<void> {
  const { error } = await supabase.from('waitlist_emails').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Requires migration 031. Before it, RLS silently returns zero rows — the table has
 * had an INSERT policy and no SELECT policy since 002.
 */
export async function listWaitlist(): Promise<WaitlistEntry[]> {
  const { data, error } = await supabase
    .from('waitlist_emails')
    .select('id, email, lang, synced_to_ghl, synced_to_ghl_at, created_at')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id:            s(r.id),
    email:         s(r.email),
    lang:          r.lang === 'fr' ? 'fr' : 'en',
    syncedToGhl:   r.synced_to_ghl === true,
    syncedToGhlAt: sn(r.synced_to_ghl_at),
    createdAt:     s(r.created_at),
  }));
}
