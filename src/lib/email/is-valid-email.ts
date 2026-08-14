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
 * Deliberately the same expression the API handlers use, so the browser and the server
 * can never disagree about what counts as valid.
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim().toLowerCase());
}
