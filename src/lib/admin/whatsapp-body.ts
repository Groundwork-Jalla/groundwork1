// Relative and extensioned where it needs to be: this module is reached from `api/`,
// where no `@/*` alias exists to expand. See api-import-graph.test.ts.
import { displaySenderName } from './chat-identity.js';

// =========================================================
// What a Groundwork message looks like when it arrives on a phone — pure.
//
// Kept out of the handler so it can be tested without a database or a provider, which is
// the same reason `whatsapp-shortcut.ts` is separate: this text is what a client actually
// reads about their own building, and getting it wrong is not a rendering bug.
// =========================================================

/**
 * The sender's role, in both languages.
 *
 * `staff` is the fallback rather than a participant role: `project_participants` has no
 * row for Jalla, and inventing one to carry a label would put staff inside the project's
 * membership — which decides who may write on the thread and who gets told about it.
 */
const ROLE_LABEL: Record<string, { en: string; fr: string }> = {
  owner:      { en: 'Client',     fr: 'Client' },
  contractor: { en: 'Contractor', fr: 'Entrepreneur' },
  verifier:   { en: 'Verifier',   fr: 'Vérificateur' },
  staff:      { en: 'Jalla',      fr: 'Jalla' },
};

const OPEN_IN  = { en: 'Reply in Groundwork',  fr: 'Répondre dans Groundwork' };
const HAS_FILES = {
  en: 'Sent with an attachment — open Groundwork to see it.',
  fr: 'Envoyé avec une pièce jointe — ouvrez Groundwork pour la voir.',
};

export interface WhatsAppBody {
  senderName: string;
  /** A `project_participants` role, or anything else — which reads as Jalla. */
  senderRole: string;
  projectName: string;
  content: string;
  hasAttachments: boolean;
  /** `profiles.preferred_lang`. Anything that is not 'fr' reads as English. */
  lang: string | null;
  link: string;
}

/**
 * What arrives on the phone.
 *
 * ── Why the role is in it, not just the name ─────────────────────────────────────────
 * A WhatsApp message arrives with no Groundwork around it. "Vanessa Gwanvoma" tells a
 * client nothing about whether to treat what follows as their contractor reporting
 * progress, a verifier's finding, or Jalla asking for a decision — and a project thread
 * has all three writing into it. The same ambiguity exists in the app, where the bubble
 * showed a bare name; on a phone it is worse, because there is nothing else on screen.
 *
 * ── Why the content is included at all ───────────────────────────────────────────────
 * Deliberately, and unlike the email in 123, which carries only "a message is waiting".
 * The difference is the medium: email lands in an inbox whose onward reading Groundwork
 * does not control, whereas this goes to the number the person gave us as their own
 * WhatsApp. A notification that makes you open an app to learn one sentence is the kind
 * people switch off.
 *
 * ── Why the link is always last ─────────────────────────────────────────────────────
 * Answering belongs in Groundwork, where the project keeps its record. The message is
 * readable on the phone; the reply is one tap from it.
 */
export function composeWhatsAppBody(input: WhatsAppBody): string {
  const lang = input.lang === 'fr' ? 'fr' : 'en';
  const role = (ROLE_LABEL[input.senderRole] ?? ROLE_LABEL.staff)[lang];
  // An unnamed sender falls back to their role rather than to an empty bold span: "who
  // is this" is the one question the first line exists to answer. An EMAIL ADDRESS falls
  // back the same way — 127 stops one being stored, but `sender_name` has writers that
  // function does not cover, and this message leaves the platform, so an address here
  // would be a staff mailbox published to a phone.
  const who = displaySenderName(input.senderName, role);
  const project = input.projectName?.trim();

  const heading = project ? `*${who}* (${role}) · ${project}` : `*${who}* (${role})`;
  const parts = [heading, '', input.content.trim()];
  if (input.hasAttachments) parts.push('', HAS_FILES[lang]);
  parts.push('', `${OPEN_IN[lang]}: ${input.link}`);
  return parts.join('\n');
}
