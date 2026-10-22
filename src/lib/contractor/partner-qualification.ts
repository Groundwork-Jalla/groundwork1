/**
 * What ends a partner application, and at which question.
 *
 * ── Why this is a hard stop and not a score ─────────────────────────────────────────
 * Until now a disqualifying answer only withheld the calendar: the applicant finished
 * all ten questions, submitted, and waited for a reply that was never coming. Philip's
 * instruction is that the application is discontinued at the question that ends it —
 * "if a question that they answer disqualifies them then they should not see the
 * remaining steps."
 *
 * That is kinder as well as cheaper. Ten questions answered by somebody who was out at
 * question four is ten questions of their evening, and a row in Ruth's queue that looks
 * like a lead.
 *
 * ── The rules are Philip's, and each has a reason ───────────────────────────────────
 * THREE rules, and only three. The form document is explicit that years of experience
 * is NOT one of them: "This question is not a disqualifying question. It simply
 * establishes who we give preference to when ranking them in the contractor directory."
 * That reverses the 22 October decision that under five years could not book a call, so
 * the five-year band now ranks an applicant rather than removing them.
 *
 * no_project            Groundwork manages a build. Without one there is nothing to
 *                       manage, so there is no partnership to discuss yet.
 * client_on_site_daily  This is the one that is counter-intuitive, so it is written
 *                       down: a client who CAN be on site every day does not need us.
 *                       Groundwork exists for the client who cannot stand on the slab —
 *                       and that is not only the diaspora. Somebody in the same country
 *                       and a different region qualifies just as well. Answering "yes"
 *                       describes a project that would be supervised in person.
 * not_using_groundwork  A partner who will not run the project here is not a partner.
 *
 * Kept pure and in one place so the order is testable and the form, the admin screen
 * and any future public version cannot disagree about who is out.
 */

/** Three answers, not a yes/no: "about to start" is a real and different situation. */
export type ProjectStatus = 'running' | 'starting' | 'none';

/**
 * Whether the build will actually be run here.
 *
 * "Maybe, I need to understand the system better" is not a refusal — it is somebody
 * asking for the demo, which is what the call is for. Only an outright no ends it.
 */
export type GroundworkUse = 'yes' | 'maybe' | 'no';

export type Disqualifier =
  | 'no_project'
  | 'client_on_site_daily'
  | 'not_using_groundwork';

export interface QualificationAnswers {
  yearsExperience?: string | null;
  projectStatus?: ProjectStatus | null;
  /** True when the client can be on site every day — which is what rules them out. */
  clientOnSiteDaily?: boolean | null;
  willUseGroundwork?: GroundworkUse | null;
}

/**
 * Five years or more on the tools.
 *
 * No longer a gate — the form document is explicit that experience does not disqualify.
 * It RANKS: it decides who is shown first in the contractor directory, and who Philip
 * sees first in a queue. Kept exported because 147 and the funnel board both read it.
 */
export const QUALIFYING_YEARS: readonly string[] = ['5-10', '10+', 'y5_10', 'y10'];

/**
 * The first rule this applicant fails, in the order the form asks them.
 *
 * Order matters: the applicant is stopped at the question that ended it, so the reason
 * they are shown is the one they just answered rather than whichever rule happens to be
 * checked first. An answer not yet given never disqualifies — that is the difference
 * between "they said no" and "they have not reached that question".
 */
export function disqualifiedBy(a: QualificationAnswers): Disqualifier | null {
  if (a.projectStatus === 'none') return 'no_project';
  if (a.clientOnSiteDaily === true) return 'client_on_site_daily';
  if (a.willUseGroundwork === 'no') return 'not_using_groundwork';
  return null;
}

/** Experience ranks rather than gates: who goes to the top of the directory. */
export function ranksHighly(yearsExperience?: string | null): boolean {
  return yearsExperience != null && QUALIFYING_YEARS.includes(yearsExperience);
}

/** Shorthand for the form: is this applicant still in it? */
export function stillQualifying(a: QualificationAnswers): boolean {
  return disqualifiedBy(a) === null;
}

/**
 * Everything answered, and nothing disqualifying.
 *
 * Replaces `isDecisionReady`'s two-condition test. A qualified applicant is offered the
 * calendar; nobody else reaches the end of the form at all.
 */
export function qualifiesForCall(a: QualificationAnswers): boolean {
  return a.projectStatus != null
      && a.clientOnSiteDaily != null
      && a.willUseGroundwork != null
      && disqualifiedBy(a) === null;
}
