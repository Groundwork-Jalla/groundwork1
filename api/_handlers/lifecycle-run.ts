import { previewDue, runDue } from '../_lib/lifecycle.js';
import { getSupabaseAdmin } from '../_lib/stripe.js';
import { sendQueuedCommunicationReplies } from '../_lib/communication-email.js';
import { timingSafeEqual } from 'node:crypto';
import { runWhatsApp } from '../_lib/whatsapp-communications.js';

// Sends whatever lifecycle step is due. Callable by the scheduler (Vercel cron sends
// `Authorization: Bearer $CRON_SECRET`) or by an admin's own session ("Run now").

export async function handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const bearer = String(req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '');
  const cron = process.env.CRON_SECRET?.trim();
  let allowed = !!cron && Buffer.byteLength(bearer) === Buffer.byteLength(cron) && timingSafeEqual(Buffer.from(bearer), Buffer.from(cron));

  if (!allowed && bearer) {
    const { createClient } = await import('@supabase/supabase-js');
    const asCaller = createClient(url, process.env.VITE_SUPABASE_ANON_KEY ?? serviceKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await asCaller.rpc('is_admin');
    allowed = data === true;
  }
  if (!allowed) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const preview = req.body?.preview === true;
    const svc = getSupabaseAdmin();
    if (preview) { res.status(200).json({ ok: true, preview, ...await previewDue(svc) }); return; }
    const run = await svc.from('communication_runs').insert({}).select('id').single();
    if (run.error) throw run.error;
    let result;
    try {
      const followups = await svc.rpc('review_communication_followups');
      if (followups.error) throw followups.error;
      const replies = await sendQueuedCommunicationReplies(svc,new Date(),3);
      const email = await runDue(svc, new Date(), 20,100_000);
      // Independent of email's enable switch, reply domain and progression cursor.
      const whatsapp = await runWhatsApp(svc,8,60_000);
      result = { ...email, replies, whatsapp, followupReview: followups.data };
      const saved = await svc.from('communication_runs').update({ status: 'complete', finished_at: new Date().toISOString(), counts: result }).eq('id', run.data.id);
      if (saved.error) throw saved.error;
    } catch (error) {
      await svc.from('communication_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error: 'communication_run_failed' }).eq('id', run.data.id);
      throw error;
    }
    res.status(200).json({ ok: true, preview, ...result });
  } catch (e) {
    console.error('[lifecycle-run]', e instanceof Error ? e.message : e);
    const missing = ['PGRST202', 'PGRST205', '42883', '42P01'].includes(String((e as { code?: string })?.code ?? ''));
    res.status(missing ? 503 : 500).json({ error: missing ? 'Apply the lifecycle delivery migration before running reminders.' : 'Run failed' });
  }
}
