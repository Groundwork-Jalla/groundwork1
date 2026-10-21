import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { funnelStages, type PartnerFunnel } from './partner-funnel';

/**
 * The funnel's own numbers, and the constraint that silently broke step 4.
 *
 * An end-to-end walk of the real funnel got as far as the partner application, filled it
 * in, pressed send and was refused by Postgres. Nothing in the UI was wrong; the rule
 * underneath it had been written for the opposite order of events.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const m136 = read('supabase/migrations/136_partner_funnel_counts.sql');
const m137 = read('supabase/migrations/137_in_app_application_is_linked_from_birth.sql');
const strip = (s: string) => s.replace(/--.*$/gm, '');

describe('an in-app application is linked from birth', () => {
  it('137 replaces the claim-shape constraint rather than adding a second one', () => {
    // Two CHECKs on the same table are ANDed, so adding one beside 100's would have
    // changed nothing: the old equality would still refuse the row.
    expect(strip(m137)).toMatch(/DROP CONSTRAINT IF EXISTS contractor_application_claim_shape/);
    expect(strip(m137)).toMatch(/ADD\s+CONSTRAINT contractor_application_claim_shape/);
  });

  it('in_app requires a user and forbids a claim', () => {
    const sql = strip(m137);
    expect(sql).toMatch(/WHEN 'in_app' THEN user_id IS NOT NULL AND claimed_at IS NULL/);
  });

  it("and the public form keeps 100's original rule exactly", () => {
    // The regression risk runs the other way too: loosening this would let a public
    // application be linked to an account nobody ever claimed.
    expect(strip(m137)).toMatch(/ELSE \(claimed_at IS NULL\) = \(user_id IS NULL\)/);
  });

  it('the client does not fake a claim to get around it', () => {
    // Setting claimed_at from the browser would satisfy the old constraint and record
    // something that never happened — the account came first, nothing was claimed.
    const lib = read('src/lib/supabase/partner-application.ts');
    const insert = lib.slice(lib.indexOf('submitPartnerApplication'));
    expect(insert).not.toMatch(/claimed_at/);
  });
});

describe('the funnel counts what it says it counts', () => {
  it('reuses 116/118 for "onboarded" instead of restating the rule', () => {
    // 118 removed documents from `complete`. A hand-written conjunction here would
    // almost certainly have included it and reported zero onboarded contractors.
    expect(strip(m136)).toMatch(/contractor_onboarding_status\(r\.user_id\) ->> 'complete'/);
    expect(strip(m136)).not.toMatch(/v_documents/);
  });

  it('counts accounts by the role, not by project assignment', () => {
    // `holds_contractor_access` also counts somebody invited onto one project by a
    // client, who never came through outreach at all.
    expect(strip(m136)).toMatch(/FROM public\.user_roles WHERE role = 'contractor'/);
    expect(strip(m136)).not.toMatch(/holds_contractor_access/);
  });

  it('counts only in-app applications, so the retired public form cannot inflate it', () => {
    expect(strip(m136)).toMatch(/WHERE source = 'in_app'/);
  });

  it('is staff only', () => {
    expect(strip(m136)).toMatch(/IF NOT public\.is_admin\(\) THEN[\s\S]{0,80}not_allowed/);
  });

  it('reports reaching the booking step, never a confirmed booking', () => {
    // Philip's calendar holds the real figure and the widget is a cross-origin iframe.
    expect(strip(m136)).toMatch(/booking_shown_at/);
    expect(strip(m136)).toMatch(/'sent_to_booking'/);
    expect(strip(m136)).not.toMatch(/calls_booked|bookings_confirmed/);
  });

  it('and the first visit to the booking step is the one recorded', () => {
    // A revisit must not refresh the timestamp, or the follow-up list looks newer than
    // it is and nobody gets chased.
    expect(strip(m136)).toMatch(/AND booking_shown_at IS NULL/);
  });
});

describe('the drop at each stage', () => {
  const f: PartnerFunnel = {
    accounts: 40, onboarded: 25, partnerInterested: 18,
    applications: 12, prequalified: 5, sentToBooking: 4,
  };

  it('is the loss from the stage before it', () => {
    const s = funnelStages(f);
    expect(s.map(x => x.key)).toEqual(
      ['accounts', 'onboarded', 'applications', 'prequalified', 'sentToBooking']);
    expect(s.map(x => x.dropFromPrevious)).toEqual([0, 15, 13, 7, 1]);
  });

  it('and the first stage has lost nothing, having nothing before it', () => {
    expect(funnelStages(f)[0].dropFromPrevious).toBe(0);
  });

  it('never reports a negative drop', () => {
    // Counts come from separate queries at slightly different moments, and a stage can
    // briefly read higher than the one above it. A negative "drop" would be nonsense.
    const odd = { ...f, applications: 99 };
    expect(funnelStages(odd).every(s => s.dropFromPrevious >= 0)).toBe(true);
  });

  it('leaves the partner answer out of the stage list', () => {
    // Saying no to partnering is a legitimate outcome, not a loss: they are a contractor
    // using Groundwork. Counting it as drop-off would make the funnel look leakier.
    expect(funnelStages(f).some(s => s.key === 'partnerInterested')).toBe(false);
  });
});
