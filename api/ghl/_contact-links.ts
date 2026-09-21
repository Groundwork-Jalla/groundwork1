/**
 * Linking existing profiles to their GoHighLevel contact — Source 2, the decision.
 *
 * Source 1 (supabase/maintenance/link-ghl-contacts-source1.sql) links every profile
 * Groundwork's own outbox can vouch for. This is for the profiles still unlinked after
 * that: the whole GHL contact book is fetched ONCE (`listContacts`) and each profile's
 * email is looked up in it, in memory. Email is a lookup key, not permission to write:
 *
 *   eligible        exactly one contact carries this email, and that contact is not
 *                   already linked to a different profile
 *   no_email        the profile has no email to look up
 *   not_found       no contact carries the email
 *   ambiguous       more than one contact carries it (GHL duplicates — a CRM problem
 *                   to merge, not one to guess through)
 *   taken           the one contact is already the contact of another profile
 *   already_linked  the profile is outside the population; never touched
 *
 * Pure: no I/O. The handler fetches, calls `planLinks`, reports, and — only when asked
 * with `apply: true` — writes the eligible pairs behind a database-side NULL guard.
 */

export interface ProfileRow { id: string; email: string | null; ghl_contact_id: string | null }
export interface ContactRow { id: string; email: string }

export type LinkDecision = 'eligible' | 'no_email' | 'not_found' | 'ambiguous' | 'taken' | 'already_linked';

export interface LinkPlan {
  profile_id: string;
  email: string | null;
  decision: LinkDecision;
  /** Every contact id that carried the email — so an `ambiguous` row shows what to merge. */
  contact_ids: string[];
  /** The id that would be (or was) written — set only for `eligible`. */
  contact_id: string | null;
}

const norm = (e: string | null | undefined): string => (e ?? '').trim().toLowerCase();

export function planLinks(profiles: ProfileRow[], contacts: ContactRow[]): LinkPlan[] {
  // email → contact ids. A contact with no email is nobody's evidence.
  const byEmail = new Map<string, string[]>();
  for (const c of contacts) {
    const e = norm(c.email);
    if (!e || !c.id) continue;
    const ids = byEmail.get(e) ?? [];
    if (!ids.includes(c.id)) ids.push(c.id);
    byEmail.set(e, ids);
  }
  // contact id → the profile that already owns it. Two profiles must never share one.
  const owned = new Map<string, string>();
  for (const p of profiles) if (p.ghl_contact_id) owned.set(p.ghl_contact_id, p.id);

  return profiles.map(p => {
    const email = norm(p.email);
    const row = (decision: LinkDecision, ids: string[] = [], id: string | null = null): LinkPlan =>
      ({ profile_id: p.id, email: p.email, decision, contact_ids: ids, contact_id: id });
    if (p.ghl_contact_id) return row('already_linked', [p.ghl_contact_id]);
    if (!email) return row('no_email');
    const ids = byEmail.get(email) ?? [];
    if (ids.length === 0) return row('not_found');
    if (ids.length > 1) return row('ambiguous', ids);
    const owner = owned.get(ids[0]);
    if (owner && owner !== p.id) return row('taken', ids);
    return row('eligible', ids, ids[0]);
  });
}

export function summarise(plan: LinkPlan[]): Record<LinkDecision, number> {
  const out: Record<LinkDecision, number> = { eligible: 0, no_email: 0, not_found: 0, ambiguous: 0, taken: 0, already_linked: 0 };
  for (const p of plan) out[p.decision]++;
  return out;
}
