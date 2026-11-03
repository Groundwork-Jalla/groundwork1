import { describe, it, expect } from 'vitest';
import { render, pickLang, copyFor, audienceMatches, nextDue, enrollForEvent, runDue } from '../../../api/_lib/lifecycle';

describe('lifecycle helpers', () => {
  it('renders tags and blanks unknown ones', () => {
    expect(render('Hi {{first_name}} {{nope}}!', { email: 'a@b.co', fullName: 'Ada Obi' })).toBe('Hi Ada !');
  });
  it('picks French only for fr*', () => {
    expect(pickLang('fr-CM')).toBe('fr');
    expect(pickLang(null)).toBe('en');
  });
  it('falls back to English copy when French is empty', () => {
    const step: any = { subject_en: 'S', subject_fr: '', body_en: 'B {{first_name}}', body_fr: '' };
    expect(copyFor(step, 'fr', { email: 'a@b.co', fullName: 'Ada' })).toEqual({ subject: 'S', body: 'B Ada' });
  });
  it('matches audience, treating an unknown role as a match', () => {
    expect(audienceMatches('client', 'contractor')).toBe(false);
    expect(audienceMatches('client', null)).toBe(true);
    expect(audienceMatches('any', 'client')).toBe(true);
  });
  it('schedules the next step, then the Day-7 follow-up, then ends', () => {
    const steps = [{ position: 1, delay_hours: 24 }, { position: 2, delay_hours: 48 }];
    const now = new Date('2026-01-02T00:00:00Z');
    const enrolled = new Date('2026-01-01T00:00:00Z');
    expect(nextDue(steps, 1, enrolled, 7, now)).toEqual({ position: 2, at: new Date('2026-01-04T00:00:00Z') });
    expect(nextDue(steps, 2, enrolled, 7, now)).toEqual({ followupAt: new Date('2026-01-08T00:00:00Z') });
    expect(nextDue(steps, 2, enrolled, null, now)).toBeNull();
  });
});

// A tiny in-memory stand-in for the query builder.
function fakeSvc(tables: Record<string, any[]>) {
  const log: { table: string; op: string; row?: any }[] = [];
  const from = (table: string) => {
    let filters: ((r: any) => boolean)[] = [];
    let mode: 'select' | 'update' | 'upsert' | 'insert' = 'select';
    let patch: any; let lim = Infinity;
    const q: any = {
      select: () => q,
      update: (p: any) => { mode = 'update'; patch = p; return q; },
      insert: (r: any) => { log.push({ table, op: 'insert', row: r }); (tables[table] ??= []).push(r); return Promise.resolve({ error: null }); },
      upsert: (r: any, o: any) => {
        mode = 'upsert';
        const keys = String(o.onConflict).split(',');
        const exists = (tables[table] ??= []).some(x => keys.every(k => x[k] === r[k]));
        if (!exists) { tables[table].push({ id: `id${tables[table].length}`, ...r }); log.push({ table, op: 'upsert', row: r }); }
        const out = Promise.resolve({ error: null, data: exists ? [] : [{ id: 'x' }] });
        return Object.assign(out, { select: () => out });
      },
      eq: (c: string, v: any) => { filters.push(r => r[c] === v); return q; },
      in: (c: string, v: any[]) => { filters.push(r => v.includes(r[c])); return q; },
      lte: (c: string, v: string) => { filters.push(r => r[c] <= v); return q; },
      order: () => q,
      limit: (n: number) => { lim = n; return q; },
      then: (res: any) => {
        const rows = (tables[table] ?? []).filter(r => filters.every(f => f(r))).slice(0, lim);
        if (mode === 'update') rows.forEach(r => Object.assign(r, patch));
        return Promise.resolve({ data: rows, error: null }).then(res);
      },
    };
    return q;
  };
  return { from, log, tables };
}

describe('enrollForEvent', () => {
  const seq = (o: any = {}) => ({ key: 'a', enabled: true, trigger_event: 'user_signup', exit_events: ['project_created'],
    audience: 'any', followup_after_days: 7, ...o });
  const step = { sequence_key: 'a', position: 1, delay_hours: 24 };

  it('enrols on the trigger once, and not into a disabled sequence', async () => {
    const svc = fakeSvc({ lifecycle_sequences: [seq(), seq({ key: 'b', enabled: false })],
      lifecycle_sequence_steps: [step, { ...step, sequence_key: 'b' }], lifecycle_enrollments: [] });
    expect((await enrollForEvent(svc, 'user_signup', { email: 'A@B.co' })).enrolled).toBe(1);
    expect((await enrollForEvent(svc, 'user_signup', { email: 'a@b.co' })).enrolled).toBe(0);
    expect(svc.tables.lifecycle_enrollments).toHaveLength(1);
    expect(svc.tables.lifecycle_enrollments[0].email).toBe('a@b.co');
  });
  it('exits on an exit event and closes the open follow-up', async () => {
    const svc = fakeSvc({ lifecycle_sequences: [seq()], lifecycle_sequence_steps: [step],
      lifecycle_enrollments: [{ sequence_key: 'a', email: 'a@b.co', status: 'active' }],
      followup_queue: [{ sequence_key: 'a', email: 'a@b.co', status: 'open' }] });
    const r = await enrollForEvent(svc, 'project_created', { email: 'a@b.co' });
    expect(r.exited).toBe(1);
    expect(svc.tables.lifecycle_enrollments[0]).toMatchObject({ status: 'exited', exit_reason: 'project_created' });
    expect(svc.tables.followup_queue[0].status).toBe('done');
  });
  it('respects audience and the no_client opt-out', async () => {
    const mk = () => fakeSvc({ lifecycle_sequences: [seq({ audience: 'client' })], lifecycle_sequence_steps: [step], lifecycle_enrollments: [] });
    expect((await enrollForEvent(mk(), 'user_signup', { email: 'a@b.co' }, { user_role: 'contractor' })).enrolled).toBe(0);
    expect((await enrollForEvent(mk(), 'user_signup', { email: 'a@b.co' }, { user_role: 'client', client_intent: 'no_client' })).enrolled).toBe(0);
  });
});

describe('runDue', () => {
  it('sends nothing when no sequence is enabled', async () => {
    const svc = fakeSvc({ lifecycle_sequences: [{ key: 'a', enabled: false }], lifecycle_enrollments: [] });
    expect(await runDue(svc)).toEqual({ sent: 0, failed: 0, followups: 0, skipped: 0 });
  });
  it('queues a human follow-up once the steps are used up', async () => {
    const svc = fakeSvc({
      lifecycle_sequences: [{ key: 'a', enabled: true, followup_after_days: 7 }],
      lifecycle_sequence_steps: [{ sequence_key: 'a', position: 1, delay_hours: 1, channel: 'email' }],
      lifecycle_enrollments: [{ id: 'e1', sequence_key: 'a', email: 'a@b.co', status: 'active', next_position: 2,
        next_send_at: '2020-01-01T00:00:00Z', enrolled_at: '2020-01-01T00:00:00Z' }],
      followup_queue: [] });
    const r = await runDue(svc, new Date('2020-01-09T00:00:00Z'));
    expect(r.followups).toBe(1);
    expect(svc.tables.followup_queue).toHaveLength(1);
    expect(svc.tables.lifecycle_enrollments[0].status).toBe('completed');
  });
});
