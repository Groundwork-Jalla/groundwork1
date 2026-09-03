import { emailShell, esc, primaryButton } from './shell.js';
import type { Lang } from '../i18n/types.js';

/**
 * The homeowner's welcome — the one email a signed-up client never had.
 *
 * ── Why it exists ────────────────────────────────────────────────────────────────────
 * Contractors get an acknowledgement, a decision, and an invitation. A homeowner who
 * signs up gets nothing until a stage is approved, which for most of them is weeks away
 * and for anyone who never starts a build is never. So the CRM shows a contact with no
 * correspondence, and whoever picks up the phone has no idea whether the person has
 * heard from us at all.
 *
 * ── It does not oversell ─────────────────────────────────────────────────────────────
 * Someone who signed up three weeks ago and has already built a project should not be
 * told to "get started" — see the `hasProject` variant. Sending everyone the same
 * new-user email is how a launch announcement reads as spam to your most engaged users.
 */
export function buildUserWelcomeHtml(
  lang: Lang,
  opts: { name?: string | null; site: string; hasProject: boolean },
): string {
  const first = (opts.name ?? '').trim().split(' ')[0];
  const hello = first ? `${lang === 'fr' ? 'Bonjour' : 'Hello'} ${esc(first)},` : (lang === 'fr' ? 'Bonjour,' : 'Hello,');

  const body = lang === 'fr'
    ? opts.hasProject
      ? `<p>${hello}</p>
         <p>Votre projet est en cours sur Groundwork. Vous pouvez suivre chaque étape,
            consulter votre budget et confirmer les paiements au fur et à mesure.</p>
         <p>Si vous avez une question sur votre chantier, répondez simplement à cet
            e-mail — il arrive directement chez notre équipe.</p>
         ${primaryButton(`${opts.site}/dashboard`, 'Ouvrir mon tableau de bord')}`
      : `<p>${hello}</p>
         <p>Bienvenue sur Groundwork. Vous pouvez estimer le coût de votre construction
            à partir de tarifs locaux réels, suivre le chantier étape par étape et ne
            payer chaque tranche qu'une fois le travail confirmé sur place.</p>
         <p>La première étape est de décrire ce que vous voulez bâtir : cela prend
            quelques minutes et vous donne une estimation détaillée.</p>
         ${primaryButton(`${opts.site}/projects/new`, 'Estimer mon projet')}
         <p>Une question ? Répondez simplement à cet e-mail.</p>`
    : opts.hasProject
      ? `<p>${hello}</p>
         <p>Your project is under way on Groundwork. You can follow each stage, see your
            budget, and confirm payments as the work is verified.</p>
         <p>If anything about your build needs an answer, just reply to this email — it
            reaches our team directly.</p>
         ${primaryButton(`${opts.site}/dashboard`, 'Open my dashboard')}`
      : `<p>${hello}</p>
         <p>Welcome to Groundwork. You can estimate what your build should cost using
            real local rates, follow it stage by stage, and release each payment only
            once the work has been confirmed on the ground.</p>
         <p>The first step is telling us what you want to build — it takes a few minutes
            and gives you a detailed estimate.</p>
         ${primaryButton(`${opts.site}/projects/new`, 'Estimate my project')}
         <p>Any questions, just reply to this email.</p>`;

  return emailShell(lang, body);
}

export function userWelcomeSubject(lang: Lang, hasProject: boolean): string {
  if (lang === 'fr') {
    return hasProject ? 'Votre projet sur Groundwork' : 'Bienvenue sur Groundwork';
  }
  return hasProject ? 'Your Groundwork project' : 'Welcome to Groundwork';
}
