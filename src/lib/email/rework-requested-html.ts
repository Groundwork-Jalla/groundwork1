import type { Lang } from '../i18n/types.js';
import { translatePlural, translator } from '../i18n/translate.js';
import { emailShell, esc, primaryButton } from './shell.js';

export interface ReworkEmail {
  ownerName: string;
  projectName: string;
  stageName: string;
  reworkNote: string;
  flaggedCount: number;
  projectId: string;
}

/**
 * Rework requested, sent to the project owner in their own language.
 *
 * The substage count goes through `translatePlural` rather than the old inline
 * `count === 1 ? 'substage' : 'substages'`. That ternary was English-only grammar: in
 * French zero is singular too, so a rework request with nothing yet flagged would have
 * read "0 sous-étapes" instead of "0 sous-étape".
 */
export function buildReworkHtml(lang: Lang, e: ReworkEmail): string {
  const t = translator(lang);
  const link = `https://tryjalla.com/projects/${e.projectId}`;

  const body = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#1a1a1a;">${esc(t('email.rework.heading'))}</h1>
    <p style="margin:0 0 16px;font-size:15px;color:#555;line-height:1.65;">
      ${esc(t('email.rework.greeting', { name: e.ownerName }))}<br/><br/>
      ${t('email.rework.body', { stage: esc(e.stageName), project: esc(e.projectName) })}
    </p>
    <div style="background:#f9f9f9;border-radius:8px;border:1px solid #ebebeb;padding:16px;margin:0 0 16px;">
      <p style="margin:0 0 6px;font-size:10px;color:#999;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">${esc(t('email.rework.noteLabel'))}</p>
      <p style="margin:0;font-size:14px;color:#333;line-height:1.6;">${esc(e.reworkNote)}</p>
    </div>
    <p style="margin:0 0 24px;font-size:14px;color:#666;">
      ${esc(translatePlural(lang, 'email.rework.flagged', e.flaggedCount))}
    </p>
    ${primaryButton(link, t('email.rework.cta'))}`;

  return emailShell(lang, body);
}

export function reworkSubject(lang: Lang, stageName: string): string {
  return translator(lang)('email.rework.subject', { stage: stageName });
}
