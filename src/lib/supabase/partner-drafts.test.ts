import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A partner who starts the application and stops has to show up somewhere.
 *
 * /admin/drafts has listed abandoned applications since 043, but only from the public
 * form at /contractor-apply. The in-app partner application (133) wrote nothing until
 * it was submitted, so somebody five questions in who walked away left no trace and
 * nobody to follow up.
 *
 * The two are different people needing opposite follow-ups, so the row says which.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) => s.replace(/--.*$/gm, '');

const m138  = read('supabase/migrations/138_partner_drafts_are_marked.sql');
const lib   = read('src/lib/supabase/application-drafts.ts');
const form  = read('src/app/routes/work/partner.tsx');
const admin = read('src/app/routes/admin/drafts.tsx');

describe('the two doors are told apart', () => {
  it('source uses the same words as contractor_applications', () => {
    // 133 named these on the applications table. A second vocabulary for the same idea
    // would mean joining the two lists required a translation step.
    expect(strip(m138)).toMatch(/CHECK \(source IN \('public', 'in_app'\)\)/);
  });

  it('existing rows stay public without a backfill', () => {
    expect(strip(m138)).toMatch(/source\s+TEXT NOT NULL DEFAULT 'public'/);
  });

  it('an in-app draft must name its author', () => {
    // Without the id staff cannot open the record of somebody they already have.
    expect(strip(m138)).toMatch(/CHECK \(source <> 'in_app' OR user_id IS NOT NULL\)/);
  });

  it('and a public draft stays anonymous', () => {
    // The unguessable id in their browser is the only handle on them, by design.
    expect(strip(m138)).toMatch(/user_id UUID REFERENCES auth\.users\(id\) ON DELETE SET NULL/);
  });
});

describe('one partner is one row', () => {
  it('a second live draft for the same contractor is refused', () => {
    // Starting on a phone and again on a laptop would otherwise count one person twice
    // on the follow-up list.
    expect(strip(m138)).toMatch(
      /CREATE UNIQUE INDEX[\s\S]{0,120}\(user_id\)[\s\S]{0,80}WHERE source = 'in_app' AND submitted_application_id IS NULL/);
  });

  it('but applying again after submitting is allowed', () => {
    // The uniqueness is partial on exactly that condition, so a submitted draft frees it.
    expect(strip(m138)).toMatch(/WHERE source = 'in_app' AND submitted_application_id IS NULL/);
  });

  it('the draft id is not the user id', () => {
    // 043's UPDATE policy is USING (true) — the id IS the credential, so it has to stay
    // unguessable. Keying the row by a value the holder knows would weaken that.
    expect(lib).toMatch(/crypto\.randomUUID\(\)/);
    expect(lib).not.toMatch(/partnerDraftId[\s\S]{0,200}return userId\b/);
  });

  it('and is kept per contractor, not shared with the public form', () => {
    // A contractor who once used the public form already has a draft id in storage;
    // reusing it would flip that stranger's row to in_app and attach the wrong person.
    expect(lib).toMatch(/\$\{DRAFT_KEY\}:partner:\$\{userId\}/);
  });
});

describe('finishing takes them off the list', () => {
  it('the application id comes back from the insert', () => {
    const app = read('src/lib/supabase/partner-application.ts');
    expect(app).toMatch(/\.select\('id'\)\.single\(\)/);
    expect(app).toMatch(/Promise<string \| null>/);
  });

  it('drafts are closed by user, not only by this browser’s draft id', () => {
    // Otherwise finishing on a different device leaves a row nothing will ever close,
    // and they get chased for an application they already sent.
    expect(lib).toMatch(/markPartnerDraftSubmitted[\s\S]{0,400}\.eq\('user_id', userId\)/);
    expect(lib).toMatch(/markPartnerDraftSubmitted[\s\S]{0,500}\.is\('submitted_application_id', null\)/);
  });

  it('and the form calls it on submit', () => {
    expect(form).toMatch(/markPartnerDraftSubmitted\(user\.id, applicationId\)/);
  });
});

describe('merely opening the page is not "started"', () => {
  it('nothing is written until at least one question is answered', () => {
    // Every partner who said yes at onboarding lands here. Writing on arrival would
    // fill the follow-up list with people who have done nothing, which is the opposite
    // of the signal it carries.
    expect(form).toMatch(/answered === 0\) return/);
  });

  it('and the save is debounced rather than per keystroke', () => {
    // The autosave effect: a timer that fires two seconds after they stop typing, and a
    // cleanup that cancels it. Matched as the pair, since either alone proves nothing.
    const effect = form.slice(form.indexOf('const timer = setTimeout'),
                              form.indexOf('}, [draftState'));
    expect(effect).toMatch(/saveApplicationDraft\(/);
    expect(effect).toMatch(/\}, 2_000\)/);
    expect(effect).toMatch(/clearTimeout\(timer\)/);
  });

  it('it is written as in_app, with the author', () => {
    expect(form).toMatch(/source: 'in_app'/);
    expect(form).toMatch(/userId: user\.id/);
  });
});

describe('the admin list says which is which', () => {
  it('shows a Partner or Contractor badge', () => {
    expect(admin).toMatch(/admin\.drafts\.sourcePartner/);
    expect(admin).toMatch(/admin\.drafts\.sourceContractor/);
  });

  it('and those words also work as a search', () => {
    const filter = admin.slice(admin.indexOf('const filtered'), admin.indexOf('}, [rows, query'));
    expect(filter).toMatch(/sourcePartner/);
  });

  it('in both languages', () => {
    for (const dict of ['src/lib/i18n/en.ts', 'src/lib/i18n/fr.ts']) {
      const src = read(dict);
      expect(src, `sourcePartner missing in ${dict}`).toMatch(/sourcePartner:\s*'[^']+'/);
      expect(src, `sourceContractor missing in ${dict}`).toMatch(/sourceContractor:\s*'[^']+'/);
    }
  });

  it('and French is translated, not copied', () => {
    expect(read('src/lib/i18n/fr.ts')).toMatch(/sourcePartner:\s*'Partenaire'/);
  });
});
