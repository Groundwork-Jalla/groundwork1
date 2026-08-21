import { emailShell, esc } from './shell.js';
import { translator } from '../i18n/translate.js';
import type { Lang } from '../i18n/types.js';

// =========================================================
// Contractor application decision — accepted or rejected.
//
// Written in the language the applicant filled the form in (`contractor_applications.lang`),
// not the admin's. That is the whole reason the column exists.
//
// The rejection copy is deliberately short and does not give a reason. Reviews weigh
// several things at once and a templated reason would be a guess dressed as a finding;
// it also invites a rebuttal to something nobody actually decided. It says no clearly,
// leaves the door open, and does not pretend to be a critique.
// =========================================================

export type Decision = 'accepted' | 'rejected';

export function applicationDecisionSubject(lang: Lang, decision: Decision): string {
  const t = translator(lang);
  return t(decision === 'accepted'
    ? 'email.decision.acceptedSubject'
    : 'email.decision.rejectedSubject');
}

export function buildApplicationDecisionHtml(
  lang: Lang,
  decision: Decision,
  fullName: string,
  siteUrl: string,
): string {
  const t = translator(lang);
  const accepted = decision === 'accepted';
  const name = esc(fullName.trim().split(' ')[0] || fullName.trim());

  const heading = t(accepted ? 'email.decision.acceptedHeading' : 'email.decision.rejectedHeading');
  const body1   = t(accepted ? 'email.decision.acceptedBody1'   : 'email.decision.rejectedBody1');
  const body2   = t(accepted ? 'email.decision.acceptedBody2'   : 'email.decision.rejectedBody2');

  const cta = accepted
    ? `<table cellpadding="0" cellspacing="0" style="margin:24px 0 4px;">
         <tr><td style="background:#0a0a0a;border-radius:10px;">
           <a href="${esc(siteUrl)}/auth/signup"
              style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#fff;text-decoration:none;">
             ${esc(t('email.decision.acceptedCta'))}
           </a>
         </td></tr>
       </table>`
    : '';

  return emailShell(lang, `
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8a8a87;">
      ${esc(t('email.decision.eyebrow'))}
    </p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:800;color:#0a0a0a;">
      ${esc(heading)}
    </h1>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#3a3a38;">
      ${esc(t('email.decision.greeting', { name }))}
    </p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#3a3a38;">${esc(body1)}</p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#3a3a38;">${esc(body2)}</p>
    ${cta}
  `);
}
