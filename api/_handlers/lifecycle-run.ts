import { runDue } from '../_lib/lifecycle.js';
import { getSupabaseAdmin } from '../_lib/stripe.js';

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
  let allowed = !!cron && bearer.length === cron.length && bearer === cron;

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
    res.status(200).json({ ok: true, ...(await runDue(getSupabaseAdmin())) });
  } catch (e) {
    console.error('[lifecycle-run]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Run failed' });
  }
}
