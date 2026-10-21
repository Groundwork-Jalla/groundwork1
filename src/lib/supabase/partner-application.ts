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
}

/** Everything we already know, so the form can show it rather than ask for it. */
export async function loadPartnerPrefill(userId: string): Promise<PartnerPrefill | null> {
  const [{ data: profile }, { data: onboarding }] = await Promise.all([
    supabase.from('profiles').select('full_name, email, phone, country').eq('id', userId).maybeSingle(),
    // 116. Absent for somebody who has not onboarded — not an error, just nothing to add.
    supabase.from('contractor_onboarding').select('business_name').eq('user_id', userId).maybeSingle(),
  ]);
  if (!profile) return null;
  const p = profile as Record<string, unknown>;
  return {
    fullName: String(p.full_name ?? ''),
    email: String(p.email ?? ''),
    phone: String(p.phone ?? ''),
    country: String(p.country ?? ''),
    businessName: (onboarding as Record<string, unknown> | null)?.business_name as string ?? null,
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
export async function submitPartnerApplication(
  userId: string, prefill: PartnerPrefill, a: PartnerAnswers,
): Promise<void> {
  const { error } = await supabase.from('contractor_applications').insert({
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
  });
  if (error) throw error;
}

/**
 * Is this applicant worth a place on the calendar?
 *
 * Philip's calendar is the constraint: 18 calls produced 4 qualified professionals, so
 * most of them were spent deciding whether somebody belonged rather than closing one who
 * did. These two answers are what that decision actually turns on — a live diaspora
 * project, and a willingness to bring it. Pure, so the rule is in one place and testable.
 */
export function isDecisionReady(a: Pick<PartnerAnswers, 'hasCurrentProject' | 'willIntroduce'>): boolean {
  return a.hasCurrentProject && a.willIntroduce;
}

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
