import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContractorPayload, type ContractorLead } from '../../../api/ghl/_contractor-payload';
import type { ContractorApplicationInput } from './application-types';
import { nextOffset, pageWindow } from './paging';
import { backfillCrmAll, type BackfillPage } from '../supabase/admin-applications';

/**
 * What a person reads must not be what the database stores.
 *
 * The form stores `y10`, `two_three`, `other` — correct as keys, and what filtering and
 * matching key on. They were being passed straight through to GoHighLevel, so a contact
 * synced on 10 September 2026 carried `role: other` and `years_experience: y10`, and a
 * WhatsApp template merging `{{contact.role}}` would have sent
 *
 *     Trade applied for: other
 *
 * to the contractor it was describing. The same fields are merged into emails and
 * documents, so the template only made it visible.
 */

const ROOT = resolve(__dirname, '..', '..', '..');

/**
 * A complete, correctly-typed lead. Typed as `ContractorLead` on purpose: if the input
 * type gains a required field, this stops compiling and the tests say so. `as never`
 * would have hidden that — the tests keep passing while every real payload quietly
 * loses the field.
 */
const lead = (over: Partial<ContractorApplicationInput> = {}): ContractorLead => ({
  fullName: 'Ada Mbeki', businessName: 'Mbeki Build', phone: '670000000',
  email: 'ada@example.com', country: 'CM', city: 'Douala', portfolioUrl: '',
  role: 'general_contractor', roleOther: '',
  yearsExperience: 'y5_10', operatesAs: 'registered', teamSize: '', projectTypes: [],
  credentials: {}, uploads: [], projects: [],
  acceptsMilestones: true, acceptsVerification: true, acceptsNoSidePay: true,
  videoUrl: '', whyJoin: '', differentiator: '', readyForEarly: true,
  regions: '', concurrentProjects: '', agreedToTerms: true, lang: 'en',
  ...over, applicationId: 'a1',
});

const build = (over: Partial<ContractorApplicationInput> = {}) =>
  buildContractorPayload(lead(over)) as Record<string, unknown>;

describe('the contact reads as a person wrote it', () => {
  it('reproduces the reported contact, correctly this time', () => {
    const p = build({
      role: 'other', roleOther: 'Tiler',
      yearsExperience: 'y10', concurrentProjects: 'two_three',
      regions: "Kribi,buea.limbe, l'ouest, ebolowa",
      projectTypes: ['residential', 'commercial'],
    });
    expect(p.role).toBe('Tiler');
    expect(p.years_experience).toBe('10+ years');
    expect(p.concurrent_projects).toBe('2–3');       // en-dash: the dictionary's own
    // `l'Ouest`, not `L'ouest`: in French the elided article stays lowercase and the
    // noun takes the capital. The first thing a Cameroonian contractor reads about
    // themselves should be spelt the way they would spell it.
    expect(p.regions).toBe("Kribi, Buea, Limbe, l'Ouest, Ebolowa");
    expect(p.project_types).toBe('Residential homes, Commercial buildings');
  });

  it('never emits a known enum key', () => {
    const p = build({ yearsExperience: 'y10', concurrentProjects: 'five_plus', operatesAs: 'small_team' });
    for (const field of ['years_experience', 'concurrent_projects', 'operates_as']) {
      expect(String(p[field]), `${field} still reads as a key`).not.toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('speaks the applicant’s language', () => {
    // The WhatsApp templates are split EN/FR, and the email builder already resolves in
    // the recipient's language. A French contractor reading "Maçon" is the point.
    const fr = build({ lang: 'fr', role: 'mason', yearsExperience: 'y10' });
    expect(fr.role).toBe('Maçon');
    expect(fr.years_experience).toBe('Plus de 10 ans');
  });
});

describe('"other" always says what other', () => {
  it('uses the trade they typed', () => {
    expect(build({ role: 'other', roleOther: 'Tiler' }).role).toBe('Tiler');
  });

  it('never leaves the field empty', () => {
    // GHL has no default for a template variable — an empty merge field fails the send
    // outright, so a blank here is worse than a vague word.
    for (const roleOther of ['', '   ']) {
      const p = build({ role: 'other', roleOther });
      expect(p.role).toBe('Other');
      expect(p.role).not.toBe('');
      expect(p.role).not.toBeNull();
    }
  });

  it('trims a padded trade — the trim in the form is not the one that matters', () => {
    // The form trims before validating, but the builder is also reached by the backfill,
    // which reads stored rows the form never touched. Whitespace that was stored has to
    // be handled HERE or it goes straight into a template.
    const p = build({ role: 'other', roleOther: '  Tiler  ' });
    expect(p.role).toBe('Tiler');
    expect(p.role_other).toBe('Tiler');
  });

  it('keeps the raw answer in its own field', () => {
    expect(build({ role: 'other', roleOther: 'Tiler' }).role_other).toBe('Tiler');
  });
});

describe('an unknown value degrades to itself', () => {
  it('never ships a dictionary path into the CRM', () => {
    // `translate()` returns the key when a lookup misses. Without the guard, an enum
    // added to the form but not the dictionary reads worse than the key it replaced.
    const p = build({ yearsExperience: 'y99', concurrentProjects: 'many' });
    expect(p.years_experience).toBe('y99');
    expect(p.concurrent_projects).toBe('many');
    expect(String(p.years_experience)).not.toContain('contractorApply');
  });

  it('leaves an unanswered field null rather than guessing', () => {
    const p = build({ yearsExperience: '', concurrentProjects: '', regions: '', projectTypes: [] });
    expect(p.years_experience).toBeNull();
    expect(p.concurrent_projects).toBeNull();
    expect(p.regions).toBeNull();
    expect(p.project_types).toBeNull();
  });
});

describe('nothing that merges into a template can break the send', () => {
  // Meta rejects a template variable containing a newline, a tab, or four-plus spaces.
  // The send fails outright — no fallback, an error that names none of this — and the
  // contractor it was about simply never receives the message.

  it('single-lines regions typed with Enter between them', () => {
    const p = build({ regions: 'Kribi\nBuea\n\tLimbe    Douala' });
    expect(p.regions).toBe('Kribi, Buea, Limbe Douala');
    expect(String(p.regions)).not.toMatch(/[\n\t]| {4,}/);
  });

  it('single-lines a trade someone typed with a line break in it', () => {
    const p = build({ role: 'other', roleOther: 'Tiler\nand\tplasterer    too' });
    expect(p.role).toBe('Tiler and plasterer too');
    expect(p.role_other).toBe('Tiler and plasterer too');
  });

  it('holds for every template-bound field at once', () => {
    const p = build({
      role: 'other', roleOther: ' a\tb ',
      regions: 'x\ny\r\nz',
    });
    for (const field of ['role', 'role_other', 'regions'] as const) {
      expect(String(p[field]), `${field} would be refused by Meta`).not.toMatch(/[\r\n\t]| {4,}/);
    }
  });
});

describe('regions is tidied, never rewritten', () => {
  it('separates and capitalises without dropping anything', () => {
    // Free text, not a multi-select — so there is no option list, and every word the
    // applicant typed has to survive.
    const p = build({ regions: "Kribi,buea.limbe, l'ouest, ebolowa" });
    // Case-insensitive: capitalisation is tested on its own below. This is about loss.
    for (const word of ['kribi', 'buea', 'limbe', 'ouest', 'ebolowa']) {
      expect(String(p.regions).toLowerCase()).toContain(word);
    }
  });

  it('capitalises the noun, not the article, after an elision', () => {
    // French: l'Ouest, d'Abomey. Upcasing the first character gives L'ouest, which reads
    // as wrong to the person it describes. Straight apostrophe and curly both.
    expect(build({ regions: "l'ouest" }).regions).toBe("l'Ouest");
    expect(build({ regions: "L'OUEST" }).regions).toBe("l'OUEST");
    expect(build({ regions: "l\u2019ouest, d'abomey" }).regions).toBe("l'Ouest, d'Abomey");
    // And an ordinary name is still capitalised the ordinary way.
    expect(build({ regions: "yaoundé" }).regions).toBe("Yaoundé");
  });

  it('leaves an already-tidy answer alone', () => {
    expect(build({ regions: 'Douala, Yaoundé' }).regions).toBe('Douala, Yaoundé');
  });
});

describe('the labels have one home', () => {
  it('is the dictionary, not a lookup table in the sync', () => {
    // A second list is wrong the first time a trade is added, and only wrong in the CRM.
    const payload = readFileSync(join(ROOT, 'api/ghl/_contractor-payload.ts'), 'utf8');
    expect(payload).toMatch(/translator\(/);
    expect(payload, 'labels must be resolved, not hand-written here')
      .not.toMatch(/'y10'\s*:|'two_three'\s*:|label:\s*'/);
  });

  it('does not touch what is stored', () => {
    // The keys stay keys. Only the outbound representation changed.
    const input = lead({ role: 'other', roleOther: 'Tiler', yearsExperience: 'y10' }) as unknown as Record<string, unknown>;
    buildContractorPayload(input as never);
    expect(input.role).toBe('other');
    expect(input.yearsExperience).toBe('y10');
  });
});

describe('"other" with no trade cannot be stored', () => {
  it('is refused by the database, not only by the form', () => {
    // The form inserts into Supabase directly, so client validation is a courtesy and
    // the CHECK is the boundary.
    const sql = readFileSync(join(ROOT, 'supabase/migrations/081_role_other_required.sql'), 'utf8');
    expect(sql).toMatch(/CHECK \(role <> 'other' OR \(role_other IS NOT NULL AND btrim\(role_other\) <> ''\)\)/);
    // NOT VALID: binds new writes without failing on rows already stored.
    expect(sql).toMatch(/NOT VALID/);

    const form = readFileSync(join(ROOT, 'src/components/contractor/ContractorApplicationForm.tsx'), 'utf8');
    expect(form).toMatch(/role === 'other' && !roleOther\.trim\(\)/);
  });
});

/**
 * The backfill has to be able to reach everybody.
 *
 * The mapping above only fixes contacts synced from now on. The ones already in GHL are
 * rewritten by re-running the contractor backfill, which goes through the same payload
 * builder — so it picks the fix up for free. It could not reach past the first forty
 * people, though: the query took the oldest `MAX_PER_RUN` rows with no offset, no cursor
 * and no filter, so "re-run to continue" repeated the same forty for ever.
 */
describe('the backfill can page through the whole list', () => {
  const SIZE = 40;

  // Paging is the one thing here worth testing as behaviour. A regex over the handler's
  // source passes or fails on formatting; these fail only if the arithmetic is wrong.

  it('starts at zero and covers exactly one page', () => {
    expect(pageWindow(0, SIZE)).toEqual({ from: 0, to: 39 });
  });

  it('continues from where the previous run said to', () => {
    // The bug: every re-run started at 0, so rows 41+ were never reached. Run one
    // reports nextOffset 40; run two must begin AT 40, not at 0 and not at 41.
    const first = pageWindow(0, SIZE);
    const next  = nextOffset(0, SIZE, SIZE);
    expect(next).toBe(40);
    const second = pageWindow(next!, SIZE);
    expect(second.from).toBe(first.to + 1);
    expect(second).toEqual({ from: 40, to: 79 });
  });

  it('walks a list of 650 in seventeen runs and then stops', () => {
    let offset: number | null = 0;
    let runs = 0;
    const TOTAL = 650;
    while (offset !== null) {
      const { from, to } = pageWindow(offset, SIZE);
      const seen = Math.max(0, Math.min(to, TOTAL - 1) - from + 1);
      runs++;
      offset = nextOffset(offset, seen, SIZE);
      if (runs > 100) throw new Error('never terminated');
    }
    expect(runs).toBe(17);   // 16 full pages of 40, then a final page of 10
  });

  it('stops on a short page, which is the only signal there is', () => {
    // Nothing counts the list, so a page that comes back under size IS the end.
    expect(nextOffset(640, 10, SIZE)).toBeNull();
    expect(nextOffset(0, 0, SIZE)).toBeNull();
    // A full page is never the end, even if it happens to be the last one.
    expect(nextOffset(600, SIZE, SIZE)).toBe(640);
  });

  it('refuses to go backwards or start from nonsense', () => {
    expect(pageWindow(-5, SIZE).from).toBe(0);
    expect(pageWindow(NaN, SIZE).from).toBe(0);
    expect(pageWindow(3.7, SIZE).from).toBe(3);
    expect(nextOffset(-5, SIZE, SIZE)).toBe(40);
  });

  // The two contracts that genuinely are cross-file, and have no behaviour to invoke.
  const backfill = readFileSync(join(ROOT, 'api/_handlers/crm-backfill.ts'), 'utf8');

  it('drives both query paths through the same window', () => {
    // Contractors and users are paged separately; if one of them reverts to a bare
    // `.limit()`, that list silently caps at a page again.
    expect(backfill).toMatch(/pageWindow\(/);
    expect((backfill.match(/\.range\(from, to\)/g) ?? []).length, 'both kinds need paging').toBe(2);
    expect(backfill, 'a bare limit cannot be continued from').not.toMatch(/\.limit\(MAX_PER_RUN\)/);
  });

  it('does not filter to unsynced rows, which would skip everyone who needs it', () => {
    // A backfill exists to rewrite contacts that ARE already in the CRM.
    expect(backfill).not.toMatch(/\.eq\('synced_to_ghl'/);
  });

  it('reaches the fix without any new code, through the shared builder', () => {
    expect(backfill).toMatch(/syncContractorToApi/);
    const sync = readFileSync(join(ROOT, 'api/ghl/_contractor-sync.ts'), 'utf8');
    expect(sync).toMatch(/buildContractorPayload/);
  });
});

describe('the panel drives every page, not the first one', () => {
  /** A fake server holding `total` rows, paged at 40, that records each call. */
  function server(total: number, opts: { failAt?: number; stuck?: boolean } = {}) {
    const calls: number[] = [];
    const fetchPage = async (_k: unknown, _s: boolean, offset: number): Promise<BackfillPage> => {
      calls.push(offset);
      if (opts.failAt !== undefined && offset >= opts.failAt) return { error: 'boom' };
      const { from, to } = pageWindow(offset, 40);
      const seen = Math.max(0, Math.min(to, total - 1) - from + 1);
      return {
        offset: from, processed: seen, wouldSend: seen, wouldBackfill: 0,
        nextOffset: opts.stuck ? offset : nextOffset(offset, seen, 40),
      };
    };
    return { calls, fetchPage };
  }

  it('reaches rows 41 onward on the second call', async () => {
    // The bug in one assertion: before this, the second call never happened.
    const srv = server(650);
    await backfillCrmAll('contractors', false, undefined, srv.fetchPage);
    expect(srv.calls[0]).toBe(0);
    expect(srv.calls[1]).toBe(40);
  });

  it('walks 650 rows in seventeen calls and sums them', async () => {
    const srv = server(650);
    const pages: number[] = [];
    const r = await backfillCrmAll('contractors', false, (_p, n) => pages.push(n), srv.fetchPage);
    expect(srv.calls).toEqual(Array.from({ length: 17 }, (_, i) => i * 40));
    expect(r.pages).toBe(17);
    expect(r.processed).toBe(650);
    expect(pages).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
  });

  it('stops at the first failed page rather than skipping it', async () => {
    // A hole in the middle of a backfill is worse than a short one, because nothing
    // would say where the hole is. Stop, and say where.
    const srv = server(650, { failAt: 120 });
    const r = await backfillCrmAll('contractors', false, undefined, srv.fetchPage);
    expect(srv.calls).toEqual([0, 40, 80, 120]);
    expect(r.pages).toBe(3);
    expect(r.processed).toBe(120);
    expect(r).toMatchObject({ error: 'boom', stoppedAt: 120 });
  });

  it('cannot be made to loop forever by a server that repeats itself', async () => {
    const srv = server(650, { stuck: true });
    const r = await backfillCrmAll('contractors', false, undefined, srv.fetchPage);
    expect(srv.calls).toEqual([0]);
    expect(r.pages).toBe(1);
  });

  it('handles an empty list in one call', async () => {
    const srv = server(0);
    const r = await backfillCrmAll('contractors', false, undefined, srv.fetchPage);
    expect(srv.calls).toEqual([0]);
    expect(r.processed).toBe(0);
  });
});
