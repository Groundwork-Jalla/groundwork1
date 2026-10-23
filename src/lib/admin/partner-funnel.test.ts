import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isDecisionReady } from '@/lib/supabase/partner-application';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Step four of the partner funnel has a door.
 *
 * The new sequence is outreach → contractor signup → onboarding → PARTNER APPLICATION →
 * pre-qualification → one call → client introduction → activation. The application
 * existed only at `/contractor-apply`, the public marketing page, so a professional who
 * had signed up and onboarded could not apply at all — which is where three of four
 * qualified professionals were sitting.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const m133 = read('supabase/migrations/133_partner_application.sql');
const sql  = m133.replace(/--.*$/gm, '');
const lib  = read('src/lib/supabase/partner-application.ts');
const page = read('src/app/routes/work/partner.tsx');

describe('the qualification rule is one rule, in one place', () => {
  it('a live project AND a willingness to introduce it', () => {
    // Philip's calendar is the constraint: 18 calls produced 4 qualified professionals.
    // These two answers are what that decision actually turns on.
    expect(isDecisionReady({ hasCurrentProject: true,  willIntroduce: true  })).toBe(true);
    expect(isDecisionReady({ hasCurrentProject: true,  willIntroduce: false })).toBe(false);
    expect(isDecisionReady({ hasCurrentProject: false, willIntroduce: true  })).toBe(false);
    expect(isDecisionReady({ hasCurrentProject: false, willIntroduce: false })).toBe(false);
  });

  it('and somebody who is not ready is told they are still welcome', () => {
    // Not silently de-prioritised: a contractor without a project today may have one
    // next month, and the funnel should still be open to them then. It is now said on
    // the page the application ends on, rather than beside a form they go on filling in.
    // The key is built from the rule that fired, so the page carries the prefix.
    expect(page).toMatch(/partner\.stopped\.\$\{stopped\}/);
    expect((en as any).partner.stopped.no_project).toMatch(/apply again/i);
  });
});

describe('it asks only what Groundwork does not already hold', () => {
  it('name, email, phone and country are shown, not asked', () => {
    // Asking again is the friction the new funnel exists to remove.
    expect(lib).toMatch(/loadPartnerPrefill/);
    expect(page).toMatch(/prefill\.fullName/);
    expect(page).toMatch(/partner\.onFile/);
  });

  it('and the commitments accepted at onboarding are not re-asked', () => {
    // They are in the partner agreement signed during onboarding (117); asking twice
    // would imply the first time did not count.
    expect(lib).toMatch(/accepts_milestones: true/);
    expect(lib).toMatch(/Already accepted in the partner agreement at onboarding/);
  });
});

describe('the four new columns, and nothing that breaks the old form', () => {
  it('they exist', () => {
    for (const c of ['diaspora_history', 'languages', 'has_current_project', 'will_introduce', 'source']) {
      expect(sql, c).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\b`));
    }
  });

  it('every one is optional, so the public form keeps working untouched', () => {
    // Verified on a scratch cluster: a public insert with none of them succeeds and
    // reads as source = 'public'.
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS diaspora_history\s+TEXT,/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS has_current_project BOOLEAN,/);
    expect(sql).toMatch(/source\s+TEXT NOT NULL DEFAULT 'public'/);
  });

  it('language is recorded because it routes the call', () => {
    expect(m133).toMatch(/French-speaking professional reaches\s*\n--\s*Vanessa/);
  });
});

describe('one application per person, filed as themselves', () => {
  it('a signed-in user cannot file under another id', () => {
    expect(sql).toMatch(/AND user_id = auth\.uid\(\)/);
  });

  it('and cannot file twice into the review queue', () => {
    // A second live application is a duplicate in Ruth's queue, not a second chance.
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS contractor_applications_one_open_per_user/);
  });

  it('but a rejected one does not lock them out for ever', () => {
    expect(sql).toMatch(/status IN \('pending', 'reviewing', 'accepted'\)/);
  });

  it('and the statuses match 026\'s own CHECK', () => {
    // 'qualified' is not one of them; guessing a status would make the index inert.
    expect(read('supabase/migrations/026_contractor_applications.sql'))
      .toMatch(/CHECK \(status IN \('pending','disqualified','reviewing','accepted','rejected'\)\)/);
  });
});

describe('there are two ways in, and neither disturbs the onboarding gate', () => {
  it('a permanent sidebar entry', () => {
    expect(read('src/components/shell/WorkShell.tsx')).toMatch(/to: '\/work\/partner'/);
  });

  it('and a dashboard card, only for somebody who has not applied', () => {
    expect(read('src/app/routes/work/index.tsx')).toMatch(/partnerState === 'none' && \(/);
  });

  it('and a third: the decision is asked inside onboarding itself', () => {
    /**
     * This test used to assert the opposite — that onboarding stayed untouched — on the
     * reasoning that the two-choice gate (Philip, 15 Oct) should not be weakened. He
     * then ruled the other way: "onboarding is not complete unless they are able to
     * decide whether they want to be certified partners" (21 Oct). So the question is
     * asked where everybody passes.
     */
    const onboarding = read('src/app/routes/work/onboarding.tsx');
    expect(onboarding).toMatch(/contractorOnboarding\.partnerQ/);
    // Having a client is a condition of applying, so somebody without one now goes to
    // the dashboard — they used to be sent to a form they could not qualify on.
    expect(onboarding).toMatch(/window\.location\.href = !partner \|\| intent === 'no_client'/);
  });

  it('but the client-intent answer is still what unlocks the sidebar', () => {
    // Routing around it would leave somebody locked out of the app they just joined.
    const onboarding = read('src/app/routes/work/onboarding.tsx');
    expect(onboarding).toMatch(/await setClientIntent\(intent\)/);
    // Neither question can be skipped: the client buttons wait for the partner answer.
    expect(onboarding).toMatch(/disabled=\{busy !== null \|\| partner === null\}/);
  });

  it('and the answer is recorded even when it is no', () => {
    // Somebody who says yes and abandons the form is a funnel leak Ruth cannot chase
    // unless it was written down.
    expect(read('src/app/routes/work/onboarding.tsx')).toMatch(/await setPartnerInterest\(partner\)/);
    expect(m133).toMatch(/ADD COLUMN IF NOT EXISTS partner_interest\b/);
  });

  it('and the route exists', () => {
    expect(read('src/app/routes.ts')).toMatch(/route\("work\/partner",\s+"routes\/work\/partner\.tsx"\)/);
  });
});

describe('every string is in both languages', () => {
  it.each(['title', 'sub', 'languages', 'hasProject', 'willIntroduce', 'notReadyNote',
           'submit', 'navLabel', 'inviteTitle', 'inviteCta'])('%s', (k) => {
    for (const d of [en, fr]) {
      expect(typeof (d as any).partner[k], k).toBe('string');
      expect((d as any).partner[k].length).toBeGreaterThan(0);
    }
  });

  it('and French is translated, not copied', () => {
    expect((fr as any).partner.submit).toBe('Envoyer la candidature');
  });
});

describe('two calendars, and Vanessa co-hosts the French one', () => {
  const booking = read('src/lib/supabase/partner-booking.ts');

  it('language chooses the schedule, and Philip is on both', () => {
    /**
     * Philip's decision, replacing the single-calendar arrangement this used to pin.
     * A Google co-host sits on the SCHEDULE, not on a booking, so "Vanessa for French
     * speakers" cannot be expressed on one calendar — she would join every call or
     * none. The French schedule is Philip's with Vanessa added, not Vanessa's, so the
     * original worry (taking Philip out of a partnership decision) does not apply.
     */
    expect(booking).toMatch(/booking_schedule_philip/);
    expect(booking).toMatch(/booking_schedule_fr/);
    expect(booking).not.toMatch(/booking_schedule_vanessa/);
  });

  it('a French applicant has Vanessa asked to join that same call', () => {
    expect(booking).toMatch(/preferredLanguage === 'fr'/);
    expect(page).toMatch(/if \(needsVanessa\(callLang\)\)/);
    expect(page).toMatch(/Vanessa should join/);
  });

  it('and telling her never costs the application', () => {
    // Sent after the application is saved, and swallowed on failure.
    const fn = page.slice(page.indexOf('async function submit'));
    expect(fn.indexOf('submitPartnerApplication')).toBeLessThan(fn.indexOf('needsVanessa'));
    expect(page).toMatch(/\)\.catch\(\(\) => \{\}\);/);
  });

  it('one question with one answer, so nothing is guessed', () => {
    // A multi-select left "both" to be interpreted, and a guess here is exactly the
    // blindness this is meant to remove.
    expect(page).toMatch(/setCallLang\(l\)/);
    expect(page).not.toMatch(/setLanguages\(/);
  });

  it('the embeddable URL form is built, not the shared one', () => {
    /**
     * Philip's link resolves to `/appointments/schedules/…`, which answers
     * X-Frame-Options: SAMEORIGIN and cannot be framed at all. The embeddable variant
     * adds the `/calendar` prefix and `?gv=true`; the two differ by one path segment
     * and one query parameter, and only one of them works.
     */
    expect(booking).toMatch(/calendar\.google\.com\/calendar\/appointments\/schedules\/\$\{scheduleId\}\?gv=true/);
  });

  it('only a decision-ready applicant is offered a slot', () => {
    // Philip's calendar is the constraint. A call is booked by somebody with a live
    // project they will introduce, and nobody else — on BOTH paths to the calendar:
    // the submit that just qualified them, and the reload that finds them already in
    // the queue. The second path is the one that did not exist: an applicant who closed
    // the tab before booking saw their status card with no calendar under it.
    expect(page).toMatch(/if \(ready\) await openBooking\(callLang\)/);
    expect(page).toMatch(/if \(inQueue && summary\.decisionReady\) void openBooking\(summary\.language\)/);
  });

  it('and reaching the booking step is recorded, but never as a confirmed booking', () => {
    // The widget is a cross-origin Google iframe, so a click inside it is invisible to
    // us. Marking only when a real URL came back keeps the counter honest: an
    // unconfigured schedule is a step we failed to offer, not one they reached.
    expect(page).toMatch(/if \(url\) void markBookingShown\(\)/);
    const funnel = read('src/lib/admin/partner-funnel.ts');
    expect(funnel).toMatch(/NOT confirmed bookings/);
  });

  it('and an unconfigured schedule says so rather than showing an empty frame', () => {
    expect(page).toMatch(/partner\.bookUnavailable/);
    expect(booking).toMatch(/return null/);
  });
});

describe('the settings the browser may read are a closed list', () => {
  const m134 = read('supabase/migrations/134_public_settings.sql');

  it('only the one booking schedule', () => {
    // app_config also holds the Resend key and the fan-out secret, and this function is
    // callable by any signed-in user. The key test is the whole protection.
    expect(m134).toMatch(/AND key = 'booking_schedule_philip';/);
  });

  it('and it is not readable by anon', () => {
    expect(m134).toMatch(/REVOKE ALL ON FUNCTION public\.public_setting\(text\) FROM PUBLIC;/);
    expect(m134).toMatch(/GRANT EXECUTE ON FUNCTION public\.public_setting\(text\) TO authenticated;/);
  });
});

describe('Vanessa is emailed when the call will need her', () => {
  const m135 = read('supabase/migrations/135_french_applicant_email.sql');
  const sql  = m135.replace(/--.*$/gm, '');

  it('only for a French applicant', () => {
    expect(sql).toMatch(/IF NOT \('fr' = ANY\(COALESCE\(NEW\.languages, '\{\}'\)\)\) THEN RETURN NEW; END IF;/);
  });

  it('to an address that can change without a deploy', () => {
    expect(sql).toMatch(/key = 'partner_fr_notify_email'/);
  });

  it('and it says whether a call is actually coming', () => {
    /**
     * There is no booking webhook — the slot is picked inside Google's iframe and
     * nothing comes back — so this fires on the APPLICATION. Saying "they are booking
     * now" only when they are decision-ready keeps it honest about what it knows.
     */
    expect(sql).toMatch(/booking a call with Philip now/);
    expect(sql).toMatch(/no call is being booked/);
    expect(sql).toMatch(/ready := COALESCE\(NEW\.has_current_project, false\) AND COALESCE\(NEW\.will_introduce, false\)/);
  });

  it('an unconfigured address is silence, not a failure', () => {
    // Nobody should be unable to apply because a notification address is unset.
    expect(sql).toMatch(/IF to_email IS NULL OR to_email = '' OR resend_key IS NULL OR resend_key = ''/);
  });

  it('and a dead mail server never costs the application', () => {
    // An AFTER trigger that raises still aborts the statement.
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN/);
    expect(m135).toMatch(/losing somebody's application to a mail server is indefensible/);
  });

  it('it is honest in the migration about what Google will not let us do', () => {
    // Nobody should later try to "fix" this by CCing Google's own booking mail.
    expect(m135).toMatch(/cannot add a recipient to it/);
  });
});
