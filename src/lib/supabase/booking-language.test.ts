import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scheduleKeyFor, needsVanessa, embedUrl, SCHEDULE_KEY } from './partner-booking';

/**
 * Two schedules, one per language.
 *
 *   English — Philip alone
 *   French  — Philip, with Vanessa as co-host
 *
 * This is the shape Google forces: a co-host sits on the SCHEDULE, not on a booking, so
 * "Vanessa for French speakers" cannot be said on one calendar — she would join every
 * call or none.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('which calendar a language books into', () => {
  it('French goes to the French schedule', () => {
    expect(scheduleKeyFor('fr')).toBe(SCHEDULE_KEY.fr);
  });

  it('everything else goes to the English one', () => {
    for (const l of ['en', '', 'es', 'EN']) expect(scheduleKeyFor(l)).toBe(SCHEDULE_KEY.en);
  });

  it('and the same answer decides whether Vanessa is told', () => {
    // One question, one answer — the two must not disagree about who the call needs.
    expect(needsVanessa('fr')).toBe(true);
    expect(scheduleKeyFor('fr')).toBe(SCHEDULE_KEY.fr);
    expect(needsVanessa('en')).toBe(false);
    expect(scheduleKeyFor('en')).toBe(SCHEDULE_KEY.en);
  });

  it('embeds the framable variant, not the share link', () => {
    // The shared form answers X-Frame-Options: SAMEORIGIN and cannot be framed at all.
    expect(embedUrl('ABC')).toBe(
      'https://calendar.google.com/calendar/appointments/schedules/ABC?gv=true');
  });
});

/**
 * The failure this guards against is silent.
 *
 * 134's `public_setting` is not a generic reader — its allowlist is the whole security
 * boundary, because app_config also holds the Resend key and the fan-out secret. A
 * French schedule missing from that list reads as NULL, the booking code falls back to
 * English, and every French applicant is quietly offered the call without Vanessa.
 */
describe('the allowlist lets the French schedule through, and nothing else', () => {
  const sql = read('supabase/migrations/159_the_french_calendar_is_readable.sql');

  it('names both booking keys', () => {
    expect(sql).toMatch(/key IN \('booking_schedule_philip', 'booking_schedule_fr'\)/);
  });

  it('is still a closed list of literals, not a pattern', () => {
    // `key LIKE 'booking_%'` is a rule about names; this is a decision about which
    // values are safe to hand to a browser. Checked against the function body, since
    // the migration's own prose explains why a pattern was rejected.
    const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.public_setting'));
    expect(body.slice(0, body.indexOf('$$;'))).not.toMatch(/key LIKE/);
  });

  it('never admits a secret', () => {
    const guard = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.public_setting'));
    for (const secret of ['resend_api_key', 'ghl_api_token', 'message_fanout_secret',
                          'ghl_inbound_secret', 'ghl_client_secret']) {
      expect(guard.slice(0, guard.indexOf('$$;'))).not.toContain(secret);
    }
  });

  it('stores the schedule as a row, not a constant in the code', () => {
    expect(sql).toMatch(/INSERT INTO public\.app_config[\s\S]{0,120}'booking_schedule_fr'/);
    const booking = read('src/lib/supabase/partner-booking.ts');
    expect(booking).not.toMatch(/AcZss[A-Za-z0-9_-]{20,}/);
  });
});

describe('a returning applicant gets the calendar they asked for', () => {
  const page = read('src/app/routes/work/partner.tsx');

  it('uses their stored answer on the way back in, not an empty form', () => {
    expect(page).toContain('openBooking(summary.language)');
  });

  it('and the answer they just gave on submit', () => {
    expect(page).toContain('openBooking(callLang)');
  });

  it('the stored language is actually fetched', () => {
    const lib = read('src/lib/supabase/partner-application.ts');
    expect(lib).toMatch(/\.select\('status, has_current_project, will_introduce, years_experience, languages'\)/);
    expect(lib).toMatch(/language,/);
  });
});
