import { describe, it, expect } from 'vitest';
import { render, pickLang, copyFor, audienceMatches, matchesFields, ctaPath, followupPriority, nextDue, enrollForEvent, runDue } from '../../../api/_lib/lifecycle';
import { stepTimeline } from '../../../shared/lifecycle-copy';

describe('lifecycle helpers', () => {
  it('uses French fallback names and project wording in French copy',()=>{
    expect(render('Bonjour {{first_name}}, ouvrez {{project_name}}.',{email:'person@example.test'},{},'fr')).toBe('Bonjour à vous, ouvrez votre projet.');
    const step:any={subject_en:'Welcome {{first_name}}',subject_fr:'Bienvenue {{first_name}}',body_en:'Open {{project_name}}.',body_fr:'Ouvrez {{project_name}}.'};
    expect(copyFor(step,'fr',{email:'person@example.test'})).toMatchObject({subject:'Bienvenue à vous',body:'Ouvrez votre projet.'});
  });
  it('keeps fallback English fields in English when a French field is missing',()=>{
    const step:any={subject_en:'Welcome {{first_name}}',subject_fr:'',body_en:'Open {{project_name}}.',body_fr:'Ouvrez {{project_name}}.'};
    expect(copyFor(step,'fr',{email:'person@example.test'})).toMatchObject({subject:'Welcome there',body:'Ouvrez votre projet.'});
  });
  it('uses the same entry-based schedule for previews and actual due dates',()=>{
    const steps=[0,24,48,96].map((delay_hours,index)=>({position:index+1,delay_hours}));
    const before=[...steps].reverse();const enrolled=new Date('2026-11-13T00:00:00Z');
    expect(stepTimeline(before).map(item=>item.hoursFromEntry)).toEqual([0,24,72,168]);expect(before[0].position).toBe(4);
    for(const item of stepTimeline(before))expect(nextDue(before,item.step.position-1,enrolled,null,enrolled)).toEqual({position:item.step.position,at:new Date(enrolled.getTime()+item.hoursFromEntry*3600_000)});
  });
  it('renders tags and blanks unknown ones', () => {
    expect(render('Hi {{first_name}} {{nope}}!', { email: 'a@b.co', fullName: 'Ada Obi' })).toBe('Hi Ada !');
  });
  it('fills project and party names, and says "there" when the first name is unknown', () => {
    const ctx = { project_name: 'Villa 7', client_name: 'ada@x.co', contractor_name: 'Chidi Eze' };
    expect(render('Hi {{first_name}}, {{project_name}} {{contractor_first_name}} {{client_first_name}}', { email: 'a@b.co' }, ctx))
      .toBe('Hi there, Villa 7 Chidi there');
  });
  it('matches pinned routing fields', () => {
    expect(matchesFields({ entry_source: 'independent_signup' }, { entry_source: 'independent_signup' })).toBe(true);
    expect(matchesFields({ entry_source: 'independent_signup' }, {})).toBe(false);
    expect(matchesFields({}, {})).toBe(true);
  });
  it('deep-links to the unfinished screen by role', () => {
    expect(ctaPath('onboarding', {})).toBe('/work/onboarding');
    expect(ctaPath('open_project', { project_id: 'p1', recipient_role: 'contractor' })).toBe('/work/projects/p1');
    expect(ctaPath('open_project', { project_id: 'p1', recipient_role: 'client' })).toBe('/projects/p1');
    expect(ctaPath('invitation', { invite_path: '/invite/t' })).toBe('/invite/t');
  });
  it('flags project-linked and referred people as high priority', () => {
    expect(followupPriority({ project_id: 'p' })).toBe('high');
    expect(followupPriority({ entry_source: 'referral' })).toBe('high');
    expect(followupPriority({})).toBe('normal');
  });
  it('picks French only for fr*', () => {
    expect(pickLang('fr-CM')).toBe('fr');
    expect(pickLang(null)).toBe('en');
  });
  it('falls back to English copy when French is empty', () => {
    const step: any = { subject_en: 'S', subject_fr: '', body_en: 'B {{first_name}}', body_fr: '' };
    expect(copyFor(step, 'fr', { email: 'a@b.co', fullName: 'Ada' })).toEqual({ subject: 'S', body: 'B Ada', cta: '' });
  });
  it('matches audience, and never sends an audience-specific sequence to an unknown role', () => {
    expect(audienceMatches('client', 'contractor')).toBe(false);
    expect(audienceMatches('client', null)).toBe(false);
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
  tables.communication_settings ??= [{id:true,delivery_enabled:true,sender_name:'Groundwork',sender_email:'hello@groundwork.test',followup_sender_email:'contact@groundwork.test',reply_domain:'reply.groundwork.test'}];
  const log: { table: string; op: string; row?: any }[] = [];
  const from = (table: string) => {
    let filters: ((r: any) => boolean)[] = [];
    let mode: 'select' | 'update' | 'upsert' | 'insert' = 'select';
    let patch: any; let lim = Infinity;
    const q: any = {
      select: () => q,
      single: async () => ({data:(tables[table]??[]).find(row=>filters.every(test=>test(row))),error:null}),
      update: (p: any) => { mode = 'update'; patch = p; return q; },
      insert: (r: any) => { log.push({ table, op: 'insert', row: r }); (tables[table] ??= []).push(r); return Promise.resolve({ error: null }); },
      upsert: (r: any, o: any) => {
        mode = 'upsert';
        const keys = String(o.onConflict).split(',');
        const exists = (tables[table] ??= []).some(x => keys.every(k => x[k] === r[k]));
        const id = `id${tables[table].length}`;
        if (!exists) { tables[table].push({ id, ...r }); log.push({ table, op: 'upsert', row: r }); }
        const out = Promise.resolve({ error: null, data: exists ? [] : [{ id }] });
        return Object.assign(out, { select: () => out });
      },
      eq: (c: string, v: any) => { filters.push(r => r[c] === v); return q; },
      in: (c: string, v: any[]) => { filters.push(r => v.includes(r[c])); return q; },
      gte: (c: string, v: number) => { filters.push(r => r[c] >= v); return q; },
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
  const rpc = async (name: string, args: Record<string, any>) => {
    const enrollment = (tables.lifecycle_enrollments ?? []).find(row => row.id === args.p_enrollment);
    if (name === 'lifecycle_enrollment_state') return { data: { kind: 'ready', qualified: !!enrollment?.context?.project_id }, error: null };
    if (name === 'claim_lifecycle_enrollment') return { data: enrollment ? { ...enrollment, processing_token: 'claim' } : null, error: null };
    if (name === 'finish_lifecycle_delivery' && enrollment) {
      if (args.p_outcome === 'complete') {
        enrollment.status = 'completed'; enrollment.followup_queued = !!enrollment.context?.project_id;
        if (enrollment.context?.project_id) (tables.followup_queue ??= []).push({ enrollment_id: enrollment.id });
      }
      return { data: true, error: null };
    }
    return { data: null, error: null };
  };
  return { from, rpc, log, tables };
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
      followup_queue: [{ sequence_key: 'a', email: 'a@b.co', status: 'open',kind:'activation' }] });
    const r = await enrollForEvent(svc, 'project_created', { email: 'a@b.co' });
    expect(r.exited).toBe(1);
    expect(svc.tables.lifecycle_enrollments[0]).toMatchObject({ status: 'exited', exit_reason: 'project_created' });
    expect(svc.tables.followup_queue[0].status).toBe('done');
  });
  it.each(['reply','delivery'])('keeps a %s support task open when a project event ends activation',async kind=>{
    const svc=fakeSvc({lifecycle_sequences:[seq()],lifecycle_sequence_steps:[step],
      lifecycle_enrollments:[{id:'e1',sequence_key:'a',email:'a@b.co',status:'active'}],
      followup_queue:[{enrollment_id:'e1',sequence_key:'a',email:'a@b.co',status:'open',kind}]});
    await enrollForEvent(svc,'project_created',{email:'a@b.co'});
    expect(svc.tables.followup_queue[0].status).toBe('open');
  });
  it('respects audience and the no_client opt-out', async () => {
    const mk = () => fakeSvc({ lifecycle_sequences: [seq({ audience: 'client' })], lifecycle_sequence_steps: [step], lifecycle_enrollments: [] });
    expect((await enrollForEvent(mk(), 'user_signup', { email: 'a@b.co' }, { user_role: 'contractor' })).enrolled).toBe(0);
    expect((await enrollForEvent(mk(), 'user_signup', { email: 'a@b.co' }, { user_role: 'client', client_intent: 'no_client' })).enrolled).toBe(0);
  });
});

describe('journey routing', () => {
  const mkSeq = (o: any) => ({ enabled: true, exit_events: [], audience: 'any', recipient: 'self', match: {}, skip_if_active_in: [], followup_after_days: 7, ...o });
  const step = (k: string) => ({ sequence_key: k, position: 1, delay_hours: 72 });

  it('enrols the inviter, not the invitee, and ends it when the invitee joins', async () => {
    const svc = fakeSvc({
      lifecycle_sequences: [
        mkSeq({ key: 'pending', trigger_event: 'client_invited', exit_events: ['invitation_accepted'], recipient: 'inviter', audience: 'contractor', match: { inviter_role: 'contractor' } }),
      ],
      lifecycle_sequence_steps: [step('pending')], lifecycle_enrollments: [], followup_queue: [],
      profiles: [{ id: 'u1', email: 'Pro@Co.com', full_name: 'Chidi Eze', preferred_lang: 'fr' }],
    });
    const f = { user_role: 'client', inviter_user_id: 'u1', inviter_role: 'contractor', project_id: 'p1', project_name: 'Villa' };
    expect((await enrollForEvent(svc, 'client_invited', { email: 'Ada@x.co' }, f)).enrolled).toBe(1);
    const row = svc.tables.lifecycle_enrollments[0];
    expect(row).toMatchObject({ email: 'pro@co.com', subject_email: 'ada@x.co', lang: 'fr', ref: 'p1:ada@x.co' });
    expect(row.context).toMatchObject({ client_name: 'Ada@x.co', contractor_name: 'Chidi Eze', project_name: 'Villa' });
    expect((await enrollForEvent(svc, 'invitation_accepted', { email: 'ada@x.co' }, f)).exited).toBe(1);
    expect(svc.tables.lifecycle_enrollments[0].status).toBe('exited');
  });
  it("ends the project owner's reminders when the project's invitation goes out", async () => {
    const svc = fakeSvc({
      lifecycle_sequences: [mkSeq({ key: 'invite', trigger_event: 'project_created', exit_events: ['client_invited'] })],
      lifecycle_sequence_steps: [step('invite')],
      lifecycle_enrollments: [{ id: 'e1', sequence_key: 'invite', email: 'pro@co.com', ref: 'p1', status: 'active' },
                              { id: 'e2', sequence_key: 'invite', email: 'pro@co.com', ref: 'p2', status: 'active' }],
      followup_queue: [], profiles: [{ id: 'u1', email: 'pro@co.com' }],
    });
    await enrollForEvent(svc, 'client_invited', { email: 'ada@x.co' }, { inviter_user_id: 'u1', project_id: 'p1' });
    expect(svc.tables.lifecycle_enrollments.map((r: any) => r.status)).toEqual(['exited', 'active']);
  });
  it('skips the generic welcome for someone already being invited, and keeps a second project separate', async () => {
    const svc = fakeSvc({
      lifecycle_sequences: [mkSeq({ key: 'welcome', trigger_event: 'user_signup', skip_if_active_in: ['invited'] }),
                            mkSeq({ key: 'proj', trigger_event: 'project_created' })],
      lifecycle_sequence_steps: [step('welcome'), step('proj')],
      lifecycle_enrollments: [{ id: 'e1', sequence_key: 'invited', email: 'a@b.co', status: 'active' }], followup_queue: [],
    });
    expect((await enrollForEvent(svc, 'user_signup', { email: 'a@b.co' })).enrolled).toBe(0);
    expect((await enrollForEvent(svc, 'project_created', { email: 'a@b.co' }, { project_id: 'p1' })).enrolled).toBe(1);
    expect((await enrollForEvent(svc, 'project_created', { email: 'a@b.co' }, { project_id: 'p2' })).enrolled).toBe(1);
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
        next_send_at: '2020-01-01T00:00:00Z', enrolled_at: '2020-01-01T00:00:00Z', context: { project_id: 'project' } }],
      followup_queue: [] });
    const r = await runDue(svc, new Date('2020-01-09T00:00:00Z'));
    expect(r.followups).toBe(1);
    expect(svc.tables.followup_queue).toHaveLength(1);
    expect(svc.tables.lifecycle_enrollments[0].status).toBe('completed');
  });
});


describe('invitation delivery and project scope', () => {
  it('starts at Day 1 when the invitation endpoint already sent the initial email', async () => {
    const now = new Date('2026-11-13T00:00:00Z');
    const svc = fakeSvc({ lifecycle_sequences: [{ key: 'ci', enabled: true, trigger_event: 'contractor_invited', audience: 'contractor', exit_events: [] }],
      lifecycle_sequence_steps: [{ sequence_key: 'ci', position: 1, delay_hours: 0, code: 'CI01', channel: 'email' },
        { sequence_key: 'ci', position: 2, delay_hours: 24, code: 'CI02', channel: 'email' }], lifecycle_enrollments: [] });
    await enrollForEvent(svc, 'contractor_invited', { email: 'builder@example.test' }, {
      user_role: 'contractor', invitation_email_sent: true, invitation_email_subject: 'Actual invitation subject', project_id: 'project',
    }, now);
    expect(svc.tables.lifecycle_enrollments[0]).toMatchObject({ next_position: 2, next_send_at: '2026-11-14T00:00:00.000Z', emails_sent: 1 });
    expect(svc.tables.lifecycle_sends).toEqual([expect.objectContaining({ enrollment_id: 'id0', step_code: 'CI01', status: 'sent', subject: 'Actual invitation subject' })]);
  });
  it('ends reminders for the affected project and preserves another project', async () => {
    const svc = fakeSvc({ lifecycle_sequences: [{ key: 'pending', enabled: true, trigger_event: 'client_invited', audience: 'contractor', exit_events: ['invitation_accepted'] }],
      lifecycle_enrollments: [
        { id: 'p1', sequence_key: 'pending', email: 'builder@example.test', subject_email: 'client@example.test', ref: 'project1:client@example.test', status: 'active' },
        { id: 'p2', sequence_key: 'pending', email: 'builder@example.test', subject_email: 'client@example.test', ref: 'project2:client@example.test', status: 'active' },
      ], followup_queue: [] });
    await enrollForEvent(svc, 'invitation_accepted', { email: 'client@example.test' }, { project_id: 'project1' });
    expect(svc.tables.lifecycle_enrollments.map(row => row.status)).toEqual(['exited', 'active']);
  });
});


describe('reissued primary invitations', () => {
  it('starts a new reminder clock for a new token and retires the previous invitation', async () => {
    const svc = fakeSvc({ lifecycle_sequences: [{ key: 'ci', enabled: true, trigger_event: 'contractor_invited', audience: 'contractor', exit_events: [] }],
      lifecycle_sequence_steps: [{ sequence_key: 'ci', position: 1, delay_hours: 0, code: 'CI01', channel: 'email' },
        { sequence_key: 'ci', position: 2, delay_hours: 24, code: 'CI02', channel: 'email' }], lifecycle_enrollments: [], followup_queue: [] });
    const person = { email: 'builder@example.test' };
    const fields = { user_role: 'contractor', project_id: 'project', invitation_email_sent: true };
    await enrollForEvent(svc, 'contractor_invited', person, { ...fields, invite_path: '/invite/old-token' });
    const result = await enrollForEvent(svc, 'contractor_invited', person, { ...fields, invite_path: '/invite/new-token' });
    expect(result).toMatchObject({ exited: 1, enrolled: 1 });
    expect(svc.tables.lifecycle_enrollments).toHaveLength(2);
    expect(svc.tables.lifecycle_enrollments[0]).toMatchObject({ status: 'exited', exit_reason: 'invitation_replaced' });
    expect(svc.tables.lifecycle_enrollments[1]).toMatchObject({ status: 'active', ref: 'project:new-token', next_position: 2 });
  });
});
