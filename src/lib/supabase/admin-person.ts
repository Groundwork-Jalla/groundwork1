import { supabase } from './client';
import { listAdminUsers } from './admin-users';

// =========================================================
// Everything one person gave us, in one record.
//
// Favour, 11 Nov 2026: "I want to be able to preview users' details from the admin —
// the details they used to sign up. From the user section, or the client section, or
// the contractor section. Once I click on their name I should be able to see all."
//
// Signup leaves a person spread over four tables, each written by a different door:
//
//   profiles                 every account — name, email, phone, country, language
//   contractor_onboarding    a contractor's own details — DOB, address, licence, trade
//   contractor_applications  what they put on the application form, often BEFORE an
//                            account existed (only 20 of 60 are linked to a user id)
//   projects                 what they have started
//
// Roles are NOT read from `user_roles`: 009 deliberately gives admins no SELECT on it
// (`is_admin()` reads it internally). They come from the list row that opened the
// preview, or failing that from the `admin_list_users()` RPC, which joins them.
//
// ── Resolving the person ───────────────────────────────────────────────────────────
// The three lists hold three different handles. Users and Clients carry the user id.
// The contractor directory does not — it is a published listing, tied to a person
// only through its application (and that only sometimes carries a user id) or its
// email. So a reference is whichever of those the caller has, and resolution walks
// application → user id / email → profile, and never invents a match: a directory
// entry with no application and no email is simply a listing with no account behind
// it, and the panel says so.
//
// ── Read-only, and only through RLS ────────────────────────────────────────────────
// Nothing here writes, and nothing bypasses a policy. `admin_select_all_profiles`
// (009), `contractor_onboarding_read` (116) and `admins_read_applications` (026) are
// what make it work for an admin and nothing else for anyone else.
// =========================================================

/** Whichever handle the opening list had. At least one must be set. */
export interface PersonRef {
  userId?: string | null;
  applicationId?: string | null;
  email?: string | null;
}

export interface PersonAccount {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  /** Where they said they were at signup (ISO country). */
  signupCountry: string | null;
  preferredLang: 'en' | 'fr' | null;
  roles: string[];
  tier: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  mustChangePassword: boolean;
  provisionedBy: string | null;
  ghlContactId: string | null;
  syncedToCrm: boolean;
}

export interface PersonOnboarding {
  dateOfBirth: string | null;
  address: string | null;
  licenseNumber: string | null;
  specialty: string | null;
  specialtyOther: string | null;
  businessStatus: string | null;
  businessName: string | null;
  businessRegNumber: string | null;
  clientIntent: string | null;
  partnerInterest: string | null;
  emergencyContacts: { fullName: string; relationship: string | null; phone: string | null }[];
  documents: { kind: string; filename: string }[];
}

export interface PersonApplication {
  id: string;
  status: string;
  role: string | null;
  roleOther: string | null;
  yearsExperience: number | null;
  operatesAs: string | null;
  businessName: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string;
  teamSize: string | null;
  regions: string | null;
  createdAt: string;
}

export interface PersonProject {
  id: string;
  name: string;
  status: string | null;
  tier: string | null;
  currentStage: number | null;
  city: string | null;
  country: string | null;
}

export interface PersonRecord {
  /** Null when the reference leads to no account — a listing with nobody behind it. */
  account: PersonAccount | null;
  onboarding: PersonOnboarding | null;
  application: PersonApplication | null;
  projects: PersonProject[];
}

const s  = (v: unknown) => (typeof v === 'string' ? v : '');
const sn = (v: unknown) => (typeof v === 'string' && v ? v : null);
const n  = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The person behind a reference.
 *
 * `rolesHint` is the comma-joined roles the opening row already holds (AdminUser.roles).
 * Passing it saves the RPC round trip; without it the roles are looked up.
 */
export async function fetchPersonRecord(
  ref: PersonRef,
  rolesHint?: string | null,
): Promise<PersonRecord> {
  let userId = ref.userId ?? null;
  let email  = ref.email ?? null;

  // 1. An application, if the reference names one — and it may be the only thing that
  //    links a directory listing to a person.
  let appRow: Record<string, unknown> | null = null;
  if (ref.applicationId) {
    const { data } = await supabase
      .from('contractor_applications').select('*').eq('id', ref.applicationId).maybeSingle();
    appRow = (data as Record<string, unknown> | null) ?? null;
    userId ??= sn(appRow?.user_id);
    email  ??= sn(appRow?.email);
  }

  // 2. The account. By id when there is one; by email when that is all we have — the
  //    same case-insensitive match the invitation senders use.
  let profile: Record<string, unknown> | null = null;
  if (userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    profile = (data as Record<string, unknown> | null) ?? null;
  } else if (email) {
    const { data } = await supabase.from('profiles').select('*').ilike('email', email).limit(1);
    profile = ((data as Record<string, unknown>[] | null) ?? [])[0] ?? null;
  }
  if (profile) {
    userId = s(profile.id);
    email  = sn(profile.email) ?? email;
  }

  // 3. Everything keyed on the account, in parallel. The application is looked up again
  //    here by user id or email when step 1 did not already have it: a contractor who
  //    applied first and signed up later has both, joined by nothing but the address.
  const [onb, contacts, docs, appByPerson, projects, roles] = await Promise.all([
    userId
      ? supabase.from('contractor_onboarding').select('*').eq('user_id', userId).maybeSingle()
      : Promise.resolve({ data: null }),
    userId
      ? supabase.from('contractor_emergency_contacts')
          .select('full_name, relationship, phone').eq('user_id', userId).order('position')
      : Promise.resolve({ data: [] }),
    userId
      ? supabase.from('contractor_documents').select('kind, filename').eq('user_id', userId)
      : Promise.resolve({ data: [] }),
    appRow
      ? Promise.resolve({ data: [appRow] })
      : userId || email
        ? supabase.from('contractor_applications').select('*')
            .or([userId ? `user_id.eq.${userId}` : null, email ? `email.ilike.${email}` : null]
              .filter(Boolean).join(','))
            .order('created_at', { ascending: false }).limit(1)
        : Promise.resolve({ data: [] }),
    userId
      ? supabase.from('projects')
          .select('id, name, status, tier, current_stage, city, country')
          .eq('user_id', userId).neq('status', 'archived').order('updated_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    rolesHint != null || !userId
      ? Promise.resolve(rolesHint ?? '')
      : listAdminUsers().then(all => all.find(u => u.id === userId)?.roles ?? '').catch(() => ''),
  ]);

  const app = ((appByPerson.data as Record<string, unknown>[] | null) ?? [])[0] ?? null;
  const o = (onb.data as Record<string, unknown> | null) ?? null;

  const account: PersonAccount | null = profile ? {
    id: s(profile.id),
    email: s(profile.email),
    fullName: sn(profile.full_name),
    phone: sn(profile.phone),
    signupCountry: sn(profile.signup_country) ?? sn(profile.country),
    preferredLang: profile.preferred_lang === 'fr' ? 'fr' : profile.preferred_lang === 'en' ? 'en' : null,
    roles: roles.split(',').map(r => r.trim()).filter(Boolean),
    tier: sn(profile.subscription_tier),
    createdAt: s(profile.created_at),
    lastSignInAt: null,
    mustChangePassword: profile.must_change_password === true,
    provisionedBy: sn(profile.provisioned_by),
    ghlContactId: sn(profile.ghl_contact_id),
    syncedToCrm: profile.synced_to_ghl === true,
  } : null;

  const onboarding: PersonOnboarding | null = o ? {
    dateOfBirth: sn(o.date_of_birth),
    address: sn(o.residential_address),
    licenseNumber: sn(o.license_number),
    specialty: sn(o.specialty),
    specialtyOther: sn(o.specialty_other),
    businessStatus: sn(o.business_status),
    businessName: sn(o.business_name),
    businessRegNumber: sn(o.business_reg_number),
    clientIntent: sn(o.client_intent),
    partnerInterest: sn(o.partner_interest),
    emergencyContacts: ((contacts.data as Record<string, unknown>[] | null) ?? []).map(c => ({
      fullName: s(c.full_name), relationship: sn(c.relationship), phone: sn(c.phone),
    })),
    documents: ((docs.data as Record<string, unknown>[] | null) ?? []).map(d => ({
      kind: s(d.kind), filename: s(d.filename),
    })),
  } : null;

  const application: PersonApplication | null = app ? {
    id: s(app.id),
    status: s(app.status),
    role: sn(app.role),
    roleOther: sn(app.role_other),
    yearsExperience: n(app.years_experience),
    operatesAs: sn(app.operates_as),
    businessName: sn(app.business_name),
    city: sn(app.city),
    country: sn(app.country),
    phone: sn(app.phone),
    email: s(app.email),
    teamSize: sn(app.team_size),
    regions: Array.isArray(app.regions) ? (app.regions as unknown[]).map(String).join(', ') : sn(app.regions),
    createdAt: s(app.created_at),
  } : null;

  return {
    account,
    onboarding,
    application,
    projects: ((projects.data as Record<string, unknown>[] | null) ?? []).map(p => ({
      id: s(p.id), name: s(p.name), status: sn(p.status), tier: sn(p.tier),
      currentStage: n(p.current_stage), city: sn(p.city), country: sn(p.country),
    })),
  };
}

/**
 * The `?person=` value for a reference, and back.
 *
 * A user id goes in plain; an application id is prefixed. An email is never put in the
 * URL — it is personal data in a place that gets copied into chats and logs — so a
 * reference that is only an email opens the panel without a deep link.
 */
export function personParam(ref: PersonRef): string | null {
  if (ref.userId) return ref.userId;
  if (ref.applicationId) return `app:${ref.applicationId}`;
  return null;
}

export function parsePersonParam(value: string | null | undefined): PersonRef | null {
  if (!value) return null;
  if (value.startsWith('app:')) return value.length > 4 ? { applicationId: value.slice(4) } : null;
  return { userId: value };
}
