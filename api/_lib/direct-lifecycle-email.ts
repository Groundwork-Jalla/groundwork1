import { sendViaResend } from './resend-send.js';
import { emphasise } from './communication-email.js';
import { logEmailToCrm } from '../ghl/_email-log.js';
import { copyFor, ctaPath, pickLang, type Context, type Person, type Step } from '../../shared/lifecycle-copy.js';
import { isSeededLifecycleDraft } from '../../shared/whatsapp.js';
import { EMAIL_RE } from '../../src/lib/email/is-valid-email.js';
import { senderFor } from '../../src/lib/email/senders.js';
import { emailShell, esc, primaryButton } from '../../src/lib/email/shell.js';
import { buildUserWelcomeHtml, userWelcomeSubject } from '../../src/lib/email/user-welcome-html.js';
import { siteUrl } from '../../src/lib/site-url.js';

/**
 * Direct transactional delivery for Day-0 Welcome (`user_signup`) and Project
 * Activation (`project_created`) emails.
 *
 * ── Why this exists alongside `/admin/sequences` ──────────────────────────────────────
 * Transactional Day-0 emails must arrive immediately via Resend whether or not
 * GoHighLevel is configured, reachable, or already holds the contact, and whether or not
 * the delayed reminder cron switch is toggled on.
 *
 * Zero duplication with `/admin/sequences`:
 *   1. Reads Step 1 copy directly from `lifecycle_sequence_steps` (`CS01`/`CL01` or
 *      `CS09`/`CL05`) so edits in Admin apply automatically to Day-0 sends too.
 *   2. Uses a stable Resend `Idempotency-Key` (`welcome/<userId>`, `activation/<projectId>`)
 *      plus a DB timestamp (`profiles.welcome_email_sent_at` / `projects.activation_email_sent_at`).
 *   3. Callers hand off `initial_email_sent: true` into `enrollForEvent`, which records
 *      Step 1 in `lifecycle_sends` and schedules `lifecycle_enrollments` starting at Step 2
 *      (24h+), using the exact same handoff pattern invitations (`CI01`/`IV01`) already use.
 */

type Svc = { from: (t: string) => any };

export interface DirectEmailResult {
  sent: boolean;
  alreadySent: boolean;
  skippedReason?: string;
  subject?: string;
  stepCode?: string;
  messageId?: string;
  error?: string;
}

const oneLine = (value: string) => value.replace(/[\r\n]/g, ' ').trim();

function renderStepHtml(
  lang: 'en' | 'fr',
  body: string,
  ctaLabel: string,
  ctaUrl: string | null,
  emphasis?: (string | null | undefined)[],
): { html: string; text: string } {
  const paragraph = 'margin:0 0 16px;font-size:15px;color:#333;line-height:1.6;';
  const bodyHtml = body
    .split(/\n{2,}/)
    .map(p => `<p style="${paragraph}">${emphasise(esc(p), emphasis).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const buttonHtml = ctaLabel && ctaUrl
    ? `<div style="margin:8px 0 0;">${primaryButton(esc(ctaUrl), ctaLabel)}</div>`
    : '';
  const text = `${body}${ctaLabel && ctaUrl ? `\n\n${ctaLabel}: ${ctaUrl}` : ''}`;
  return { html: emailShell(lang, `${bodyHtml}${buttonHtml}`), text };
}

async function resolveSender(svc: Svc): Promise<{ from: string; replyTo?: string }> {
  try {
    const { data } = await svc
      .from('communication_settings')
      .select('sender_name, sender_email')
      .eq('id', true)
      .maybeSingle();
    const senderEmail = typeof data?.sender_email === 'string' ? data.sender_email.trim() : '';
    if (senderEmail && EMAIL_RE.test(senderEmail)) {
      const senderName = oneLine(String(data?.sender_name || 'Groundwork by Jalla')).replace(/[<>]/g, '');
      return { from: `${senderName} <${senderEmail}>`, replyTo: senderEmail };
    }
  } catch {
    // Fall through to verified default sender.
  }
  return { from: senderFor('other') };
}

async function isBlockedOrUnsubscribed(svc: Svc, email: string): Promise<boolean> {
  try {
    const { data } = await svc
      .from('communication_preferences')
      .select('activation_unsubscribed, blocked_reason')
      .eq('email', email)
      .maybeSingle();
    return Boolean(data?.activation_unsubscribed || data?.blocked_reason);
  } catch {
    return false;
  }
}

async function hasInvitationContext(svc: Svc, email: string): Promise<boolean> {
  try {
    const [ci, pv] = await Promise.all([
      svc.from('contractor_invites').select('id').ilike('email', email).in('status', ['pending', 'accepted']).limit(1),
      svc.from('project_viewers').select('id').ilike('email', email).eq('is_client', true).is('revoked_at', null).limit(1),
    ]);
    return (ci.data?.length ?? 0) > 0 || (pv.data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

async function fetchStepOne(svc: Svc, sequenceKey: string): Promise<Step | null> {
  try {
    const { data } = await svc
      .from('lifecycle_sequence_steps')
      .select('*')
      .eq('sequence_key', sequenceKey)
      .eq('position', 1)
      .maybeSingle();
    const step = (data as Step | null) ?? null;
    return step && !isSeededLifecycleDraft(step) ? step : null;
  } catch {
    return null;
  }
}

async function contractorAlreadyOnboarded(svc: Svc, userId: string): Promise<boolean> {
  try {
    const { data } = await svc
      .from('contractor_profiles')
      .select('id')
      .eq('user_id', userId)
      .limit(1);
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

async function hasRecordedStepSend(svc: Svc, email: string, stepCodes: string[], projectId?: string): Promise<boolean> {
  try {
    const { data } = await svc
      .from('lifecycle_sends')
      .select('id, enrollment_id')
      .eq('email', email)
      .eq('status', 'sent')
      .in('step_code', stepCodes)
      .limit(5);
    if (!data?.length) return false;
    if (!projectId) return true;
    const enrollmentIds = data.map((row: any) => row.enrollment_id).filter(Boolean);
    if (!enrollmentIds.length) return false;
    const { data: matching } = await svc
      .from('lifecycle_enrollments')
      .select('id')
      .in('id', enrollmentIds)
      .eq('ref', projectId)
      .limit(1);
    return (matching?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function sendDirectWelcomeEmail(
  svc: Svc,
  opts: {
    userId: string;
    email: string;
    fullName?: string | null;
    lang?: string | null;
    role: 'contractor' | 'client';
  },
): Promise<DirectEmailResult> {
  const email = (opts.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { sent: false, alreadySent: false, skippedReason: 'invalid_email' };
  }

  // 1. Check DB idempotency stamp (tolerant if migration has not yet run).
  try {
    const { data } = await svc
      .from('profiles')
      .select('welcome_email_sent_at')
      .eq('id', opts.userId)
      .maybeSingle();
    if (data?.welcome_email_sent_at) {
      return { sent: false, alreadySent: true };
    }
  } catch {
    // Column may not exist prior to migration; continue with lifecycle_sends check.
  }

  if (await hasRecordedStepSend(svc, email, ['CS01', 'CL01'])) {
    return { sent: false, alreadySent: true };
  }

  if (await isBlockedOrUnsubscribed(svc, email)) {
    return { sent: false, alreadySent: false, skippedReason: 'unsubscribed_or_blocked' };
  }

  // An invited user already received their project invitation email; do not override
  // their invitation context with a generic self-signup welcome.
  if (await hasInvitationContext(svc, email)) {
    return { sent: false, alreadySent: false, skippedReason: 'invitation_context' };
  }

  const lang = pickLang(opts.lang);
  // If a contractor already finished onboarding during signup, welcome them directly
  // into their contractor workspace (`cs_onboarded` -> /work) instead of sending them
  // back to onboarding (`cs_signup` -> /work/onboarding).
  const contractorOnboarded = opts.role === 'contractor' ? await contractorAlreadyOnboarded(svc, opts.userId) : false;
  const sequenceKey = opts.role === 'contractor' ? (contractorOnboarded ? 'cs_onboarded' : 'cs_signup') : 'cl_signup';
  const stepCode = opts.role === 'contractor' ? (contractorOnboarded ? 'CS05' : 'CS01') : 'CL01';
  const person: Person = { email, fullName: opts.fullName ?? null, lang };
  const context: Context = { entry_source: 'independent_signup', recipient_role: opts.role };
  const base = siteUrl();

  const step = await fetchStepOne(svc, sequenceKey);
  let subject: string;
  let html: string;
  let text: string | undefined;

  if (step && (step.subject_en || step.subject_fr) && (step.body_en || step.body_fr)) {
    const copy = copyFor(step, lang, person, context);
    const path = ctaPath(step.cta_key, context);
    const ctaUrl = path ? `${base}${path}` : null;
    subject = oneLine(copy.subject);
    ({ html, text } = renderStepHtml(lang, copy.body, copy.cta, ctaUrl));
  } else {
    let hasProject = false;
    try {
      const { data: owned } = await svc.from('projects').select('id').eq('user_id', opts.userId).limit(1);
      hasProject = (owned?.length ?? 0) > 0;
    } catch {
      hasProject = false;
    }
    subject = opts.role === 'contractor'
      ? (contractorOnboarded
        ? (lang === 'fr' ? 'Bienvenue sur Groundwork — créez votre premier projet' : 'Welcome to Groundwork — open your contractor dashboard')
        : (lang === 'fr' ? 'Bienvenue sur Groundwork — terminez votre profil' : 'Welcome to Groundwork — finish setting up your profile'))
      : userWelcomeSubject(lang, hasProject);
    if (opts.role === 'contractor') {
      const first = (opts.fullName ?? '').trim().split(/\s+/)[0];
      const body = contractorOnboarded
        ? (lang === 'fr'
          ? `Bonjour${first ? ` ${first}` : ''},\n\nBienvenue sur Groundwork par Jalla. Votre compte entrepreneur est prêt — ouvrez votre tableau de bord pour créer votre premier projet et inviter le propriétaire.`
          : `Hi${first ? ` ${first}` : ''},\n\nWelcome to Groundwork by Jalla. Your contractor account is ready — open your dashboard to create your first project and invite the Homeowner.`)
        : (lang === 'fr'
          ? `Bonjour${first ? ` ${first}` : ''},\n\nBienvenue sur Groundwork. Complétez votre profil entrepreneur pour créer des projets et recevoir des invitations clients.`
          : `Hi${first ? ` ${first}` : ''},\n\nWelcome to Groundwork. Complete your contractor onboarding to start managing projects and connecting with Homeowners.`);
      const ctaLabel = contractorOnboarded
        ? (lang === 'fr' ? 'Ouvrir mon tableau de bord' : 'Open contractor dashboard')
        : (lang === 'fr' ? 'Terminer mon profil' : 'Complete onboarding');
      const ctaHref = contractorOnboarded ? `${base}/work` : `${base}/work/onboarding`;
      ({ html, text } = renderStepHtml(lang, body, ctaLabel, ctaHref));
    } else {
      html = buildUserWelcomeHtml(lang, { name: opts.fullName, site: base, hasProject });
    }
  }

  const { from, replyTo } = await resolveSender(svc);
  const sendRes = await sendViaResend({
    from,
    to: email,
    subject,
    html,
    text,
    replyTo,
    idempotencyKey: `welcome/${opts.userId}`,
    tags: [
      { name: 'groundwork_event', value: 'user_signup' },
      { name: 'groundwork_step', value: step?.code || stepCode },
    ],
  });

  if (!sendRes.ok) {
    console.error('[email] direct welcome send failed for', opts.userId, sendRes.error);
    return { sent: false, alreadySent: false, subject, stepCode: step?.code || stepCode, error: sendRes.error };
  }

  try {
    await svc
      .from('profiles')
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq('id', opts.userId);
  } catch {
    // Non-fatal if migration not yet applied; Resend idempotency key + lifecycle_sends still protect against duplicates.
  }

  await logEmailToCrm({ to: email, subject, html, kind: 'other', name: opts.fullName ?? null, from });

  return {
    sent: true,
    alreadySent: false,
    subject,
    stepCode: step?.code || stepCode,
    messageId: sendRes.messageId,
  };
}

export async function sendDirectProjectActivationEmail(
  svc: Svc,
  opts: {
    projectId: string;
    projectName?: string | null;
    ownerId: string;
    email: string;
    fullName?: string | null;
    lang?: string | null;
    role: 'contractor' | 'client';
  },
): Promise<DirectEmailResult> {
  const email = (opts.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { sent: false, alreadySent: false, skippedReason: 'invalid_email' };
  }

  // 1. Check DB idempotency stamp (tolerant if migration has not yet run).
  try {
    const { data } = await svc
      .from('projects')
      .select('activation_email_sent_at')
      .eq('id', opts.projectId)
      .maybeSingle();
    if (data?.activation_email_sent_at) {
      return { sent: false, alreadySent: true };
    }
  } catch {
    // Column may not exist prior to migration; continue with lifecycle_sends check.
  }

  if (await hasRecordedStepSend(svc, email, ['CS09', 'CL05'], opts.projectId)) {
    return { sent: false, alreadySent: true };
  }

  if (await isBlockedOrUnsubscribed(svc, email)) {
    return { sent: false, alreadySent: false, skippedReason: 'unsubscribed_or_blocked' };
  }

  const lang = pickLang(opts.lang);
  const sequenceKey = opts.role === 'contractor' ? 'cs_project' : 'cl_project';
  const stepCode = opts.role === 'contractor' ? 'CS09' : 'CL05';
  const projectName = (opts.projectName ?? '').trim();
  const person: Person = { email, fullName: opts.fullName ?? null, lang };
  const context: Context = {
    project_id: opts.projectId,
    project_name: projectName || undefined,
    recipient_role: opts.role,
  };
  const base = siteUrl();

  const step = await fetchStepOne(svc, sequenceKey);
  let subject: string;
  let html: string;
  let text: string;

  if (step && (step.subject_en || step.subject_fr) && (step.body_en || step.body_fr)) {
    const copy = copyFor(step, lang, person, context);
    const path = ctaPath(step.cta_key, context);
    const ctaUrl = path ? `${base}${path}` : null;
    subject = oneLine(copy.subject);
    ({ html, text } = renderStepHtml(lang, copy.body, copy.cta, ctaUrl, [projectName]));
  } else {
    const first = (opts.fullName ?? '').trim().split(/\s+/)[0];
    const displayProject = projectName || (lang === 'fr' ? 'votre projet' : 'your project');
    if (opts.role === 'contractor') {
      subject = lang === 'fr'
        ? `Votre projet ${displayProject} est prêt sur Groundwork`
        : `Your project ${displayProject} is live on Groundwork`;
      const body = lang === 'fr'
        ? `Bonjour${first ? ` ${first}` : ''},\n\nFélicitations pour la création de ${displayProject} sur Groundwork.\n\nInvitez maintenant votre client afin qu'il puisse suivre chaque étape et valider les paiements.`
        : `Hi${first ? ` ${first}` : ''},\n\nCongratulations on creating ${displayProject} in Groundwork.\n\nYour next step is to invite the Homeowner so they can follow each stage and confirm payments.`;
      const ctaLabel = lang === 'fr' ? 'Inviter mon client' : 'Invite Homeowner';
      ({ html, text } = renderStepHtml(lang, body, ctaLabel, `${base}/work/projects/${opts.projectId}?tab=people`, [projectName]));
    } else {
      subject = lang === 'fr'
        ? `Votre projet ${displayProject} est prêt sur Groundwork`
        : `Your project ${displayProject} is ready on Groundwork`;
      const body = lang === 'fr'
        ? `Bonjour${first ? ` ${first}` : ''},\n\nVotre projet ${displayProject} est maintenant créé sur Groundwork.\n\nInvitez votre entrepreneur pour démarrer le suivi des étapes et des paiements.`
        : `Hi${first ? ` ${first}` : ''},\n\nYour project ${displayProject} is ready in Groundwork.\n\nConnect your contractor next so you can track every stage and verify progress together.`;
      const ctaLabel = lang === 'fr' ? 'Inviter mon entrepreneur' : 'Connect your contractor';
      ({ html, text } = renderStepHtml(lang, body, ctaLabel, `${base}/projects/${opts.projectId}?tab=team`, [projectName]));
    }
  }

  const { from, replyTo } = await resolveSender(svc);
  const sendRes = await sendViaResend({
    from,
    to: email,
    subject,
    html,
    text,
    replyTo,
    idempotencyKey: `activation/${opts.projectId}`,
    tags: [
      { name: 'groundwork_event', value: 'project_created' },
      { name: 'groundwork_step', value: step?.code || stepCode },
    ],
  });

  if (!sendRes.ok) {
    console.error('[email] direct project activation send failed for', opts.projectId, sendRes.error);
    return { sent: false, alreadySent: false, subject, stepCode: step?.code || stepCode, error: sendRes.error };
  }

  try {
    await svc
      .from('projects')
      .update({ activation_email_sent_at: new Date().toISOString() })
      .eq('id', opts.projectId);
  } catch {
    // Non-fatal if migration not yet applied; Resend idempotency key + lifecycle_sends still protect against duplicates.
  }

  await logEmailToCrm({ to: email, subject, html, kind: 'other', name: opts.fullName ?? null, from });

  return {
    sent: true,
    alreadySent: false,
    subject,
    stepCode: step?.code || stepCode,
    messageId: sendRes.messageId,
  };
}
