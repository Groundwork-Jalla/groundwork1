/**
 * The two things a Jalla Management enquiry has to go through, in order: book the
 * intro call, then complete the project questionnaire. Philip's flow — the form is
 * what the call is prepared from, so it is useless before a call exists to prepare.
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
export const JALLA_MANAGEMENT_CALL_URL =
  'https://calendar.app.google/apwQF9c9rGrMCyVw6';

export const JALLA_MANAGEMENT_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSfyUDrmtLUG9tmRRqrSBSvUaYmGbvcJYKfeJoO_EatjEqs6nw/viewform';

/** Where every "Contact us" / "Talk to us" Jalla Management CTA sends people. */
export const JALLA_MANAGEMENT_PATH = '/jalla-management';
