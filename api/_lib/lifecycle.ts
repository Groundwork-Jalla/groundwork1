import { sendWhatsApp } from './whatsapp-send.js';
import { senderFor } from '../../src/lib/email/senders.js';
import { logEmailToCrm } from '../ghl/_email-log.js';

// =========================================================
// Lifecycle sequences — the engine.
//
// `enrollForEvent` is called from forwardToGhl for every lifecycle event; the scheduler
// (`lifecycle-run`) sends whatever is due. Both are best-effort and never throw into
// the caller: a sequence problem must not break signup.
// =========================================================

type Svc = { from: (t: string) => any; rpc: (name: string, args: Record<string, unknown>) => any };

export interface Person {
  email: string;
  fullName?: string | null;
  phone?: string | null;
  lang?: string | null;
}

export interface Step {
  position: number;
  delay_hours: number;
  channel: 'email' | 'whatsapp';
  code?: string;
  subject_en: string; subject_fr: string;
  body_en: string; body_fr: string;
  cta_key?: string; cta_label_en?: string; cta_label_fr?: string;
}

/** What a message can say about the project and the other party. Stored on the enrolment. */
export interface Context {
  project_id?: string;
  project_name?: string;
  client_name?: string;
  contractor_name?: string;
  invite_path?: string;
  entry_source?: string;
  recipient_role?: string;
}

const HOUR = 3_600_000;

export function pickLang(lang: string | null | undefined): 'en' | 'fr' {
  return String(lang ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

const firstOf = (name: string | null | undefined) => {
  const n = (name ?? '').trim();
  return n && !n.includes('@') ? n.split(/\s+/)[0] : '';
};

/**
 * {{first_name}}, {{name}}, {{email}} and, from the enrolment context, {{project_name}},
 * {{client_name}}, {{contractor_name}}, {{client_first_name}}, {{contractor_first_name}}.
 * A missing first name reads "there"; any other unknown tag is blanked, never printed.
 */
export function render(text: string, p: Person, ctx: Context = {}): string {
  const name = (p.fullName ?? '').trim();
  const vars: Record<string, string> = {
    first_name: firstOf(name) || 'there',
    name,
    email: p.email,
    project_name: ctx.project_name ?? 'your project',
    client_name: ctx.client_name ?? '',
    contractor_name: ctx.contractor_name ?? '',
    client_first_name: firstOf(ctx.client_name) || 'there',
    contractor_first_name: firstOf(ctx.contractor_name) || 'there',
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
}

export function copyFor(step: Step, lang: string | null | undefined, p: Person, ctx: Context = {}) {
  const fr = pickLang(lang) === 'fr';
  const subject = (fr ? step.subject_fr : step.subject_en) || step.subject_en;
  const body = (fr ? step.body_fr : step.body_en) || step.body_en;
  const cta = (fr ? step.cta_label_fr : step.cta_label_en) || step.cta_label_en || '';
  return { subject: render(subject, p, ctx), body: render(body, p, ctx), cta: render(cta, p, ctx) };
}

/** Where the button on a step takes the reader. Always the exact unfinished screen. */
export function ctaPath(key: string | undefined, ctx: Context): string | null {
  const pid = ctx.project_id;
  const contractor = ctx.recipient_role === 'contractor';
  switch (key) {
    case 'onboarding': return '/work/onboarding';
    case 'create_project': return '/projects/new';
    case 'invite_client': return pid ? `/work/projects/${pid}?tab=people` : '/work/projects';
    case 'connect_contractor': return pid ? `/projects/${pid}?tab=team` : '/dashboard';
    case 'open_project':
      return pid ? (contractor ? `/work/projects/${pid}` : `/projects/${pid}`) : (contractor ? '/work' : '/dashboard');
    case 'invitation': return ctx.invite_path || (contractor ? '/work' : '/dashboard');
    default: return null;
  }
}

export function emailHtml(body: string, cta: string, url: string | null): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paras = body.split(/\n{2,}/).map(t => `<p style="margin:0 0 16px">${esc(t).replace(/\n/g, '<br>')}</p>`).join('');
  const button = cta && url
    ? `<p style="margin:24px 0"><a href="${esc(url)}" style="background:#1f4d3a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${esc(cta)}</a></p>`
    : '';
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#111;max-width:560px">${paras}${button}<p style="margin:24px 0 0;color:#777;font-size:12px">Groundwork by Jalla</p></div>`;
}

/** A sequence for one audience never reaches somebody whose role is unknown. */
export function audienceMatches(audience: string, role: string | null | undefined): boolean {
  if (audience === 'any') return true;
  return !!role && audience === role;
}

/** Every key the sequence pins (entry_source, inviter_role…) must equal the event's field. */
export function matchesFields(match: Record<string, unknown> | null | undefined, fields: Record<string, unknown>): boolean {
  return Object.entries(match ?? {}).every(([k, v]) => String(fields[k] ?? '') === String(v));
}

/** When the person should next hear from us, or null when the journey is over. */
export function nextDue(
  steps: Pick<Step, 'position' | 'delay_hours'>[],
  afterPosition: number,
  enrolledAt: Date,
  followupAfterDays: number | null,
  _now: Date,
): { position: number; at: Date } | { followupAt: Date } | null {
  const next = steps.filter(s => s.position > afterPosition).sort((a, b) => a.position - b.position)[0];
  if (next) {
    const hours = steps.filter(step => step.position <= next.position).reduce((sum, step) => sum + step.delay_hours, 0);
    return { position: next.position, at: new Date(enrolledAt.getTime() + hours * HOUR) };
  }
  if (followupAfterDays) return { followupAt: new Date(enrolledAt.getTime() + followupAfterDays * 24 * HOUR) };
  return null;
}

const strField = (f: Record<string, unknown>, k: string) => (typeof f[k] === 'string' ? (f[k] as string) : '');

/** The person who invited this contact, when the event carries one. Read from the record, never the event. */
async function inviterOf(svc: Svc, fields: Record<string, unknown>) {
  const id = strField(fields, 'inviter_user_id');
  if (!id) return null;
  const { data } = await svc.from('profiles').select('email, full_name, preferred_lang').eq('id', id).limit(1);
  const row = (data ?? [])[0];
  const email = String(row?.email ?? '').trim().toLowerCase();
  return email ? { email, fullName: ((row?.full_name as string | null) || strField(fields, 'inviter_name')) || null, lang: row?.preferred_lang as string | null } : null;
}

export async function enrollForEvent(
  svc: Svc,
  event: string,
  person: Person,
  fields: Record<string, unknown> = {},
  now = new Date(),
): Promise<{ exited: number; enrolled: number }> {
  const out = { exited: 0, enrolled: 0 };
  try {
    const email = person.email.trim().toLowerCase();
    if (!email) return out;

    const { data: seqs } = await svc.from('lifecycle_sequences').select('*');
    const all = (seqs ?? []) as any[];
    const projectId = strField(fields, 'project_id');
    const inviter = await inviterOf(svc, fields);

    // Exits first, so a person who triggers and exits in one event is not re-enrolled.
    // An event ends the sequences that wait on THIS person (their own, or the ones an
    // inviter is running about them) and, for the project it names, the inviter's own
    // reminders about that project — "client_invited" ends the contractor's
    // "invite your client" nudges.
    const exiting = all.filter(s => (s.exit_events ?? []).includes(event)).map(s => s.key);
    if (exiting.length) {
      const { data: open } = await svc.from('lifecycle_enrollments').select('id, email, subject_email, ref')
        .eq('status', 'active').in('sequence_key', exiting);
      const ids = ((open ?? []) as any[]).filter(r =>
        ((!projectId || !r.ref || r.ref === projectId || r.ref.startsWith(`${projectId}:`)) && (r.email === email || r.subject_email === email)) ||
        (!!inviter && !!projectId && r.email === inviter.email && (r.ref === projectId || r.ref?.startsWith(`${projectId}:`))),
      ).map(r => r.id);
      if (ids.length) {
        await svc.from('lifecycle_enrollments')
          .update({ status: 'exited', exit_reason: event, next_send_at: null }).in('id', ids);
        await svc.from('followup_queue')
          .update({ status: 'done', resolved_at: now.toISOString(), note: `Auto-closed: ${event}` })
          .eq('status', 'open').in('enrollment_id', ids);
      }
      out.exited = ids.length;
    }

    // A fresh primary invitation gets a fresh clock. Retire the earlier token's
    // reminders, including the inviter's copy, before starting its replacement.
    const invitationPath = strField(fields, 'invite_path');
    if (projectId && invitationPath && ['client_invited', 'contractor_invited'].includes(event)) {
      const keys = all.filter(sequence => sequence.trigger_event === event).map(sequence => sequence.key);
      if (keys.length) {
        const previous = await svc.from('lifecycle_enrollments').select('id,context').eq('status', 'active').in('sequence_key', keys);
        if (previous.error) throw previous.error;
        const ids = (previous.data ?? []).filter((row: any) => row.context?.project_id === projectId && row.context?.invite_path && row.context.invite_path !== invitationPath).map((row: any) => row.id);
        if (ids.length) {
          const changed = await svc.from('lifecycle_enrollments').update({ status: 'exited', exit_reason: 'invitation_replaced', next_send_at: null }).in('id', ids);
          if (changed.error) throw changed.error;
          await svc.from('followup_queue').update({ status: 'done', resolved_at: now.toISOString(), note: 'Auto-closed: invitation replaced' }).eq('status', 'open').in('enrollment_id', ids);
          out.exited += ids.length;
        }
      }
    }

    // A client who said they have no project to bring is not nudged about one.
    const optedOut = fields.client_intent === 'no_client';

    for (const s of all.filter(x => x.enabled && x.trigger_event === event)) {
      const toInviter = s.recipient === 'inviter';
      const target = toInviter ? inviter : { email, fullName: person.fullName ?? null, lang: person.lang ?? null };
      if (!target || optedOut) continue;
      const role = toInviter ? strField(fields, 'inviter_role') : strField(fields, 'user_role');
      if (!audienceMatches(s.audience, role) || !matchesFields(s.match, fields)) continue;

      // An invitee's own context overrides the generic welcome (§2 rule 6).
      if (s.skip_if_active_in?.length) {
        const { data: busy } = await svc.from('lifecycle_enrollments').select('id')
          .eq('status', 'active').eq('email', target.email).in('sequence_key', s.skip_if_active_in).limit(1);
        if ((busy ?? []).length) continue;
      }

      const { data: reminderSteps, error: stepError } = await svc.from('lifecycle_sequence_steps')
        .select('*').eq('sequence_key', s.key).order('position');
      if (stepError) throw stepError;
      const first = (reminderSteps ?? []).slice(0, 1) as Step[];
      if (!first.length) continue;

      const contactName = person.fullName || person.email;
      const otherName = inviter?.fullName || strField(fields, 'inviter_name') || inviter?.email || '';
      const contactIsContractor = strField(fields, 'user_role') === 'contractor';
      const hasOther = !!inviter;
      const context: Context = {
        project_id: projectId || undefined,
        project_name: strField(fields, 'project_name') || undefined,
        client_name: (contactIsContractor ? (hasOther ? otherName : '') : contactName) || undefined,
        contractor_name: (contactIsContractor ? contactName : (hasOther ? otherName : '')) || undefined,
        invite_path: strField(fields, 'invite_path') || undefined,
        entry_source: strField(fields, 'entry_source') || undefined,
        recipient_role: role || undefined,
      };
      // When the inviter is the recipient, "the client"/"the contractor" is the invitee.
      if (toInviter) {
        const inviterIsContractor = role === 'contractor';
        context.contractor_name = inviterIsContractor ? (target.fullName || target.email) : contactName;
        context.client_name = inviterIsContractor ? contactName : (target.fullName || target.email);
      }

      const deliveredInvitation = !toInviter && fields.invitation_email_sent === true && ['CI01', 'IV01'].includes(first[0].code ?? '');
      const alreadyDeliveredNext = deliveredInvitation ? nextDue(reminderSteps ?? [], first[0].position, now, s.followup_after_days, now) : null;
      const nextPosition = deliveredInvitation ? (alreadyDeliveredNext && 'position' in alreadyDeliveredNext ? alreadyDeliveredNext.position : first[0].position + 1) : first[0].position;
      const { error, data } = await svc.from('lifecycle_enrollments').upsert({
        sequence_key: s.key, email: target.email, full_name: target.fullName ?? null,
        phone: toInviter ? null : person.phone ?? null,
        lang: pickLang(target.lang ?? person.lang), user_role: role || null, status: deliveredInvitation && !alreadyDeliveredNext ? 'completed' : 'active', next_position: nextPosition,
        next_send_at: deliveredInvitation
          ? (alreadyDeliveredNext && 'at' in alreadyDeliveredNext ? alreadyDeliveredNext.at : alreadyDeliveredNext && 'followupAt' in alreadyDeliveredNext ? alreadyDeliveredNext.followupAt : null)?.toISOString() ?? null
          : new Date(now.getTime() + first[0].delay_hours * HOUR).toISOString(),
        ...(deliveredInvitation ? { last_sent_at: now.toISOString(), last_step_code: first[0].code, emails_sent: 1 } : {}),
        enrolled_at: now.toISOString(),
        ref: (toInviter ? `${projectId}:${email}` : projectId) + (invitationPath && ['client_invited', 'contractor_invited'].includes(event) ? `:${invitationPath.split('/').pop()}` : ''),
        subject_email: toInviter ? email : null,
        context,
      }, { onConflict: 'sequence_key,email,ref', ignoreDuplicates: true }).select('id');
      if (!error && (data ?? []).length) {
        out.enrolled++;
        if (deliveredInvitation) {
          const enrollmentId = data[0].id;
          const history = await svc.from('lifecycle_sends').insert({ enrollment_id: enrollmentId, sequence_key: s.key,
            position: first[0].position, email, channel: 'email', status: 'sent', step_code: first[0].code,
            subject: strField(fields, 'invitation_email_subject') || copyFor(first[0], person.lang, person, context).subject });
          if (history.error) throw history.error;

        }
      }
    }

    // The immediate messages (delay 0) go out now rather than at the next hourly run.
    if (out.enrolled) await runDue(svc, now, 20).catch(() => undefined);
  } catch (e) {
    console.error('[lifecycle] enroll failed:', e instanceof Error ? e.message : e);
  }
  return out;
}

interface EmailPayload { from: string; to: string; subject: string; html: string; text: string; }

async function sendEmail(payload: EmailPayload, idempotencyKey: string): Promise<{ ok: boolean; error?: string; providerId?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return { ok: false, error: `resend_${response.status}` };
    const result = await response.json().catch(() => ({}));
    if (typeof result.id !== 'string') return { ok: false, error: 'resend_response_invalid' };
    // The durable send outcome is recorded before the optional CRM mirror.
    return { ok: true, providerId: result.id };
  } catch {
    return { ok: false, error: 'resend_connection_uncertain' };
  }
}

const siteBase = () => (process.env.PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');

/** Who a human should ring first: a referral or outreach lead, or anyone tied to a live project. */
export function followupPriority(ctx: Context): 'high' | 'normal' {
  return ctx.project_id || ctx.entry_source === 'referral' || ctx.entry_source === 'direct_outreach' ? 'high' : 'normal';
}

/** Late jobs send the latest due reminder, rather than a burst of obsolete reminders. */
export function dueStep(steps: Step[], afterPosition: number, enrolledAt: Date, now: Date): Step | undefined {
  let hours = 0;
  let selected: Step | undefined;
  for (const step of [...steps].sort((a, b) => a.position - b.position)) {
    hours += step.delay_hours;
    if (step.position >= afterPosition && enrolledAt.getTime() + hours * HOUR <= now.getTime()) selected = step;
  }
  return selected;
}

async function rpc(svc: Svc, name: string, args: Record<string, unknown>) {
  const result = await svc.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
}

async function dueEnrollments(svc: Svc, now: Date, limit: number) {
  const { data: sequences, error } = await svc.from('lifecycle_sequences').select('*').eq('enabled', true);
  if (error) throw error;
  const bySeq = new Map<string, any>(((sequences ?? []) as any[]).map(sequence => [sequence.key, sequence]));
  if (!bySeq.size) return { bySeq, due: [] as any[] };
  const result = await svc.from('lifecycle_enrollments').select('*').eq('status', 'active')
    .lte('next_send_at', now.toISOString()).in('sequence_key', [...bySeq.keys()]).order('next_send_at').limit(limit);
  if (result.error) throw result.error;
  return { bySeq, due: (result.data ?? []) as any[] };
}

/** Read-only operational check for admin testing. No claims, updates or provider calls. */
export async function previewDue(svc: Svc, now = new Date(), limit = 50) {
  const { due } = await dueEnrollments(svc, now, limit);
  const rows = [];
  for (const enrollment of due) {
    const state = await rpc(svc, 'lifecycle_enrollment_state', { p_enrollment: enrollment.id });
    const { data: steps, error } = await svc.from('lifecycle_sequence_steps').select('*').eq('sequence_key', enrollment.sequence_key).order('position');
    if (error) throw error;
    const step = dueStep(steps ?? [], enrollment.next_position, new Date(enrollment.enrolled_at), now);
    const copy = step ? copyFor(step, enrollment.lang, { email: enrollment.email, fullName: enrollment.full_name }, enrollment.context ?? {}) : null;
    const futureStep = !step && (steps ?? []).some((item: Step) => item.position >= enrollment.next_position);
    rows.push({ enrollmentId: enrollment.id, sequence: enrollment.sequence_key, recipient: enrollment.email,
      state: futureStep && state?.kind === 'ready' ? 'hold' : state?.kind ?? 'unavailable',
      reason: futureStep && state?.kind === 'ready' ? 'next_reminder_not_due' : state?.reason ?? 'state_unavailable',
      step: step?.code ?? null, channel: step?.channel ?? null, subject: copy?.subject ?? null,
      whatsappPaused: step?.channel === 'whatsapp' && process.env.LIFECYCLE_WHATSAPP_ENABLED !== 'true' });
  }
  return { checked: rows.length, ready: rows.filter(row => row.state === 'ready' && !row.whatsappPaused).length, rows };
}

export async function runDue(svc: Svc, now = new Date(), limit = 50) {
  const tally = { sent: 0, failed: 0, followups: 0, skipped: 0 };
  const { bySeq, due } = await dueEnrollments(svc, now, limit);
  for (const candidate of due) {
    let enrollment: any;
    try {
      enrollment = await rpc(svc, 'claim_lifecycle_enrollment', { p_enrollment: candidate.id });
      if (!enrollment) { tally.skipped++; continue; }
      const seq = bySeq.get(enrollment.sequence_key);
      const { data: stepRows, error: stepError } = await svc.from('lifecycle_sequence_steps')
        .select('*').eq('sequence_key', enrollment.sequence_key).order('position');
      if (stepError) throw stepError;
      const steps = (stepRows ?? []) as Step[];
      const { data: prior, error: priorError } = await svc.from('lifecycle_deliveries').select('position,status')
        .eq('enrollment_id', enrollment.id).gte('position', enrollment.next_position).in('status', ['prepared', 'failed', 'blocked']).order('position').limit(1);
      if (priorError) throw priorError;
      // Resolve an already-started request with the same immutable payload and key.
      const pendingPosition = (prior ?? [])[0]?.position;
      const step = pendingPosition === undefined
        ? dueStep(steps, enrollment.next_position, new Date(enrollment.enrolled_at), now)
        : steps.find(item => item.position === pendingPosition);
      const finish = (outcome: string, error?: string, providerId?: string) => rpc(svc, 'finish_lifecycle_delivery', {
        p_enrollment: enrollment.id, p_token: enrollment.processing_token,
        p_position: step?.position ?? enrollment.next_position, p_outcome: outcome,
        p_error: error ?? null, p_provider_id: providerId ?? null,
      });
      if (!step) {
        if (await finish('complete') && seq.followup_after_days) {
          const result = await svc.from('lifecycle_enrollments').select('followup_queued').eq('id', enrollment.id).limit(1);
          if (result.error) throw result.error;
          if (result.data?.[0]?.followup_queued) tally.followups++;
        }
        continue;
      }
      if (step.channel === 'whatsapp' && process.env.LIFECYCLE_WHATSAPP_ENABLED !== 'true') {
        if (await finish('skipped', 'whatsapp_outreach_paused')) tally.skipped++;
        continue;
      }
      const person: Person = { email: enrollment.email, fullName: enrollment.full_name, phone: enrollment.phone, lang: enrollment.lang };
      const context: Context = enrollment.context ?? {};
      const { subject, body, cta } = copyFor(step, enrollment.lang, person, context);
      const path = ctaPath(step.cta_key, context);
      const base = siteBase();
      if (step.channel === 'email' && cta && path && !base) {
        await finish('failed', 'PUBLIC_SITE_URL not set'); tally.failed++; continue;
      }
      const url = path && base ? base + path : null;
      const payload: EmailPayload = { from: senderFor('other'), to: enrollment.email, subject,
        html: emailHtml(body, cta, url), text: url && cta ? `${body}\n\n${cta}: ${url}` : body };
      const delivery = await rpc(svc, 'prepare_lifecycle_delivery', { p_enrollment: enrollment.id,
        p_token: enrollment.processing_token, p_position: step.position, p_payload: payload });
      if (!delivery) { tally.skipped++; continue; }
      if (delivery.status === 'blocked') { tally.failed++; continue; }
      let result: { ok: boolean; error?: string; providerId?: string };
      if (delivery.status === 'sent') result = { ok: true, providerId: delivery.provider_id };
      else if (step.channel === 'whatsapp') {
        if (!enrollment.phone) result = { ok: false, error: 'no_phone' };
        else {
          const sent = await sendWhatsApp(svc, { phone: enrollment.phone, contactId: null, conversationId: null }, delivery.payload.text);
          result = sent.ok ? { ok: true } : { ok: false, error: sent.error };
        }
      } else result = await sendEmail(delivery.payload, `lifecycle/${enrollment.id}/${step.position}`);
      const outcome = result.ok ? 'sent' : result.error === 'no_phone' ? 'skipped' : 'failed';
      const recorded = await finish(outcome, result.error, result.providerId);
      if (!recorded) { tally.skipped++; continue; }
      if (result.ok) {
        if (delivery.status === 'sent') tally.skipped++; else tally.sent++;
        if (step.channel === 'email' && delivery.status !== 'sent') {
          await logEmailToCrm({ to: delivery.payload.to, subject: delivery.payload.subject, html: delivery.payload.html, kind: 'other' });
        }
      } else if (outcome === 'skipped') tally.skipped++;
      else tally.failed++;
    } catch (error) {
      if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(String((error as { code?: string })?.code ?? ''))) throw error;
      // The lease expires if a database/process failure prevents finalization. The
      // next run reuses the durable delivery payload and provider idempotency key.
      console.error('[lifecycle] delivery not finalized; retry with the existing delivery record');
      tally.failed++;
    }
  }
  return tally;
}
