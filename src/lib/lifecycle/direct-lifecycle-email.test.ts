import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  logEmail: vi.fn(),
}));
vi.mock('../../../api/ghl/_email-log.js', () => ({ logEmailToCrm: h.logEmail }));

import { sendDirectProjectActivationEmail, sendDirectWelcomeEmail } from '../../../api/_lib/direct-lifecycle-email';
import { enrollForEvent } from '../../../api/_lib/lifecycle';
import { composeCommunicationEmail } from '../../../api/_lib/communication-email';

function fakeDb(tables: Record<string, any[]>) {
  const updates: { table: string; patch: any }[] = [];
  const from = (table: string) => {
    const filters: ((r: any) => boolean)[] = [];
    let mode: 'select' | 'update' | 'insert' | 'upsert' = 'select';
    let patch: any;
    let lim = Infinity;
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => { filters.push(r => r[c] === v); return q; },
      ilike: (c: string, v: string) => { filters.push(r => String(r[c] ?? '').toLowerCase() === v.toLowerCase()); return q; },
      in: (c: string, vals: any[]) => { filters.push(r => vals.includes(r[c])); return q; },
      is: (c: string, v: any) => { filters.push(r => (r[c] ?? null) === v); return q; },
      gte: (c: string, v: number) => { filters.push(r => r[c] >= v); return q; },
      lte: (c: string, v: string) => { filters.push(r => r[c] <= v); return q; },
      order: () => q,
      limit: (n: number) => { lim = n; return q; },
      update: (p: any) => { mode = 'update'; patch = p; return q; },
      insert: (r: any) => { (tables[table] ??= []).push(r); return Promise.resolve({ error: null }); },
      upsert: (r: any, o: any) => {
        const keys = String(o.onConflict).split(',');
        const exists = (tables[table] ??= []).some(x => keys.every(k => x[k] === r[k]));
        const id = `enr_${tables[table].length}`;
        if (!exists) tables[table].push({ id, ...r });
        const out = Promise.resolve({ error: null, data: exists ? [] : [{ id }] });
        return Object.assign(out, { select: () => out });
      },
      maybeSingle: async () => {
        const rows = (tables[table] ?? []).filter(r => filters.every(f => f(r)));
        return { data: rows[0] ?? null, error: null };
      },
      single: async () => {
        const rows = (tables[table] ?? []).filter(r => filters.every(f => f(r)));
        return { data: rows[0] ?? null, error: null };
      },
      then: (res: any) => {
        const rows = (tables[table] ?? []).filter(r => filters.every(f => f(r))).slice(0, lim);
        if (mode === 'update') {
          updates.push({ table, patch });
          rows.forEach(r => Object.assign(r, patch));
        }
        return Promise.resolve({ data: rows, error: null }).then(res);
      },
    };
    return q;
  };
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  return { from, rpc, tables, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('RESEND_API_KEY', 're_test_key');
  vi.stubEnv('PUBLIC_SITE_URL', 'https://groundwork.test');
  vi.stubGlobal('fetch', h.fetch);
  h.fetch.mockResolvedValue(new Response(JSON.stringify({ id: 'resend_msg_1' }), { status: 200 }));
  h.logEmail.mockResolvedValue({ ok: true, surface: 'none' });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('direct transactional welcome & project activation emails (GHL-independent)', () => {
  it('sends Day-0 Welcome via Resend using CS01 copy, stamps welcome_email_sent_at, and never duplicates', async () => {
    const db = fakeDb({
      profiles: [{ id: 'u1', welcome_email_sent_at: null }],
      communication_settings: [{ id: true, sender_name: 'Groundwork by Jalla', sender_email: 'noreply@mail.tryjalla.com' }],
      lifecycle_sequence_steps: [{
        sequence_key: 'cs_signup', position: 1, delay_hours: 0, channel: 'email', code: 'CS01',
        subject_en: 'Welcome to Groundwork, {{first_name}}', subject_fr: '',
        body_en: 'Hi {{first_name}},\n\nFinish your contractor profile.', body_fr: '',
        cta_key: 'onboarding', cta_label_en: 'Complete onboarding', cta_label_fr: '',
      }],
    });

    const first = await sendDirectWelcomeEmail(db, {
      userId: 'u1', email: 'Builder@Test.co', fullName: 'Chidi Eze', lang: 'en', role: 'contractor',
    });
    expect(first).toMatchObject({ sent: true, alreadySent: false, stepCode: 'CS01', subject: 'Welcome to Groundwork, Chidi', messageId: 'resend_msg_1' });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const reqInit = h.fetch.mock.calls[0][1];
    expect(reqInit.headers['Idempotency-Key']).toBe('welcome/u1');
    const body = JSON.parse(reqInit.body);
    expect(body.to).toEqual(['builder@test.co']);
    expect(body.from).toBe('Groundwork by Jalla <noreply@mail.tryjalla.com>');
    expect(body.html).toContain('https://groundwork.test/work/onboarding');
    expect(db.tables.profiles[0].welcome_email_sent_at).toBeTruthy();
    expect(h.logEmail).toHaveBeenCalledOnce();

    // Second call is an idempotent no-op
    const second = await sendDirectWelcomeEmail(db, {
      userId: 'u1', email: 'builder@test.co', fullName: 'Chidi Eze', lang: 'en', role: 'contractor',
    });
    expect(second).toMatchObject({ sent: false, alreadySent: true });
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('skips generic Welcome when the user already has a pending project invitation', async () => {
    const db = fakeDb({
      profiles: [{ id: 'u2', welcome_email_sent_at: null }],
      contractor_invites: [{ id: 'inv1', email: 'invited@test.co', status: 'pending' }],
    });
    const res = await sendDirectWelcomeEmail(db, {
      userId: 'u2', email: 'invited@test.co', fullName: 'Sam', lang: 'en', role: 'contractor',
    });
    expect(res).toMatchObject({ sent: false, alreadySent: false, skippedReason: 'invitation_context' });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('sends Day-0 Project Activation via Resend with bold project name and idempotent stamp', async () => {
    const db = fakeDb({
      projects: [{ id: 'p1', activation_email_sent_at: null }],
      communication_settings: [{ id: true, sender_name: 'Groundwork by Jalla', sender_email: 'noreply@mail.tryjalla.com' }],
      lifecycle_sequence_steps: [{
        sequence_key: 'cl_project', position: 1, delay_hours: 0, channel: 'email', code: 'CL05',
        subject_en: 'Your project {{project_name}} is ready', subject_fr: '',
        body_en: 'Hi {{first_name}},\n\n{{project_name}} is live. Connect your contractor next.', body_fr: '',
        cta_key: 'connect_contractor', cta_label_en: 'Connect contractor', cta_label_fr: '',
      }],
    });

    const res = await sendDirectProjectActivationEmail(db, {
      projectId: 'p1', projectName: 'Villa Kribi', ownerId: 'u3', email: 'owner@test.co', fullName: 'Ruth Ijoma', lang: 'en', role: 'client',
    });
    expect(res).toMatchObject({ sent: true, alreadySent: false, stepCode: 'CL05', subject: 'Your project Villa Kribi is ready' });
    const reqInit = h.fetch.mock.calls[0][1];
    expect(reqInit.headers['Idempotency-Key']).toBe('activation/p1');
    const body = JSON.parse(reqInit.body);
    expect(body.html).toContain('<strong>Villa Kribi</strong>');
    expect(body.html).toContain('https://groundwork.test/projects/p1?tab=team');
    expect(db.tables.projects[0].activation_email_sent_at).toBeTruthy();

    // Repeat call is suppressed
    const repeat = await sendDirectProjectActivationEmail(db, {
      projectId: 'p1', projectName: 'Villa Kribi', ownerId: 'u3', email: 'owner@test.co', fullName: 'Ruth Ijoma', lang: 'en', role: 'client',
    });
    expect(repeat).toMatchObject({ sent: false, alreadySent: true });
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('hands off Day-0 Welcome/Activation to enrollForEvent starting at Step 2 so /admin/sequences never duplicates Step 1', async () => {
    const now = new Date('2026-11-20T00:00:00Z');
    const db = fakeDb({
      communication_settings: [{ id: true, delivery_enabled: false, sender_name: 'Groundwork', sender_email: 'noreply@mail.tryjalla.com', followup_sender_email: 'contact@tryjalla.com', reply_domain: null }],
      lifecycle_sequences: [
        { key: 'cs_signup', enabled: true, trigger_event: 'user_signup', audience: 'contractor', exit_events: ['contractor_onboarding_completed'], followup_after_days: 7 },
        { key: 'cl_project', enabled: true, trigger_event: 'project_created', audience: 'client', exit_events: ['contractor_invited'], followup_after_days: 7 },
      ],
      lifecycle_sequence_steps: [
        { sequence_key: 'cs_signup', position: 1, delay_hours: 0, code: 'CS01', channel: 'email', subject_en: 'Welcome', subject_fr: '', body_en: 'Hi', body_fr: '' },
        { sequence_key: 'cs_signup', position: 2, delay_hours: 24, code: 'CS02', channel: 'email', subject_en: 'Reminder', subject_fr: '', body_en: 'Still here', body_fr: '' },
        { sequence_key: 'cl_project', position: 1, delay_hours: 0, code: 'CL05', channel: 'email', subject_en: 'Project ready', subject_fr: '', body_en: 'Ready', body_fr: '' },
        { sequence_key: 'cl_project', position: 2, delay_hours: 24, code: 'CL06', channel: 'email', subject_en: 'Invite contractor', subject_fr: '', body_en: 'Next', body_fr: '' },
      ],
      lifecycle_enrollments: [],
      lifecycle_sends: [],
    });

    await enrollForEvent(db, 'user_signup', { email: 'pro@test.co', fullName: 'Chidi' }, {
      user_role: 'contractor', entry_source: 'independent_signup', initial_email_sent: true, initial_email_subject: 'Welcome to Groundwork, Chidi',
    }, now);

    expect(db.tables.lifecycle_enrollments[0]).toMatchObject({
      sequence_key: 'cs_signup',
      next_position: 2,
      next_send_at: '2026-11-21T00:00:00.000Z',
      emails_sent: 1,
      last_step_code: 'CS01',
    });
    expect(db.tables.lifecycle_sends[0]).toMatchObject({
      step_code: 'CS01',
      status: 'sent',
      subject: 'Welcome to Groundwork, Chidi',
    });

    await enrollForEvent(db, 'project_created', { email: 'owner@test.co', fullName: 'Ruth' }, {
      user_role: 'client', project_id: 'p1', project_name: 'Villa Kribi', initial_email_sent: true, initial_email_subject: 'Your project Villa Kribi is ready',
    }, now);

    expect(db.tables.lifecycle_enrollments[1]).toMatchObject({
      sequence_key: 'cl_project',
      next_position: 2,
      next_send_at: '2026-11-21T00:00:00.000Z',
      emails_sent: 1,
      last_step_code: 'CL05',
    });
    expect(db.tables.lifecycle_sends[1]).toMatchObject({
      step_code: 'CL05',
      status: 'sent',
      subject: 'Your project Villa Kribi is ready',
    });
  });

  it('allows reminders to compose with reply_to falling back to senderEmail when replyDomain is unset', () => {
    const payload = composeCommunicationEmail({
      to: 'client@example.test',
      subject: 'Reminder',
      body: 'Hello there.',
      threadId: '00000000-0000-0000-0000-000000000001',
      preferenceToken: '00000000-0000-0000-0000-000000000002',
      senderName: 'Groundwork',
      senderEmail: 'contact@tryjalla.com',
      replyDomain: null,
    });
    expect(payload.reply_to).toBe('contact@tryjalla.com');
  });
});
