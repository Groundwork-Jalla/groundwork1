import type { Lang } from '../i18n/types';
import { translator } from '../i18n/translate';
import { emailShell, esc, primaryButton, secondaryButton } from './shell';

export interface StageApprovedEmail {
  ownerName: string;
  projectName: string;
  stageName: string;
  nextStageName: string;
  projectId: string;
  certificateId?: string;
}

/**
 * Stage approved, sent to the project owner.
 *
 * `lang` is the owner's, not the reviewing admin's — the admin console runs in English
 * regardless of who the project belongs to.
 *
 * `stageName` and `nextStageName` arrive already translated: the caller resolves them
 * from `stage_key` (migration 024) rather than passing the stored English `name`, so a
 * French email does not carry an English stage title in its subject line.
 */
export function buildStageApprovedHtml(lang: Lang, e: StageApprovedEmail): string {
  const t = translator(lang);
  const link = `https://tryjalla.com/projects/${e.projectId}`;
  const certLink = e.certificateId ? `https://tryjalla.com/verify/${e.certificateId}` : null;

  const body = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#1a1a1a;">${esc(t('email.stageApproved.heading'))} &#10003;</h1>
    <p style="margin:0 0 16px;font-size:15px;color:#555;line-height:1.65;">
      ${esc(t('email.stageApproved.greeting', { name: e.ownerName }))}<br/><br/>
      ${t('email.stageApproved.body', { stage: esc(e.stageName), project: esc(e.projectName) })}
    </p>
    <p style="margin:0 0 24px;font-size:14px;color:#666;line-height:1.65;">
      ${t('email.stageApproved.next', { stage: esc(e.nextStageName) })}
    </p>
    ${primaryButton(link, t('email.stageApproved.ctaProject'))}
    ${certLink ? secondaryButton(certLink, t('email.stageApproved.ctaCert')) : ''}`;

  return emailShell(lang, body);
}

export function stageApprovedSubject(lang: Lang, stageName: string): string {
  return translator(lang)('email.stageApproved.subject', { stage: stageName });
}
