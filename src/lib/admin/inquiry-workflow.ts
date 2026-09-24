import type { InquiryStatus } from '@/lib/supabase/admin-inquiries';

// =========================================================
// The quote-request lifecycle (076) — pure.
//
// The four values below are not a product decision made here: they are the CHECK
// constraint on `contractor_inquiries.status`, and a fifth one would be rejected by the
// database. So this file exists to make that constraint the only source of what the
// screen may offer, rather than a list someone retypes next to a <select>.
//
// What the schema does NOT hold is just as load-bearing. There is no `introduced_at`, no
// `introduced_by`, and no record of a message ever being sent. Marking an inquiry
// `introduced` therefore states one thing only — that the team considers this request
// handled — and the screen must not decorate it into a claim that an introduction was
// delivered. `contractor_id` is pinned by a trigger, so the contractor named on the row
// is the contractor the request was always about; that much is safe to say.
// =========================================================

/** Exactly the CHECK constraint in 076, in lifecycle order. */
export const INQUIRY_STATUSES: readonly InquiryStatus[] = ['open', 'introduced', 'declined', 'closed'] as const;

/** Is this a value the database will accept? Anything else is not offered and not saved. */
export function isInquiryStatus(value: string): value is InquiryStatus {
  return (INQUIRY_STATUSES as readonly string[]).includes(value);
}

/**
 * What an admin may move this request to. Every canonical value except the one it is
 * already on — 076 defines no forbidden edge, and inventing one here would be a rule the
 * database does not enforce and nobody agreed to. A request wrongly declined must be
 * able to go back to open.
 */
export function allowedTransitions(from: InquiryStatus): InquiryStatus[] {
  return INQUIRY_STATUSES.filter(s => s !== from);
}

/** Terminal in the workflow sense: nothing further is expected of the team. */
export function isSettled(status: InquiryStatus): boolean {
  return status === 'declined' || status === 'closed';
}
