/**
 * One email rule, shared by the forms and the serverless handlers.
 *
 * `<input type="email">` is not enough on its own: HTML5 deliberately accepts an
 * address with no TLD — `foo@gmail` is valid to a browser, because intranet hosts are
 * legal. Our handlers require a dot after the @, so an address like that saved to the
 * waitlist and was then rejected by every downstream step: the GoHighLevel mirror
 * returned 400 and the welcome email could not be delivered. The person saw "You're
 * in." and heard nothing again.
 *
 * ── Why this is stricter than "something@something.something" ────────────────────────
 * The first version of this rule was `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, which asks only
 * for a dot in the domain. `ngamfonjoel.@gmail.com` passes it — a trailing dot on the
 * local part — so a contractor application was accepted, stored, mirrored to GHL, and
 * then failed *every* attempt to email that person, automatic and manual alike, with
 * Resend answering `422 validation_error` each time. The admin page could only say
 * "Try again", which was never going to work: the address, not the send, was broken.
 *
 * So the rule below is the one Resend actually enforces, checked against its API:
 *
 *   - the local part is dot-separated atoms — a dot may not lead, trail or repeat;
 *   - each domain label is alphanumeric, may contain inner hyphens, and may not begin
 *     or end with one;
 *   - there is at least one dot in the domain and the TLD is two or more letters;
 *   - ASCII only. Resend rejects non-ASCII addresses outright ("the email address
 *     contains non-ASCII characters"), so accepting them here would only move the
 *     failure from the form, where it can be corrected, to the send, where it cannot.
 *
 * Deliberately the same expression the API handlers use, so the browser and the server
 * can never disagree about what counts as valid. Import it; do not copy it.
 */
const ATOM   = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+";
const LABEL  = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';

export const EMAIL_RE = new RegExp(
  `^${ATOM}(?:\\.${ATOM})*@(?:${LABEL}\\.)+[A-Za-z]{2,}$`,
);

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim().toLowerCase());
}
