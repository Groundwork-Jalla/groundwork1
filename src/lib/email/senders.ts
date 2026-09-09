import type { EmailKind } from './email-kind.js';

/**
 * Who our email comes from.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────
 * The same sender string was written out ten times across nine files under `api/`. That
 * is not a style problem: it is why "send certificates from a dedicated address" was a
 * ten-file change, and why nobody could answer "what do we send as?" without grepping.
 *
 * It lives beside `email-kind.ts` for the same stated reason: both sides need it, and
 * nothing under `src/` may import from `api/`, so a shared vocabulary has to sit on this
 * side of the line.
 *
 * The bug B5 was filed for — certificates arriving from a personal address — is not in
 * the code any more; every sender is the verified `noreply@` and the only `favour@`
 * left is in comments and test fixtures. What remains is the duplication that made it
 * hard to fix and easy to reintroduce.
 *
 * ── Nothing changes address today ────────────────────────────────────────────────────
 * Every kind resolves to the SAME verified sender unless an env var says otherwise.
 * Pointing certificates at `certificates@mail.tryjalla.com` before that address is
 * verified in Resend would not make them prettier — it would make them fail to send.
 * So the split is expressed here and switched on later, one variable at a time, once
 * each address is verified.
 */

/**
 * The one address Resend is verified to send as today.
 *
 * `mail.tryjalla.com`, not the apex: the apex is the marketing site and its DNS is not
 * ours to fill with mail records.
 */
export const DEFAULT_SENDER = 'Groundwork by Jalla <noreply@mail.tryjalla.com>';

/**
 * Per-purpose overrides, by the same `EmailKind` the CRM notes already use — one
 * vocabulary for "what kind of email is this", not two that can drift.
 *
 * Written out rather than derived from the kind name so the variables are greppable:
 * someone setting one in Vercel should be able to find where it is read.
 */
const ENV_VAR: Record<EmailKind, string> = {
  contractor_application_received: 'EMAIL_FROM_APPLICATIONS',
  contractor_application_decision: 'EMAIL_FROM_APPLICATIONS',
  contractor_invite:               'EMAIL_FROM_INVITES',
  // The stage-approval email is the one carrying a certificate link, so this is the
  // variable to set when `certificates@` is verified.
  stage_update:                    'EMAIL_FROM_CERTIFICATES',
  other:                           'EMAIL_FROM_DEFAULT',
};

const clean = (v: string | undefined): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The From header for an email of this kind.
 *
 * Falls back through: the kind's own variable, then `EMAIL_FROM_DEFAULT`, then the
 * verified default. A blank or unset variable is the same as absent — an empty string in
 * a dashboard is a much easier mistake to make than a wrong address, and it must not
 * produce a send with no From.
 */
export function senderFor(kind: EmailKind = 'other'): string {
  return clean(process.env[ENV_VAR[kind]])
      || clean(process.env.EMAIL_FROM_DEFAULT)
      || DEFAULT_SENDER;
}
