import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';
import { downloadReceipt, readPaymentReceipt } from '../_lib/payment-receipt-reader.js';
import { canonicalReceiptAmount, matchReceiptReading, MAX_RECEIPT_BYTES } from '../../src/lib/payments/receipt-reading.js';
import { isReceiptCurrency } from '../../src/lib/payments/receipt-currencies.js';
import { countryMoney } from '../../src/lib/budget/country-money.js';
import { receiptExchangeRate } from '../_lib/receipt-exchange-rate.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Read the stored upload through a verified project-client session, never a supplied URL. */
export async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  const body = req.body as { stageId?: unknown; path?: unknown; amount?: unknown; currency?: unknown };
  const amount = canonicalReceiptAmount(body?.amount);
  if (typeof body?.stageId !== 'string' || !uuid.test(body.stageId) || typeof body.path !== 'string'
    || !amount || typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) {
    res.status(400).json({ error: 'invalid_receipt_input' }); return;
  }
  let admin: ReturnType<typeof getSupabaseAdmin> | undefined; let attempt: string | null = null;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const user = await requireUser(req);
    if (!user) { res.status(401).json({ error: 'sign_in_required' }); return; }
    admin = getSupabaseAdmin();
    const { data: stage, error: stageError } = await admin.from('project_stages').select('id,project_id').eq('id', body.stageId).maybeSingle();
    if (stageError || !stage) { res.status(403).json({ error: 'project_access_required' }); return; }
    const rawAuth = req.headers.authorization ?? req.headers.Authorization;
    const authorization = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
    const scoped = createClient(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authorization } } });
    const { data: access, error: accessError } = await scoped.rpc('project_team_access', { p_project: stage.project_id });
    if (accessError || access?.primary_client !== true) { res.status(403).json({ error: 'project_client_required' }); return; }
    const { data: project, error: projectError } = await admin.from('projects')
      .select('country,budget_source,budget_currency,budget_fx_rate,pricing_revision').eq('id', stage.project_id).maybeSingle();
    if (projectError || !project) { res.status(403).json({ error: 'project_access_required' }); return; }
    const configured = countryMoney((project.country ?? '').toUpperCase());
    const locked = (project.budget_source === 'boq' || project.pricing_revision > 0) && project.budget_currency && Number(project.budget_fx_rate) > 0;
    const projectCode = locked ? project.budget_currency : configured.code;
    const projectRate = locked ? project.budget_fx_rate : configured.rate;
    if (!isReceiptCurrency(body.currency) && body.currency !== projectCode) { res.status(422).json({ error: 'receipt_currency_unsupported' }); return; }
    async function conversion(readingId: string, existing?: any) {
      const quote = existing?.fx_rate != null || body.currency === projectCode
        ? { rate: null, source: 'project', asOf: new Date().toISOString() }
        : await receiptExchangeRate(body.currency as string, controller.signal);
      const saved = await admin!.rpc('attach_receipt_conversion', { p_reading: readingId,
        p_rate: quote.rate, p_project_currency: projectCode, p_project_rate: projectRate,
        p_source: quote.source, p_as_of: quote.asOf });
      if (saved.error || typeof saved.data?.fx_rate !== 'string' || !(Number(saved.data.fx_rate) > 0)) throw new Error('receipt_rate_unavailable');
      return { fxRate: saved.data.fx_rate, projectCurrency: saved.data.project_currency,
        projectFxRate: saved.data.project_fx_rate, fxSource: saved.data.fx_source, fxAsOf: saved.data.fx_as_of };
    }
    if (!body.path.startsWith(`${stage.project_id}/receipts/`) || body.path.length > 512
      || !/^[a-zA-Z0-9._-]+$/.test(body.path.slice(`${stage.project_id}/receipts/`.length))) {
      res.status(400).json({ error: 'receipt_file_path' }); return;
    }
    if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: 'receipt_reader_unavailable' }); return; }
    const reservation = await admin.rpc('reserve_receipt_read', { p_stage: stage.id, p_actor: user.id });
    if (reservation.error || typeof reservation.data !== 'string') {
      res.status(reservation.error?.message?.includes('rate_limit') ? 429 : 503).json({ error: reservation.error?.message?.includes('rate_limit') ? 'receipt_read_rate_limit' : 'receipt_reader_unavailable' }); return;
    }
    attempt = reservation.data;
    const bucket = admin.storage.from('evidence');
    const before = await bucket.info(body.path);
    if (before.error || !before.data?.id || !before.data.version) throw new Error('receipt_file_missing');
    if ((before.data.size ?? before.data.metadata?.size ?? 0) > MAX_RECEIPT_BYTES) throw new Error('receipt_file_size');
    const signed = await bucket.createSignedUrl(body.path, 60);
    if (signed.error || !signed.data?.signedUrl) throw new Error('receipt_file_missing');
    const bytes = await downloadReceipt(signed.data.signedUrl, controller.signal);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const { data: cached, error: cacheError } = await admin.from('receipt_readings').select('*')
      .eq('project_id', stage.project_id).eq('file_sha256', digest).in('status', ['matched','amount_mismatch','currency_mismatch'])
      .order('status', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (cacheError) throw new Error('receipt_reader_unavailable');
    if (cached && cached.submitted_by !== user.id) { res.status(409).json({ error: 'receipt_already_used' }); return; }
    if (cached?.stage_id !== undefined && cached.stage_id !== stage.id) { res.status(409).json({ error: 'receipt_already_used' }); return; }
    let result: { reading: unknown; model: string };
    // Keep the extracted decimal string: JSON numeric decoding can round large
    // six-decimal amounts before a retry compares them.
    if (cached) result = { reading: { is_payment_receipt: true, confidence: cached.confidence, amount: cached.amount_text, currency: cached.currency }, model: cached.model };
    else result = await readPaymentReceipt(bytes, process.env.ANTHROPIC_API_KEY, controller.signal);
    const after = await bucket.info(body.path);
    if (after.error || after.data?.id !== before.data.id || after.data.version !== before.data.version) throw new Error('receipt_file_changed');
    const match = matchReceiptReading(result.reading, amount, body.currency);
    const patch = { path: body.path, object_id: before.data.id, object_version: before.data.version, file_sha256: digest,
      status: match.status, amount: match.status === 'unreadable' ? null : match.amount,
      amount_text: match.status === 'unreadable' ? null : match.amount,
      currency: match.status === 'unreadable' ? null : match.currency, model: result.model,
      confidence: match.status === 'unreadable' ? 'low' : 'high' };
    // A cached reading may resume an upload whose network response was lost.
    if (cached && match.status === 'matched') {
      const original = await bucket.info(cached.path);
      if (!original.error && original.data?.id === cached.object_id && original.data.version === cached.object_version) {
        const refreshed = await admin.from('receipt_readings').update({ status: 'matched', expires_at: new Date(Date.now()+30*60_000).toISOString() }).eq('id', cached.id);
        if (refreshed.error) throw new Error('receipt_reader_unavailable');
        const rate = await conversion(cached.id, cached);
        await admin.from('receipt_readings').update({ status: 'stale' }).eq('id', attempt);
        res.status(200).json({ status: 'matched', readingId: cached.id, path: cached.path, ...rate }); return;
      }
      const invalidated = await admin.from('receipt_readings').update({ status: 'stale' }).eq('id', cached.id);
      if (invalidated.error) throw new Error('receipt_reader_unavailable');
    }
    const saved = await admin.from('receipt_readings').update(patch).eq('id', attempt);
    if (saved.error) {
      if (saved.error.code === '23505') { res.status(409).json({ error: 'receipt_already_used' }); return; }
      throw new Error('receipt_reader_unavailable');
    }
    const rate = match.status === 'matched' ? await conversion(attempt!) : null;
    res.status(match.status === 'matched' ? 200 : 422).json(match.status === 'matched'
      ? { status: 'matched', readingId: attempt, path: body.path, ...rate } : { error: `receipt_${match.status}`, ...match });
  } catch (error) {
    const message = (error as Error)?.message ?? '';
    const known = ['receipt_file_type','receipt_file_size','receipt_page_limit','receipt_unreadable','receipt_file_missing','receipt_file_changed','receipt_rate_unavailable','receipt_currency_unsupported'];
    const code = known.includes(message) ? message : 'receipt_reader_unavailable';
    if (admin && attempt) { try { await admin.from('receipt_readings').update({ status: 'error' }).eq('id', attempt); } catch { /* The uncompleted reading cannot attest a payment. */ } }
    res.status(code === 'receipt_reader_unavailable' || code === 'receipt_rate_unavailable' ? 503 : 422).json({ error: code });
  } finally { clearTimeout(timer); controller.abort(); }
}
