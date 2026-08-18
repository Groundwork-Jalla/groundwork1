/**
 * The two things a Jalla Management enquiry has to go through, in order: book the
 * project audit, then complete the questionnaire. Philip's flow — the form is
 * what the call is prepared from, so it is useless before an audit exists to prepare.
 *
 * Canonical URLs rather than the bit.ly links they were shared as. A shortener is a
 * third party that can expire, rate-limit or be re-pointed, and these are the entry
 * point to the highest-value tier. The short forms, for reference:
 *   form → https://bit.ly/467uhnU
 *
 * Responses land in "Let's Get to Know Your Project (Responses)":
 * https://docs.google.com/spreadsheets/d/1fUGGOieSTBbdb-g_WLmBYMpHQHPgcNE-J60mNTbifVk
 *
 * Shared because three CTAs point here — pricing, the in-app upgrade screen and the
 * profile plan list — and a stale copy in one of them sends a paying prospect nowhere.
 */
const SCHEDULE_ID =
  'AcZssZ0_a0PBaUioL9nifcJAFajA0lb0qCP873SmMiA4w-bUl_w6TFkAeUPqt_TLaeSuE60db8tliT7L';

/**
 * Booking, embedded in the page.
 *
 * Note the path: `/calendar/appointments/schedules/…?gv=true` is Google's embeddable
 * variant. The link the schedule is *shared* as — calendar.app.google/… , which
 * redirects to `/appointments/schedules/…` without the `/calendar` prefix — answers
 * `X-Frame-Options: SAMEORIGIN` and cannot be framed at all. The two differ by one path
 * segment and one query parameter, and only one of them works in an iframe.
 */
export const JALLA_MANAGEMENT_AUDIT_EMBED_URL =
  `https://calendar.google.com/calendar/appointments/schedules/${SCHEDULE_ID}?gv=true`;

/** Same page, for opening directly if the frame ever fails to render. */
export const JALLA_MANAGEMENT_AUDIT_URL = 'https://calendar.app.google/apwQF9c9rGrMCyVw6';

const FORM_ID = '1FAIpQLSfyUDrmtLUG9tmRRqrSBSvUaYmGbvcJYKfeJoO_EatjEqs6nw';

/** `embedded=true` drops Google's own chrome so the form sits inside our layout. */
export const JALLA_MANAGEMENT_FORM_EMBED_URL =
  `https://docs.google.com/forms/d/e/${FORM_ID}/viewform?embedded=true`;

export const JALLA_MANAGEMENT_FORM_URL =
  `https://docs.google.com/forms/d/e/${FORM_ID}/viewform`;

/** Where every "Contact us" / "Talk to us" Jalla Management CTA sends people. */
export const JALLA_MANAGEMENT_PATH = '/jalla-management';
