import { supabase } from './client';

/**
 * The partner application, for somebody already inside Groundwork.
 *
 * ── Why it is short ─────────────────────────────────────────────────────────────────
 * The public form at `/contractor-apply` asks a stranger everything, because it knows
 * nothing about them. By the time a contractor reaches this one they have signed up and
 * finished onboarding, so Groundwork already holds their name, email, phone, country,
 * business name, registration number and licence.
 *
 * Asking for all of it again is the friction the new funnel exists to remove: four
 * professionals qualified and one completed onboarding, and the gap was how much we
 * demanded before showing any value. So this asks only what we cannot already answer.
 */

export interface PartnerPrefill {
  fullName: string;
  email: string;
  phone: string;
  country: string;
  businessName: string | null;
  /** What they do, from onboarding (142). The application no longer asks. */
  specialty: string | null;
  specialtyOther: string | null;
}

/** Everything we already know, so the form can show it rather than ask for it. */
export async function loadPartnerPrefill(userId: string): Promise<PartnerPrefill | null> {
  const [{ data: profile }, { data: onboarding }] = await Promise.all([
    supabase.from('profiles').select('full_name, email, phone, country').eq('id', userId).maybeSingle(),
    // 116. Absent for somebody who has not onboarded — not an error, just nothing to add.
    supabase.from('contractor_onboarding')
      .select('business_name, specialty, specialty_other').eq('user_id', userId).maybeSingle(),
  ]);
  if (!profile) return null;
  const p = profile as Record<string, unknown>;
  return {
    fullName: String(p.full_name ?? ''),
    email: String(p.email ?? ''),
    phone: String(p.phone ?? ''),
    country: String(p.country ?? ''),
    businessName: (onboarding as Record<string, unknown> | null)?.business_name as string ?? null,
    // Collected at onboarding (142), so the application shows it back rather than
    // asking a second time.
    specialty: (onboarding as Record<string, unknown> | null)?.specialty as string ?? null,
    specialtyOther: (onboarding as Record<string, unknown> | null)?.specialty_other as string ?? null,
  };
}

export type ApplicationState = 'none' | 'pending' | 'reviewing' | 'accepted' | 'rejected' | 'disqualified';

/**
 * Where this person stands. `none` means they may apply.
 *
 * Read through RLS (133): a contractor sees their own, an admin sees all. A rejected or
 * withdrawn application does not block a fresh one — the unique index only holds the
 * live states — so somebody turned down before can come back with a project.
 */
export async function myApplicationState(userId: string): Promise<ApplicationState> {
  const { data, error } = await supabase
    .from('contractor_applications')
    .select('status').eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return 'none';
  const s = String((data as Record<string, unknown>).status ?? '');
  const known: readonly string[] = ['pending', 'reviewing', 'accepted', 'rejected', 'disqualified'];
  // An unrecognised status reads as 'none' rather than throwing: a value added to 026's
  // CHECK later must not leave a contractor staring at a broken page.
  return known.includes(s) ? (s as ApplicationState) : 'none';
}

/**
 * Their application's status AND whether it qualified, in one read.
 *
 * Needed because the booking frame used to be set only by the submit handler: somebody
 * who applied, closed the tab and came back saw their "we have your application" card
 * with no calendar under it, and had no way back to one. That is the last stage of the
 * funnel, so the drop-out was the expensive kind.
 *
 * The readiness answer is recomputed from the stored columns through `isDecisionReady`
 * rather than stored as a verdict, so staff and applicant can never be looking at two
 * different rules.
 */
export async function myApplicationSummary(
  userId: string,
): Promise<{ state: ApplicationState; decisionReady: boolean }> {
  const { data, error } = await supabase
    .from('contractor_applications')
    .select('status, has_current_project, will_introduce, years_experience').eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return { state: 'none', decisionReady: false };

  const r = data as Record<string, unknown>;
  const s = String(r.status ?? '');
  const known: readonly string[] = ['pending', 'reviewing', 'accepted', 'rejected', 'disqualified'];
  return {
    state: known.includes(s) ? (s as ApplicationState) : 'none',
    decisionReady: isDecisionReady({
      hasCurrentProject: r.has_current_project === true,
      willIntroduce:     r.will_introduce === true,
      yearsExperience:   typeof r.years_experience === 'string' ? r.years_experience : undefined,
    }),
  };
}

export interface PartnerAnswers {
  /** Which languages they WORK IN. Routes the qualification call. */
  languages: string[];
  diasporaHistory: string;
  hasCurrentProject: boolean;
  willIntroduce: boolean;
  whyJoin: string;
  differentiator: string;
  regions: string;
  concurrentProjects: string;
  yearsExperience: string;
  role: string;
  operatesAs: string;
  city: string;
}

/**
 * File it.
 *
 * The three commitment flags that 026 requires of every applicant are set here rather
 * than asked again: a contractor reaching this point has already accepted the partner
 * agreement during onboarding (116/117), which contains all three. Asking a second time
 * would imply the first did not count.
 */
/**
 * File the application, and return its id.
 *
 * The id is what closes their draft in `contractor_application_drafts` (138), so a
 * partner who finished stops appearing on the follow-up list. Reading the row back is
 * safe here, unlike the anonymous writes in application-drafts.ts: `self_read_application`
 * (133) lets an applicant see their own row.
 */
export async function submitPartnerApplication(
  userId: string, prefill: PartnerPrefill, a: PartnerAnswers,
): Promise<string | null> {
  const { data, error } = await supabase.from('contractor_applications').insert({
    source: 'in_app',
    user_id: userId,
    full_name: prefill.fullName,
    email: prefill.email,
    phone: prefill.phone,
    country: prefill.country,
    city: a.city,
    business_name: prefill.businessName,
    role: a.role,
    years_experience: a.yearsExperience,
    operates_as: a.operatesAs,
    languages: a.languages,
    diaspora_history: a.diasporaHistory,
    has_current_project: a.hasCurrentProject,
    will_introduce: a.willIntroduce,
    why_join: a.whyJoin,
    differentiator: a.differentiator,
    regions: a.regions,
    concurrent_projects: a.concurrentProjects,
    // Already accepted in the partner agreement at onboarding (117).
    accepts_milestones: true,
    accepts_verification: true,
    accepts_no_side_pay: true,
    agreed_to_terms: true,
    ready_for_early: true,
  }).select('id').single();
  if (error) throw error;
  return (data as { id?: string } | null)?.id ?? null;
}

/**
 * Is this applicant worth a place on the calendar?
 *
 * Philip's calendar is the constraint: 18 calls produced 4 qualified professionals, so
 * most of them were spent deciding whether somebody belonged rather than closing one who
 * did. These two answers are what that decision actually turns on — a live diaspora
 * project, and a willingness to bring it. Pure, so the rule is in one place and testable.
 */
export function isDecisionReady(
  a: Pick<PartnerAnswers, 'hasCurrentProject' | 'willIntroduce'> & { yearsExperience?: string },
): boolean {
  // Three conditions, all of them Philip's: a live diaspora project, a willingness to
  // introduce it, and five years on the tools. His calendar is the constraint — 18 calls
  // produced 4 qualified professionals — so somebody who cannot meet these is not
  // offered a slot at all rather than being given one and turned away on it.
  //
  // `yearsExperience` is optional so the older two-answer callers keep working; when it
  // is absent the experience condition is simply not applied.
  const experienced = a.yearsExperience === undefined || QUALIFYING_YEARS.includes(a.yearsExperience);
  return a.hasCurrentProject === true && a.willIntroduce === true && experienced;
}

/**
 * The experience bands that clear five years.
 *
 * '3-5' does NOT qualify: somebody in that band may have three. "At least five years"
 * is read strictly, because the whole purpose of the gate is that a call is worth
 * Philip's hour.
 */
export const QUALIFYING_YEARS: readonly string[] = ['5-10', '10+'];

/**
 * Record the partner decision taken at the end of onboarding.
 *
 * Kept even when the answer is no, and kept BEFORE the form is filled: somebody who
 * says yes and then abandons the application is a funnel leak, and Ruth cannot chase
 * what was never written down. 133 stores it on `contractor_onboarding` beside the
 * client-intent answer it sits next to.
 *
 * Never fatal. A contractor who has just finished onboarding must reach the app even if
 * this write fails — losing the answer costs a follow-up, losing the sign-in costs them.
 */
export async function setPartnerInterest(interest: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_partner_interest', { p_interest: interest });
  if (error) console.warn('[partner] could not record the interest answer:', error.message);
}
