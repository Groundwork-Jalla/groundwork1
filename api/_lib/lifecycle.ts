import { sendWhatsApp } from './whatsapp-send.js';
import { senderFor } from '../../src/lib/email/senders.js';

// =========================================================
// Lifecycle sequences — the engine.
//
// `enrollForEvent` is called from forwardToGhl for every lifecycle event; the scheduler
// (`lifecycle-run`) sends whatever is due. Both are best-effort and never throw into
// the caller: a sequence problem must not break signup.
// =========================================================

type Svc = { from: (t: string) => any };

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
    case 'create_project': return contractor ? '/work/projects' : '/projects/new';
    case 'invite_client': return pid ? `/work/projects/${pid}` : '/work/projects';
    case 'connect_contractor': return pid ? `/projects/${pid}` : '/dashboard';
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
    ? `<p style="margin:24px 0"><a href="${esc(url)}" style="background:#1a56db;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${esc(cta)}</a></p>`
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
  now: Date,
): { position: number; at: Date } | { followupAt: Date } | null {
  const next = steps.filter(s => s.position > afterPosition).sort((a, b) => a.position - b.position)[0];
  if (next) return { position: next.position, at: new Date(now.getTime() + next.delay_hours * HOUR) };
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
        r.email === email || r.subject_email === email ||
        (!!inviter && !!projectId && r.email === inviter.email && r.ref === projectId),
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

      const { data: first } = await svc.from('lifecycle_sequence_steps')
        .select('delay_hours').eq('sequence_key', s.key).order('position').limit(1);
      if (!first?.length) continue;

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

      const { error, data } = await svc.from('lifecycle_enrollments').upsert({
        sequence_key: s.key, email: target.email, full_name: target.fullName ?? null,
        phone: toInviter ? null : person.phone ?? null,
        lang: pickLang(target.lang ?? person.lang), user_role: role || null, status: 'active', next_position: 1,
        next_send_at: new Date(now.getTime() + first[0].delay_hours * HOUR).toISOString(),
        enrolled_at: now.toISOString(),
        ref: toInviter ? `${projectId}:${email}` : projectId,
        subject_email: toInviter ? email : null,
        context,
      }, { onConflict: 'sequence_key,email,ref', ignoreDuplicates: true }).select('id');
      if (!error && (data ?? []).length) out.enrolled++;
    }

    // The immediate messages (delay 0) go out now rather than at the next hourly run.
    if (out.enrolled) await runDue(svc, now, 20).catch(() => undefined);
  } catch (e) {
    console.error('[lifecycle] enroll failed:', e instanceof Error ? e.message : e);
  }
  return out;
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: senderFor('other'), to, subject, text, html }),
  });
  return res.ok ? { ok: true as const } : { ok: false as const, error: `resend_${res.status}` };
}

const siteBase = () => (process.env.PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');

/** Who a human should ring first: a referral or outreach lead, or anyone tied to a live project. */
export function followupPriority(ctx: Context): 'high' | 'normal' {
  return ctx.project_id || ctx.entry_source === 'referral' || ctx.entry_source === 'direct_outreach' ? 'high' : 'normal';
}

export async function runDue(svc: Svc, now = new Date(), limit = 50) {
  const tally = { sent: 0, failed: 0, followups: 0, skipped: 0 };
  const { data: seqs } = await svc.from('lifecycle_sequences').select('*').eq('enabled', true);
  const bySeq = new Map<string, any>(((seqs ?? []) as any[]).map(s => [s.key, s]));
  if (!bySeq.size) return tally;

  const { data: due } = await svc.from('lifecycle_enrollments').select('*')
    .eq('status', 'active').lte('next_send_at', now.toISOString())
    .in('sequence_key', [...bySeq.keys()]).limit(limit);

  for (const e of (due ?? []) as any[]) {
    const seq = bySeq.get(e.sequence_key);
    const { data: stepRows } = await svc.from('lifecycle_sequence_steps')
      .select('*').eq('sequence_key', e.sequence_key).order('position');
    const steps = (stepRows ?? []) as Step[];
    const step = steps.find(s => s.position === e.next_position);
    const enrolledAt = new Date(e.enrolled_at);
    const person: Person = { email: e.email, fullName: e.full_name, phone: e.phone, lang: e.lang };
    const ctx: Context = e.context ?? {};

    if (!step) {
      // Journey over: hand the person to a human, once, with the reason and a due date.
      if (seq.followup_after_days) {
        await svc.from('followup_queue').upsert({
          enrollment_id: e.id, sequence_key: e.sequence_key, email: e.email,
          full_name: e.full_name, phone: e.phone,
          reason: `No action after Day ${seq.followup_after_days}: ${seq.awaiting_action || 'next step'} (${e.emails_sent ?? 0} emails sent, last ${e.last_step_code ?? 'none'})`,
          priority: followupPriority(ctx),
          due_at: new Date(now.getTime() + 24 * HOUR).toISOString(),
          context: ctx,
        }, { onConflict: 'sequence_key,email', ignoreDuplicates: true });
        tally.followups++;
      }
      await svc.from('lifecycle_enrollments')
        .update({ status: 'completed', next_send_at: null, followup_queued: !!seq.followup_after_days })
        .eq('id', e.id);
      continue;
    }

    const { subject, body, cta } = copyFor(step, e.lang, person, ctx);
    let result: { ok: boolean; error?: string };
    if (step.channel === 'whatsapp') {
      if (!e.phone) result = { ok: false, error: 'no_phone' };
      else {
        const r = await sendWhatsApp(svc, { phone: e.phone, contactId: null, conversationId: null }, body);
        result = r.ok ? { ok: true } : { ok: false, error: r.error };
      }
    } else {
      const path = ctaPath(step.cta_key, ctx);
      const base = siteBase();
      if (cta && path && !base) result = { ok: false, error: 'PUBLIC_SITE_URL not set' };
      else {
        const url = path && base ? base + path : null;
        result = await sendEmail(e.email, subject, emailHtml(body, cta, url), url && cta ? `${body}\n\n${cta}: ${url}` : body);
      }
    }

    const skipped = !result.ok && result.error === 'no_phone';
    await svc.from('lifecycle_sends').insert({
      enrollment_id: e.id, sequence_key: e.sequence_key, position: step.position, email: e.email,
      channel: step.channel, status: result.ok ? 'sent' : skipped ? 'skipped' : 'failed', error: result.error ?? null,
      step_code: step.code || null, subject,
    });
    if (result.ok) tally.sent++; else if (skipped) tally.skipped++; else tally.failed++;

    // A failed send is retried on the next run, not skipped past.
    if (!result.ok && !skipped) continue;

    const sentPatch = result.ok
      ? { last_sent_at: now.toISOString(), last_step_code: step.code || null, emails_sent: (e.emails_sent ?? 0) + 1 }
      : {};
    const nxt = nextDue(steps, step.position, enrolledAt, seq.followup_after_days ?? null, now);
    if (nxt && 'position' in nxt) {
      await svc.from('lifecycle_enrollments')
        .update({ ...sentPatch, next_position: nxt.position, next_send_at: nxt.at.toISOString() }).eq('id', e.id);
    } else if (nxt) {
      await svc.from('lifecycle_enrollments')
        .update({ ...sentPatch, next_position: step.position + 1, next_send_at: (nxt.followupAt > now ? nxt.followupAt : now).toISOString() })
        .eq('id', e.id);
    } else {
      await svc.from('lifecycle_enrollments')
        .update({ ...sentPatch, status: 'completed', next_send_at: null }).eq('id', e.id);
    }
  }
  return tally;
}
