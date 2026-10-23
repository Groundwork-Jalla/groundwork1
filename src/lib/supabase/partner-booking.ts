import { supabase } from './client';

/**
 * Booking the qualification call.
 *
 * ── Two schedules, one per language ─────────────────────────────────────────────────
 * Philip is on both: he is the partner decision-maker and the call is a decision.
 * Vanessa is a co-host on the French one only.
 *
 * This is the shape Google forces. A co-host sits on the SCHEDULE, not on a booking, so
 * "Vanessa for French speakers" cannot be expressed on a single calendar — she would
 * either join every call or none. Two schedules is the only way to say it, which is why
 * an earlier single-calendar draft had to send her a separate email instead.
 *
 * The earlier note here warned that routing French applicants to a second schedule
 * would take Philip out of a partnership decision. That was the right worry about the
 * wrong arrangement: the French schedule is Philip's with Vanessa added, not Vanessa's.
 *
 * ── Why the id is a lookup ──────────────────────────────────────────────────────────
 * `jalla-management.ts` hardcodes one, with a comment warning that a stale copy "sends
 * a paying prospect nowhere". This one lives in `app_config`, where changing it is a SQL
 * statement rather than a redeploy.
 */

/**
 * Does this call need Vanessa in it?
 *
 * The application asks one question with one answer — the language they want to be
 * spoken to in — because a multi-select left "both" to be interpreted, and a guess here
 * means somebody turns up to a call they cannot hold.
 */
export function needsVanessa(preferredLanguage: string): boolean {
  return preferredLanguage === 'fr';
}

/**
 * Which schedule a given language books into.
 *
 * `booking_schedule_fr` falling back to the English one is deliberate: an unconfigured
 * French schedule must not leave a French applicant with no calendar at all. They get
 * Philip's, which is a worse call rather than no call, and the fallback is visible here
 * rather than buried in an empty frame.
 */
export const SCHEDULE_KEY = {
  en: 'booking_schedule_philip',
  fr: 'booking_schedule_fr',
} as const;

export function scheduleKeyFor(preferredLanguage: string): string {
  return preferredLanguage === 'fr' ? SCHEDULE_KEY.fr : SCHEDULE_KEY.en;
}

/**
 * Google's embeddable schedule URL.
 *
 * Note the path. `/calendar/appointments/schedules/…?gv=true` is the embeddable
 * variant; the link a schedule is *shared* as — and the `calendar.app.google/…` short
 * form it hides behind — resolves to `/appointments/schedules/…` without the `/calendar`
 * prefix, answers `X-Frame-Options: SAMEORIGIN`, and cannot be framed at all. The two
 * differ by one path segment and one query parameter, and only one of them works.
 */
export const embedUrl = (scheduleId: string) =>
  `https://calendar.google.com/calendar/appointments/schedules/${scheduleId}?gv=true`;

/**
 * The booking frame, or null when no schedule is configured.
 *
 * Null is a real answer the caller must handle: an unconfigured schedule shows a
 * sentence saying Jalla will be in touch, rather than an empty frame that reads as
 * broken.
 */
export async function bookingUrl(preferredLanguage = 'en'): Promise<string | null> {
  const read = async (key: string): Promise<string | null> => {
    const { data, error } = await supabase.rpc('public_setting', { p_key: key });
    if (error || !data) return null;
    const id = String(data).trim();
    return id || null;
  };

  const wanted = scheduleKeyFor(preferredLanguage);
  const id = (await read(wanted))
    // A French applicant with no French schedule configured still gets a calendar.
    ?? (wanted === SCHEDULE_KEY.fr ? await read(SCHEDULE_KEY.en) : null);

  return id ? embedUrl(id) : null;
}

/**
 * Record that they reached the booking step.
 *
 * Not "a call was booked": Philip's calendar holds that, and the widget is a
 * cross-origin Google iframe, so a click inside it is invisible to us. This is the
 * nearest fact Groundwork owns, and `admin_partner_funnel` reports it under the name
 * `sent_to_booking` so the two are never confused.
 *
 * Fire-and-forget by design. A funnel counter that failed to write must never be the
 * reason an applicant cannot see their calendar.
 */
export async function markBookingShown(): Promise<void> {
  const { error } = await supabase.rpc('mark_booking_shown');
  // 136 may not be on this database yet; an absent counter is not a broken page.
  if (error && error.code !== 'PGRST202') return;
}
