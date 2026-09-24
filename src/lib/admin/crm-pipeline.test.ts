import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LANES, buildPipeline, laneForApplication, laneCounts, daysIn, syncFor,
  type ApplicationRow, type PersonRow, type ProjectRow, type WaitlistRow,
} from './crm-pipeline';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Slice 13. Groundwork stores no opportunities, so the danger on this screen is a funnel
 * that looks authoritative and is not: invented stages, merged strangers, a zero that is
 * really an unreadable table, or a number nobody can source.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const view = code('src/components/admin/CrmPipeline.tsx');
const loader = code('src/lib/supabase/crm-pipeline.ts');

const person = (o: Partial<PersonRow> = {}): PersonRow => ({
  id: 'p1', email: 'a@b.co', fullName: 'A', createdAt: '2026-01-01T00:00:00Z',
  country: 'CM', ghlContactId: null, ...o,
});
const application = (o: Partial<ApplicationRow> = {}): ApplicationRow => ({
  id: 'a1', email: 'a@b.co', fullName: 'A', status: 'pending',
  createdAt: '2026-02-01T00:00:00Z', ghlContactId: null, ...o,
});
const wait = (o: Partial<WaitlistRow> = {}): WaitlistRow => ({
  id: 'w1', email: 'a@b.co', createdAt: '2026-03-01T00:00:00Z', syncedToGhl: false, ...o,
});
const project = (o: Partial<ProjectRow> = {}): ProjectRow => ({ id: 'j1', userId: 'p1', createdAt: '2026-04-01T00:00:00Z', ...o });
const build = (o: Partial<Parameters<typeof buildPipeline>[0]> = {}) =>
  buildPipeline({ people: [], applications: [], waitlist: [], projects: [], outbox: new Map(), ...o });

describe('the lanes are the stage map, not a funnel somebody drew', () => {
  it('every pipeline lane is a key the CRM is actually configured with', () => {
    // `ghl_stage_map` keys, as documented in api/ghl/_pipeline.ts.
    const pipeline = src('api/ghl/_pipeline.ts');
    for (const lane of LANES.filter(l => l !== 'waitlist')) {
      const base = lane.split(':')[0];
      expect(pipeline, `${lane} must be an event Groundwork already pushes`).toContain(base);
    }
    expect(LANES).toHaveLength(6);
  });

  it('the waitlist lane is marked as the one that is not a pipeline stage', () => {
    // It predates the stage map and had its own webhook. Claiming otherwise in a comment
    // would be the kind of quiet inaccuracy this whole file exists to avoid.
    expect(src('src/lib/admin/crm-pipeline.ts')).toMatch(/waitlist.{0,400}not a CRM pipeline stage/s);
  });

  it('application statuses map onto the two decided lanes only', () => {
    expect(laneForApplication('pending')).toBe('contractor_application');
    expect(laneForApplication('reviewing')).toBe('contractor_application');
    expect(laneForApplication('accepted')).toBe('application_decision:accepted');
    expect(laneForApplication('rejected')).toBe('application_decision:rejected');
    // A real fifth status, which gets no lane of its own because GHL has no stage for it.
    expect(laneForApplication('disqualified')).toBe('application_decision:rejected');
    for (const s of ['pending', 'reviewing', 'accepted', 'rejected', 'disqualified']) {
      expect(LANES, `${s} must land in a real lane`).toContain(laneForApplication(s));
    }
  });

  it('every status in the 026 CHECK constraint is handled', () => {
    const inConstraint = src('supabase/migrations/026_contractor_applications.sql')
      .match(/CHECK \(status IN \(([^)]+)\)\)/)![1].match(/'([a-z]+)'/g)!.map(s => s.replace(/'/g, ''));
    for (const s of inConstraint) expect(LANES).toContain(laneForApplication(s));
  });
});

describe('nothing is merged across tables, because nothing joins them', () => {
  it('the same address in three tables is three records, not one person', () => {
    const leads = build({
      people: [person()], applications: [application()], waitlist: [wait()], projects: [],
    });
    expect(leads).toHaveLength(3);
    expect(new Set(leads.map(l => l.lane))).toEqual(new Set(['user_signup', 'contractor_application', 'waitlist']));
  });

  it('an application never claims an account', () => {
    const [lead] = build({ people: [person()], applications: [application()] })
      .filter(l => l.source === 'application');
    // 026 has no user_id. Inventing one from the email would merge strangers.
    expect(lead.personId).toBeNull();
    expect(code('src/lib/admin/crm-pipeline.ts')).not.toMatch(/emails\.has|byEmail|matchEmail/);
  });

  it('the one link that is real is the project foreign key', () => {
    const [lead] = build({ people: [person()], projects: [project()] });
    expect(lead.lane).toBe('project_created');
    expect(lead.projectId).toBe('j1');
    expect(lead.personId).toBe('p1');
  });
});

describe('unavailable is never zero', () => {
  it('an unreadable outbox makes every sync state unknown, not "not sent"', () => {
    const leads = build({ people: [person()], outbox: null });
    expect(leads[0].sync).toBe('unknown');
    expect(syncFor('a@b.co', null, null)).toBe('unknown');
  });

  it('a readable outbox with no row for them is a real "not sent"', () => {
    expect(syncFor('a@b.co', null, new Map())).toBe('none');
  });

  it('a failure outranks everything — it is the one worth acting on', () => {
    expect(syncFor('a@b.co', 'ghl_1', new Map([['a@b.co', ['sent', 'failed']]]))).toBe('failed');
    expect(syncFor('a@b.co', 'ghl_1', new Map())).toBe('mirrored');
  });

  it('the loader names what it could not read instead of dropping it silently', () => {
    expect(loader).toContain('unreadable');
    expect(view).toContain('state.unreadable.length > 0');
    expect(view).toContain('pipeline.unreadable');
  });

  it('an empty pipeline says nobody has entered, which is a real zero', () => {
    expect(build()).toEqual([]);
    expect(laneCounts([])).toEqual(Object.fromEntries(LANES.map(l => [l, 0])));
  });
});

describe('no number appears that the schema cannot source', () => {
  it('a decided application has no age, because 026 records no decision date', () => {
    const [lead] = build({ applications: [application({ status: 'accepted' })] });
    expect(lead.sinceIsLaneEntry).toBe(false);
    expect(daysIn(lead)).toBeNull();
    // And the column is spelled "—" with an explanation, not 0.
    expect(view).toContain('ageUnknownHint');
  });

  it('a lane the record entered is aged from its own timestamp', () => {
    const [lead] = build({ people: [person({ createdAt: '2026-01-01T00:00:00Z' })] });
    expect(daysIn(lead, Date.parse('2026-01-11T00:00:00Z'))).toBe(10);
  });

  it('no score, temperature, value or conversion rate anywhere', () => {
    for (const banned of [
      'score', 'Score', 'hot', 'Hot', 'warm', 'Warm', 'cold', 'Cold',
      'conversion', 'Conversion', 'revenue', 'Revenue', 'monetaryValue', 'probability', 'forecast',
    ]) {
      expect(view, `${banned} has no column behind it`).not.toContain(banned);
    }
  });

  it('no sample or hard-coded lead', () => {
    expect(view).toContain('loadPipeline');
    for (const banned of ['example.com', 'John Doe', 'Jane ', 'demoLeads', 'SAMPLE', 'mockLeads']) {
      expect(view, `${banned} would be a fabricated row`).not.toContain(banned);
    }
  });
});

describe('the pipeline tab is not the integrations page', () => {
  it('shows no configuration, no secret and no repair control', () => {
    for (const banned of [
      'apiToken', 'locationId', 'inboundSecret', 'GHL_', 'process.env',
      'retryCrmBacklog', 'syncCrmFields', 'auditCrm', 'deleteCrmDuplicates', 'fixCrmPhones',
      'getCrmStatus',
    ]) {
      expect(view, `${banned} belongs to Setup & health, not the pipeline`).not.toContain(banned);
    }
  });

  it('writes nothing — there is no safe pipeline write path', () => {
    for (const banned of ['.update(', '.insert(', '.upsert(', 'moveToStage', 'rpc(']) {
      expect(view, `${banned} would push a lead somewhere from a read-only view`).not.toContain(banned);
      expect(loader, `${banned} in the loader`).not.toContain(banned);
    }
  });

  it('adds no second conversation store', () => {
    for (const banned of ["from('conversations')", "from('project_messages')", 'sendMessage']) {
      expect(view).not.toContain(banned);
      expect(loader).not.toContain(banned);
    }
  });

  it('the setup tooling is still reachable on the same surface', () => {
    const page = code('src/app/routes/admin/crm.tsx');
    expect(page).toContain('CrmPipeline');
    expect(page).toContain('tabSetup');
    // Integrations links here for exactly that tooling; it must not have been deleted.
    expect(page).toContain('retryCrmBacklog');
    expect(code('src/app/routes/admin/integrations.tsx')).toContain('/admin/crm');
  });
});

describe('deep links only where a real key points somewhere', () => {
  it('a waitlist address reports an unknown mirror state, because nothing writes that flag', () => {
    // 023 added `synced_to_ghl` for a file that no longer exists. Reading it would say
    // "Not sent" about every address, which is a fact about deleted code, not the CRM.
    const [synced] = build({ waitlist: [wait({ syncedToGhl: true })] });
    const [notSynced] = build({ waitlist: [wait({ syncedToGhl: false })] });
    expect(synced.sync).toBe('unknown');
    expect(notSynced.sync).toBe('unknown');
  });

  it('a waitlist address offers no account link', () => {
    const [lead] = build({ waitlist: [wait()] });
    expect(lead.personId).toBeNull();
    expect(lead.projectId).toBeNull();
    expect(view).toContain('noAccount');
  });

  it('every destination is a registered admin route', () => {
    const routes = src('src/app/routes.ts');
    for (const path of ['admin/projects/:id', 'admin/clients', 'admin/applications']) {
      expect(routes, `${path} must exist`).toContain(`"${path}"`);
    }
    expect(view, 'no external navigation from the pipeline').not.toMatch(/href=["']https?:/);
  });
});

describe('EN and FR carry every new string', () => {
  it('both dictionaries answer, and the French is actually French', () => {
    const keys = [
      'admin.crm.tabPipeline', 'admin.crm.tabSetup',
      'admin.crm.pipeline.unit', 'admin.crm.pipeline.unreadable', 'admin.crm.pipeline.empty',
      'admin.crm.pipeline.colWho', 'admin.crm.pipeline.colLane', 'admin.crm.pipeline.colSync',
      'admin.crm.pipeline.ageUnknownHint', 'admin.crm.pipeline.noAccount',
      'admin.crm.pipeline.lane.waitlist', 'admin.crm.pipeline.lane.signup',
      'admin.crm.pipeline.lane.accepted', 'admin.crm.pipeline.lane.building',
      'admin.crm.pipeline.source.application', 'admin.crm.pipeline.sync.mirrored',
      'admin.crm.pipeline.sync.failed', 'admin.crm.pipeline.sync.unknown',
    ];
    const sameInBoth = ['admin.crm.tabPipeline', 'admin.crm.pipeline.colSync'];
    for (const key of keys) {
      const e = lookup(en, key), f = lookup(fr, key);
      expect(e, key).toBeTypeOf('string');
      expect(f, key).toBeTypeOf('string');
      if (!sameInBoth.includes(key)) expect(e, `${key} is not translated`).not.toBe(f);
    }
  });

  it('every lane and sync state has a label in both languages', () => {
    for (const lane of LANES) {
      const slug = { 'waitlist': 'waitlist', 'user_signup': 'signup', 'contractor_application': 'application',
        'application_decision:accepted': 'accepted', 'application_decision:rejected': 'rejected',
        'project_created': 'building' }[lane];
      expect(lookup(en, `admin.crm.pipeline.lane.${slug}`), lane).toBeTypeOf('string');
      expect(lookup(fr, `admin.crm.pipeline.lane.${slug}`), lane).toBeTypeOf('string');
    }
    for (const s of ['mirrored', 'pending', 'failed', 'none', 'unknown']) {
      expect(lookup(en, `admin.crm.pipeline.sync.${s}`), s).toBeTypeOf('string');
      expect(lookup(fr, `admin.crm.pipeline.sync.${s}`), s).toBeTypeOf('string');
    }
  });
});
