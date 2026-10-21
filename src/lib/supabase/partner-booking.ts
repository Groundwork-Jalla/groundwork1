import { supabase } from './client';

/**
 * Booking the qualification call.
 *
 * ── One calendar, not two ───────────────────────────────────────────────────────────
 * Every applicant books Philip: he is the partner decision-maker and the call is a
 * decision. Language does not change WHOSE calendar — it changes who else is in the
 * room. A French-speaking applicant means Vanessa joins.
 *
 * An earlier draft routed French applicants to a second schedule of Vanessa's. That was
 * wrong in a way worth recording: it would have taken Philip out of a partnership
 * decision, and a Google appointment schedule cannot add a guest per booking anyway —
 * co-hosts are set on the schedule itself and apply to every slot. So the invitation is
 * ours to send, not Google's.
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
export async function bookingUrl(): Promise<string | null> {
  const { data, error } = await supabase.rpc('public_setting', { p_key: 'booking_schedule_philip' });
  if (error || !data) return null;
  const id = String(data).trim();
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
