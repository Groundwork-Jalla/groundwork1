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
  subject_en: string; subject_fr: string;
  body_en: string; body_fr: string;
}

const HOUR = 3_600_000;

export function pickLang(lang: string | null | undefined): 'en' | 'fr' {
  return String(lang ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/** {{first_name}}, {{name}}, {{email}}. Unknown tags are left blank rather than printed. */
export function render(text: string, p: Person): string {
  const name = (p.fullName ?? '').trim();
  const vars: Record<string, string> = {
    first_name: name.split(/\s+/)[0] || '',
    name,
    email: p.email,
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
}

export function copyFor(step: Step, lang: string | null | undefined, p: Person) {
  const fr = pickLang(lang) === 'fr';
  const subject = (fr ? step.subject_fr : step.subject_en) || step.subject_en;
  const body = (fr ? step.body_fr : step.body_en) || step.body_en;
  return { subject: render(subject, p), body: render(body, p) };
}

export function audienceMatches(audience: string, role: string | null | undefined): boolean {
  if (audience === 'any' || !role) return true;
  return audience === role;
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

    // Exits first, so a person who triggers and exits in one event is not re-enrolled.
    const exiting = all.filter(s => (s.exit_events ?? []).includes(event)).map(s => s.key);
    if (exiting.length) {
      const { data } = await svc.from('lifecycle_enrollments')
        .update({ status: 'exited', exit_reason: event, next_send_at: null })
        .eq('email', email).eq('status', 'active').in('sequence_key', exiting).select('id');
      out.exited = (data ?? []).length;
      await svc.from('followup_queue')
        .update({ status: 'done', resolved_at: now.toISOString(), note: `Auto-closed: ${event}` })
        .eq('email', email).eq('status', 'open').in('sequence_key', exiting);
    }

    const role = typeof fields.user_role === 'string' ? fields.user_role : null;
    // A client who said they have no project to bring is not nudged about one.
    const optedOut = fields.client_intent === 'no_client';

    for (const s of all.filter(x => x.enabled && x.trigger_event === event)) {
      if (!audienceMatches(s.audience, role) || optedOut) continue;
      const { data: first } = await svc.from('lifecycle_sequence_steps')
        .select('delay_hours').eq('sequence_key', s.key).order('position').limit(1);
      if (!first?.length) continue;
      const { error, data } = await svc.from('lifecycle_enrollments').upsert({
        sequence_key: s.key, email, full_name: person.fullName ?? null, phone: person.phone ?? null,
        lang: pickLang(person.lang), user_role: role, status: 'active', next_position: 1,
        next_send_at: new Date(now.getTime() + first[0].delay_hours * HOUR).toISOString(),
        enrolled_at: now.toISOString(),
      }, { onConflict: 'sequence_key,email', ignoreDuplicates: true }).select('id');
      if (!error && (data ?? []).length) out.enrolled++;
    }
  } catch (e) {
    console.error('[lifecycle] enroll failed:', e instanceof Error ? e.message : e);
  }
  return out;
}

async function sendEmail(to: string, subject: string, body: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' };
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: senderFor('other'), to, subject, text: body,
      html: `<div style="font-family:sans-serif;white-space:pre-wrap">${esc(body)}</div>`,
    }),
  });
  return res.ok ? { ok: true as const } : { ok: false as const, error: `resend_${res.status}` };
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

    if (!step) {
      // Journey over: hand the person to a human, once.
      if (seq.followup_after_days) {
        await svc.from('followup_queue').upsert({
          enrollment_id: e.id, sequence_key: e.sequence_key, email: e.email,
          full_name: e.full_name, phone: e.phone,
        }, { onConflict: 'sequence_key,email', ignoreDuplicates: true });
        tally.followups++;
      }
      await svc.from('lifecycle_enrollments')
        .update({ status: 'completed', next_send_at: null, followup_queued: !!seq.followup_after_days })
        .eq('id', e.id);
      continue;
    }

    const { subject, body } = copyFor(step, e.lang, person);
    let result: { ok: boolean; error?: string };
    if (step.channel === 'whatsapp') {
      if (!e.phone) result = { ok: false, error: 'no_phone' };
      else {
        const r = await sendWhatsApp(svc, { phone: e.phone, contactId: null, conversationId: null }, body);
        result = r.ok ? { ok: true } : { ok: false, error: r.error };
      }
    } else {
      result = await sendEmail(e.email, subject, body);
    }

    const skipped = !result.ok && result.error === 'no_phone';
    await svc.from('lifecycle_sends').insert({
      enrollment_id: e.id, sequence_key: e.sequence_key, position: step.position, email: e.email,
      channel: step.channel, status: result.ok ? 'sent' : skipped ? 'skipped' : 'failed', error: result.error ?? null,
    });
    if (result.ok) tally.sent++; else if (skipped) tally.skipped++; else tally.failed++;

    // A failed send is retried on the next run, not skipped past.
    if (!result.ok && !skipped) continue;

    const nxt = nextDue(steps, step.position, enrolledAt, seq.followup_after_days ?? null, now);
    if (nxt && 'position' in nxt) {
      await svc.from('lifecycle_enrollments')
        .update({ next_position: nxt.position, next_send_at: nxt.at.toISOString() }).eq('id', e.id);
    } else if (nxt) {
      await svc.from('lifecycle_enrollments')
        .update({ next_position: step.position + 1, next_send_at: (nxt.followupAt > now ? nxt.followupAt : now).toISOString() })
        .eq('id', e.id);
    } else {
      await svc.from('lifecycle_enrollments')
        .update({ status: 'completed', next_send_at: null }).eq('id', e.id);
    }
  }
  return tally;
}
