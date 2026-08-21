import type { Lang } from '../i18n/types.js';
import { translator, type TKey } from '../i18n/translate.js';
import { emailShell, esc, primaryButton } from './shell.js';
import { credentialTrack, type ContractorApplicationInput } from '../contractor/application-types.js';

/**
 * Applicant's copy of a submitted contractor application.
 *
 * This email — not GoHighLevel — carries the full submission back to the applicant.
 * GHL deliberately holds a lead summary only (flat custom fields, no repeatable
 * project history), so it could not reproduce what they actually filled in.
 *
 * Written in the language the form was submitted in, reusing the very same
 * `contractorApply.form.*` keys the form rendered from, so a label can never drift
 * between what someone saw on screen and what arrives in their inbox.
 */

function row(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:7px 0;font-size:13px;color:#888;width:42%;vertical-align:top;">${esc(label)}</td>
      <td style="padding:7px 0;font-size:13px;color:#1a1a1a;font-weight:500;vertical-align:top;">${esc(value)}</td>
    </tr>`;
}

function sectionHeading(title: string): string {
  return `
    <p style="margin:26px 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;
              text-transform:uppercase;color:#999;">${esc(title)}</p>
    <div style="height:1px;background:#e8e8e8;margin-bottom:6px;"></div>`;
}

export function buildContractorApplicationHtml(
  lang: Lang,
  a: ContractorApplicationInput,
): string {
  const t = translator(lang);
  const f = (k: string, params?: Record<string, string | number>) =>
    t(`contractorApply.form.${k}` as TKey, params);
  const none = t('email.contractorApplication.notListed');
  const yesNo = (v: boolean) => (v ? f('yes') : f('no'));
  const val = (s: string) => (s && s.trim() ? s.trim() : none);

  const roleLabel = a.role === 'other' && a.roleOther.trim()
    ? a.roleOther.trim()
    : f(`role.${a.role}`);

  const track = credentialTrack(a.role);
  const cred = a.credentials as Record<string, string | string[] | boolean | undefined>;
  const credStr = (k: string) => {
    const v = cred[k];
    if (Array.isArray(v)) return v.length ? v.join(', ') : none;
    if (typeof v === 'boolean') return v ? f('yes') : f('no');
    return typeof v === 'string' && v.trim() ? v.trim() : none;
  };

  // ── Section 4 varies by role, so the receipt varies with it ──
  let credRows = '';
  if (track === 'contractor') {
    credRows =
      row(f('avgProjectQ'), credStr('avgProject')) +
      row(f('diasporaQ'), credStr('diaspora')) +
      row(f('paymentStructureQ'), credStr('paymentStructure'));
  } else if (track === 'lawyer') {
    credRows =
      row(f('legalServicesQ'), credStr('legalServices')) +
      row(f('diasporaPropertyQ'), credStr('diasporaProperty'));
  } else if (track === 'technical') {
    credRows =
      row(f('servicesQ'), credStr('services')) +
      row(f('softwareQ'), credStr('software'));
  } else {
    credRows =
      row(f('tradeProjectsQ'), credStr('tradeProjects')) +
      row(f('workStyleQ'), credStr('workStyle'));
  }

  const projectBlocks = a.projects.map((p, i) => `
    ${sectionHeading(f('projectN', { n: i + 1 }))}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      ${row(f('projName'), val(p.name))}
      ${row(f('projLocation'), val(p.location))}
      ${row(f('projBudget'), val(p.budget))}
      ${row(f('projRole'), val(p.role))}
      ${row(f('projYear'), val(p.year))}
      ${row(f('refName'), val(p.refName))}
      ${row(f('refPhone'), val(p.refPhone))}
      ${row(f('refEmail'), val(p.refEmail))}
    </table>`).join('');

  const body = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#1a1a1a;">
      ${esc(t('email.contractorApplication.heading'))} &#10003;
    </h1>
    <p style="margin:0 0 16px;font-size:15px;color:#555;line-height:1.65;">
      ${esc(t('email.contractorApplication.greeting', { name: a.fullName }))}<br/><br/>
      ${esc(t('email.contractorApplication.body'))}
    </p>
    <p style="margin:0 0 24px;font-size:14px;color:#666;line-height:1.65;">
      ${esc(t('email.contractorApplication.whatNext'))}
    </p>

    <div style="height:1px;background:#e8e8e8;margin:8px 0 4px;"></div>
    <p style="margin:16px 0 0;font-size:13px;color:#888;">
      ${esc(t('email.contractorApplication.copyIntro'))}
    </p>

    ${sectionHeading(f('s1'))}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      ${row(f('fullName'), val(a.fullName))}
      ${row(f('businessName'), val(a.businessName))}
      ${row(f('phone'), val(a.phone))}
      ${row(f('email'), val(a.email))}
      ${row(f('country'), val(a.country))}
      ${row(f('city'), val(a.city))}
      ${row(f('portfolio'), val(a.portfolioUrl))}
    </table>

    ${sectionHeading(f('s2'))}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      ${row(f('roleQ'), roleLabel)}
    </table>

    ${sectionHeading(f('s3'))}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      ${row(f('yearsQ'), a.yearsExperience ? f(`years.${a.yearsExperience}`) : none)}
      ${row(f('operatesQ'), a.operatesAs ? f(`operates.${a.operatesAs}`) : none)}
      ${row(f('teamSize'), val(a.teamSize))}
      ${row(f('projectTypesQ'),
        a.projectTypes.length ? a.projectTypes.map(k => f(`projectType.${k}`)).join(', ') : none)}
    </table>

    ${sectionHeading(f('s4'))}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      ${credRows}
      ${row(t('email.contractorApplication.filesLabel'),
        a.uploads.length
          ? t('email.contractorApplication.fileCount', { n: a.uploads.length })
          : none)}
    </table>

    ${projectBlocks}

    ${sectionHeading(f('s6'))}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      ${row(f('milestonesQ'), yesNo(a.acceptsMilestones))}
      ${row(f('verificationQ'), yesNo(a.acceptsVerification))}
      ${row(f('noSidePayQ'), yesNo(a.acceptsNoSidePay))}
    </table>

    ${sectionHeading(f('s7'))}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      ${row(f('videoUrl'), val(a.videoUrl))}
      ${row(f('whyJoinQ'), val(a.whyJoin))}
      ${row(f('differentiatorQ'), val(a.differentiator))}
      ${row(f('readyQ'), yesNo(a.readyForEarly))}
    </table>

    ${sectionHeading(f('s8'))}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      ${row(f('regionsQ'), val(a.regions))}
      ${row(f('concurrentQ'),
        a.concurrentProjects ? f(`concurrent.${a.concurrentProjects}`) : none)}
    </table>

    <div style="height:20px;"></div>
    ${primaryButton('https://tryjalla.com', t('email.contractorApplication.ctaSite'))}`;

  return emailShell(lang, body);
}

export function contractorApplicationSubject(lang: Lang): string {
  return translator(lang)('email.contractorApplication.subject');
}
