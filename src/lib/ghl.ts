/**
 * GoHighLevel lead forwarding, client side.
 *
 * Every call here is fire-and-forget by design. Supabase is the source of truth for the
 * waitlist — `waitlist_members` drives the live social-proof ticker — and the row is
 * already written before this runs. If the CRM is unreachable, the person still joined.
 *
 * Surfacing a CRM error to someone who successfully signed up would be actively harmful:
 * they would see a failure, retry, and hit the duplicate-email branch, which tells them
 * they are "already on the list" without ever explaining why the first attempt failed.
 */

export interface WaitlistLead {
  name?: string;
  email: string;
  location?: string;
}

/**
 * Forward a waitlist signup to GoHighLevel. Never throws and never blocks — callers
 * should not await this if the user is waiting on the result of something else.
 */
export function sendWaitlistLead(lead: WaitlistLead): void {
  void fetch('/api/ghl/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lead),
    // The signup is complete; let the request outlive a navigation rather than
    // holding the page open for it.
    keepalive: true,
  }).catch(() => {
    // Swallowed on purpose. The server logs the failure; the user does not need it.
  });
}
