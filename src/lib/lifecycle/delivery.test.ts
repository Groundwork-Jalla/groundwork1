import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), fetch: vi.fn(), mirror: vi.fn(), whatsapp: vi.fn() }));
vi.mock('../../../api/ghl/_email-log.js', () => ({ logEmailToCrm: h.mirror }));
vi.mock('../../../api/_lib/whatsapp-send.js', () => ({ sendWhatsApp: h.whatsapp }));
import { dueStep, nextDue, previewDue, runDue } from '../../../api/_lib/lifecycle';

const entered = new Date('2026-11-01T00:00:00Z');
const delayed = new Date('2026-11-05T00:00:00Z');
const steps = [0, 24, 48, 96].map((hours, index) => ({
  position: index + 1, delay_hours: hours, sequence_key: 'test', code: `STEP${index + 1}`,
  channel: 'email' as const, subject_en: `Subject ${index + 1}`, subject_fr: `Objet ${index + 1}`,
  body_en: 'Hello', body_fr: 'Bonjour', cta_key: 'open_project', cta_label_en: 'Open project', cta_label_fr: 'Ouvrir le projet',
}));
const enrollment = { id: 'enrollment', sequence_key: 'test', email: 'client@example.test', full_name: 'Ada', lang: 'en',
  status: 'active', enrolled_at: entered.toISOString(), next_position: 1, next_send_at: entered.toISOString(),
  context: { project_id: 'project', recipient_role: 'client' } };

function service(options: { steps?: typeof steps; deliveries?: any[] } = {}) {
  const tables: Record<string, any[]> = { lifecycle_sequences: [{ key: 'test', enabled: true }],
    lifecycle_enrollments: [enrollment], lifecycle_sequence_steps: options.steps ?? steps,
    lifecycle_deliveries: options.deliveries ?? [],
    communication_settings: [{id:true,delivery_enabled:true,sender_name:'Groundwork',sender_email:'hello@groundwork.test',followup_sender_email:'contact@groundwork.test',reply_domain:'reply.groundwork.test'}] };
  const from = vi.fn((table: string) => {
    const filters: ((row: any) => boolean)[] = [];
    let limit = Infinity;
    const q: any = { select: () => q, eq: (key: string, value: any) => { filters.push(row => row[key] === value); return q; },
      lte: (key: string, value: any) => { filters.push(row => row[key] <= value); return q; },
      gte: (key: string, value: any) => { filters.push(row => row[key] >= value); return q; },
      in: (key: string, values: any[]) => { filters.push(row => values.includes(row[key])); return q; },
      order: () => q, limit: (value: number) => { limit = value; return q; },
      single: async () => ({data:(tables[table]??[]).find(row=>filters.every(test=>test(row))),error:null}),
      then: (resolve: any) => Promise.resolve({ data: (tables[table] ?? []).filter(row => filters.every(test => test(row))).slice(0, limit), error: null }).then(resolve) };
    return q;
  });
  return { from, rpc: h.rpc };
}

beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('fetch', h.fetch);
  vi.stubEnv('RESEND_API_KEY', 'unit-test-only'); vi.stubEnv('PUBLIC_SITE_URL', 'https://groundwork.test');
  vi.stubEnv('LIFECYCLE_WHATSAPP_ENABLED', 'false');
  h.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'provider-message' }) });
  h.mirror.mockResolvedValue(undefined);
  h.rpc.mockImplementation(async (name, args) => ({ error: null, data:
    name === 'claim_lifecycle_enrollment' ? { ...enrollment, processing_token: 'lease' }
      : name === 'prepare_lifecycle_delivery' ? { status: 'prepared', payload: args.p_payload }
      : name === 'ensure_lifecycle_communication' ? {thread_id:'00000000-0000-0000-0000-000000000001',preference_token:'00000000-0000-0000-0000-000000000002'}
      : name === 'lifecycle_enrollment_state' ? { kind: 'ready', reason: 'ready', qualified: true } : true }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('entry-based reminder timing', () => {
  it('keeps Day 3 and Day 7 anchored to entry after a delayed worker', () => {
    expect(nextDue(steps, 2, entered, 7, delayed)).toEqual({ position: 3, at: new Date('2026-11-04T00:00:00Z') });
    expect(nextDue(steps, 3, entered, 7, delayed)).toEqual({ position: 4, at: new Date('2026-11-08T00:00:00Z') });
  });
  it('selects the latest due message rather than a burst of past reminders', () => {
    expect(dueStep(steps, 1, entered, delayed)?.position).toBe(3);
    expect(dueStep(steps, 4, entered, delayed)).toBeUndefined();
  });
});

describe('durable reminder delivery', () => {
  it('claims before sending and records the provider result with the same lease', async () => {
    expect((await runDue(service(), delayed)).sent).toBe(1);
    expect(h.rpc.mock.calls[0][0]).toBe('claim_lifecycle_enrollment');
    expect(h.fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe('lifecycle/enrollment/3');
    expect(JSON.parse(h.fetch.mock.calls[0][1].body).subject).toBe('Subject 3');
    expect(JSON.parse(h.fetch.mock.calls[0][1].body).from).toBe('Groundwork <contact@groundwork.test>');
    expect(h.rpc).toHaveBeenCalledWith('finish_lifecycle_delivery', expect.objectContaining({ p_token: 'lease', p_position: 3, p_outcome: 'sent', p_provider_id: 'provider-message' }));
    expect(h.mirror).toHaveBeenCalledOnce();
  });

  it('uses the welcome address for an immediate message',async()=>{
    await runDue(service(),entered);
    expect(JSON.parse(h.fetch.mock.calls[0][1].body).from).toBe('Groundwork <hello@groundwork.test>');
  });

  it('sends nothing if another worker owns the lease', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect((await runDue(service(), delayed)).skipped).toBe(1);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('sends nothing after authoritative state cancels preparation', async () => {
    const normal = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async (name, args) => name === 'prepare_lifecycle_delivery' ? { data: null, error: null } : normal(name, args));
    expect((await runDue(service(), delayed)).skipped).toBe(1);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('reuses the durable payload and original step for an uncertain earlier request', async () => {
    const original = { to: 'original@example.test', from: 'Groundwork <team@example.test>', subject: 'Original', html: '<p>Original</p>', text: 'Original' };
    const normal = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async (name, args) => name === 'prepare_lifecycle_delivery' ? { data: { status: 'prepared', payload: original }, error: null } : normal(name, args));
    await runDue(service({ deliveries: [{ enrollment_id: 'enrollment', position: 2, status: 'prepared' }] }), delayed);
    expect(h.fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe('lifecycle/enrollment/2');
    expect(JSON.parse(h.fetch.mock.calls[0][1].body)).toEqual(original);
  });

  it('recovers an already recorded send without sending or mirroring it again', async () => {
    const normal = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async (name, args) => name === 'prepare_lifecycle_delivery' ? { data: { status: 'sent', provider_id: 'earlier-message' }, error: null } : normal(name, args));
    const result = await runDue(service(), delayed);
    expect(result.sent).toBe(0); expect(result.skipped).toBe(1);
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.mirror).not.toHaveBeenCalled();
  });

  it('holds an ambiguous old delivery for review without resending it', async () => {
    const normal = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async (name, args) => name === 'prepare_lifecycle_delivery' ? { data: { status: 'blocked' }, error: null } : normal(name, args));
    expect((await runDue(service(), delayed)).failed).toBe(1);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('records an uncertain network response as failed for a safe retry', async () => {
    h.fetch.mockRejectedValue(new Error('connection interrupted'));
    expect((await runDue(service(), delayed)).failed).toBe(1);
    expect(h.rpc).toHaveBeenCalledWith('finish_lifecycle_delivery', expect.objectContaining({ p_outcome: 'failed', p_error: 'resend_connection_uncertain' }));
    expect(h.mirror).not.toHaveBeenCalled();
  });

  it('reports a missing migration to the handler instead of running an unlocked fallback', async () => {
    h.rpc.mockResolvedValue({ error: { code: 'PGRST202' } });
    await expect(runDue(service(), delayed)).rejects.toMatchObject({ code: 'PGRST202' });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('keeps automated WhatsApp outreach paused', async () => {
    const whatsappSteps = steps.map(step => ({ ...step, channel: 'whatsapp' as any }));
    expect((await runDue(service({ steps: whatsappSteps }), delayed)).skipped).toBe(1);
    expect(h.whatsapp).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith('finish_lifecycle_delivery', expect.objectContaining({ p_outcome: 'skipped', p_error: 'whatsapp_outreach_paused' }));
  });
});

describe('staff preview', () => {
  it('inspects due messages without claiming, mutating or sending anything', async () => {
    const preview = await previewDue(service(), delayed);
    expect(preview.ready).toBe(1); expect(preview.rows[0]).toMatchObject({ subject: 'Subject 3', step: 'STEP3', state: 'ready' });
    expect(h.rpc.mock.calls.every(call => call[0] === 'lifecycle_enrollment_state')).toBe(true);
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.whatsapp).not.toHaveBeenCalled();
  });
});
