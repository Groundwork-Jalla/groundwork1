import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';
import { sendViaResend } from '../_lib/resend-send.js';
import { sendWhatsApp } from '../_lib/whatsapp-send.js';
import { senderFor } from '../../src/lib/email/senders.js';

const FROM = senderFor('other');
const SITE = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://tryjalla.com').replace(/\/+$/, '');

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Email + WhatsApp notification when a contractor requests payment for a stage or substage.
 *
 * Security: authenticates the caller via bearer token, confirms they are the primary
 * contractor on the project, and reads the Homeowner's email/phone strictly from the
 * database — never trusting recipient contact details from the browser.
 */
export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await requireUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  const stageId = typeof req.body?.stageId === 'string' ? req.body.stageId.trim() : '';
  const substageId = typeof req.body?.substageId === 'string' && req.body.substageId.trim() ? req.body.substageId.trim() : null;
  const amount = typeof req.body?.amount === 'number' && Number.isFinite(req.body.amount) && req.body.amount > 0 ? req.body.amount : null;
  const currency = typeof req.body?.currency === 'string' && /^[A-Z]{3}$/.test(req.body.currency.trim()) ? req.body.currency.trim() : null;
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';

  if (!stageId) {
    res.status(400).json({ error: 'stageId is required' });
    return;
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const { data: stage } = await admin
    .from('project_stages')
    .select('id, project_id, stage_number, name')
    .eq('id', stageId)
    .maybeSingle();
  if (!stage) {
    res.status(404).json({ error: 'Stage not found' });
    return;
  }

  // Verify the caller is the primary contractor on this project.
  const { data: invite } = await admin
    .from('contractor_invites')
    .select('id')
    .eq('project_id', stage.project_id)
    .eq('contractor_user_id', user.id)
    .eq('status', 'accepted')
    .eq('is_primary', true)
    .maybeSingle();
  if (!invite) {
    res.status(403).json({ error: 'Only the primary contractor may send payment requests' });
    return;
  }

  const [{ data: project }, { data: substage }, { data: clientViewer }, { data: contractorProfile }] = await Promise.all([
    admin.from('projects').select('id, name, user_id').eq('id', stage.project_id).maybeSingle(),
    substageId
      ? admin.from('project_substages').select('id, substage_number, name').eq('id', substageId).eq('stage_id', stageId).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from('project_viewers').select('user_id').eq('project_id', stage.project_id).eq('is_client', true).is('revoked_at', null).not('user_id', 'is', null).limit(1).maybeSingle(),
    admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
  ]);

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const homeownerId = (clientViewer?.user_id as string | null) ?? (project.user_id !== user.id ? (project.user_id as string) : null);
  if (!homeownerId) {
    res.status(200).json({ ok: true, skipped: 'no_homeowner_linked' });
    return;
  }

  const { data: homeowner } = await admin
    .from('profiles')
    .select('full_name, email, preferred_lang, phone, ghl_contact_id')
    .eq('id', homeownerId)
    .maybeSingle();

  if (!homeowner) {
    res.status(200).json({ ok: true, skipped: 'no_homeowner_profile' });
    return;
  }

  const isFr = String(homeowner.preferred_lang ?? '').toLowerCase().startsWith('fr');
  const projectName = String(project.name || (isFr ? 'votre projet' : 'your project'));
  const contractorName = String(contractorProfile?.full_name || (isFr ? 'Votre entrepreneur' : 'Your contractor'));
  const stageDesc = isFr
    ? `Étape ${stage.stage_number} (${stage.name})${substage ? ` · ${substage.name}` : ''}`
    : `Stage ${stage.stage_number} (${stage.name})${substage ? ` · ${substage.name}` : ''}`;
  const formattedAmt = amount != null && currency
    ? `${amount.toLocaleString(isFr ? 'fr-FR' : 'en-US', { maximumFractionDigits: 2 })} ${currency}`
    : null;
  const stageUrl = `${SITE}/projects/${project.id}?tab=stages&stage=${stage.id}`;

  const subject = isFr
    ? `Demande de paiement — ${projectName} (Étape ${stage.stage_number})`
    : `Payment requested — ${projectName} (Stage ${stage.stage_number})`;

  const greeting = homeowner.full_name
    ? (isFr ? `Bonjour ${homeowner.full_name},` : `Hi ${homeowner.full_name},`)
    : (isFr ? 'Bonjour,' : 'Hi,');

  const lead = isFr
    ? `${contractorName} a demandé un paiement pour ${stageDesc} sur « ${projectName} »${formattedAmt ? ` d’un montant de ${formattedAmt}` : ''}.`
    : `${contractorName} has requested payment for ${stageDesc} on “${projectName}”${formattedAmt ? ` in the amount of ${formattedAmt}` : ''}.`;

  const actionLine = isFr
    ? 'Une fois le paiement effectué directement à votre entrepreneur, téléversez votre reçu sur Groundwork afin de poursuivre les travaux.'
    : 'Once you have paid your contractor directly, upload your payment receipt on Groundwork so work can proceed.';

  const ctaLabel = isFr ? 'Ouvrir l’étape et ajouter le reçu' : 'Open stage & upload receipt';

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#111;max-width:560px">
      <p style="margin:0 0 14px">${esc(greeting)}</p>
      <p style="margin:0 0 14px">${esc(lead)}</p>
      ${note ? `<p style="margin:0 0 14px;padding:10px 12px;background:#f5f5f5;border-radius:8px">${esc(note)}</p>` : ''}
      <p style="margin:0 0 18px">${esc(actionLine)}</p>
      <p style="margin:20px 0"><a href="${esc(stageUrl)}" style="background:#1f4d3a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${esc(ctaLabel)}</a></p>
      <p style="margin:24px 0 0;color:#777;font-size:12px">Groundwork by Jalla</p>
    </div>
  `;

  const whatsappBody = [
    greeting,
    lead,
    note || null,
    `${ctaLabel}: ${stageUrl}`,
  ].filter(Boolean).join('\n\n');

  const email = (homeowner.email as string | null)?.trim() || '';
  const emailPromise = email
    ? sendViaResend({ from: FROM, to: email, subject, html }).catch(() => ({ ok: false }))
    : Promise.resolve({ ok: false, skipped: 'no_email' });

  const phone = (homeowner.phone as string | null)?.trim() || null;
  const contactId = (homeowner.ghl_contact_id as string | null)?.trim() || null;
  const whatsappPromise = (phone || contactId)
    ? sendWhatsApp(admin, { phone, contactId, conversationId: null }, whatsappBody).catch(() => ({ ok: false }))
    : Promise.resolve({ ok: false, skipped: 'no_phone' });

  const [emailResult, whatsappResult] = await Promise.all([emailPromise, whatsappPromise]);
  res.status(200).json({ ok: true, email: emailResult.ok, whatsapp: whatsappResult.ok });
}
