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
const m139  = read('supabase/migrations/139_drafts_are_writable_again.sql');
const m143  = read('supabase/migrations/143_drafts_save_through_a_function.sql');
const lib   = read('src/lib/supabase/application-drafts.ts');
/** The module without its prose: the comments explain the bug and name the very call
 *  the code must no longer make. */
const libCode = lib.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
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

  /**
   * Closed through the function, never with a direct UPDATE.
   *
   * The direct UPDATE that used to be here failed nine times out of nine and reported
   * success every time: this table is closed to writes from anon and authenticated —
   * the rows hold applicants' names, phones and emails — so the statement matched no
   * rows, and PostgREST returns a zero-row update as 204. Four people who had applied
   * stayed on the follow-up list, one of them already offered a call.
   */
  it('closes the draft through the function, not a direct update', () => {
    expect(lib).toMatch(/markPartnerDraftSubmitted[\s\S]{0,900}rpc\('mark_contractor_draft_submitted'/);
    const body = lib.slice(lib.indexOf('export async function markPartnerDraftSubmitted'));
    const end = body.indexOf('\n}');
    expect(body.slice(0, end)).not.toMatch(/\.from\('contractor_application_drafts'\)/);
  });

  it('does not let the caller name whose draft to close', () => {
    // The function reads auth.uid() itself, so nobody can close somebody else's.
    const body = lib.slice(lib.indexOf('export async function markPartnerDraftSubmitted'));
    expect(body.slice(0, body.indexOf('\n}'))).not.toMatch(/p_user/);
  });

  it('and the form calls it on submit', () => {
    expect(form).toMatch(/markPartnerDraftSubmitted\(applicationId\)/);
  });

  /**
   * By account, not only by this browser's draft id: somebody who starts on a phone
   * and finishes on a laptop leaves a row the laptop has never heard of.
   */
  it('the function closes every open draft the account has', () => {
    const sql = read('supabase/migrations/150_a_finished_application_closes_its_draft.sql');
    expect(sql).toMatch(/WHERE user_id = v_user[\s\S]{0,120}submitted_application_id IS NULL/);
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toMatch(/v_user\s+uuid\s*:=\s*auth\.uid\(\)/);
  });
});

describe('the write goes through a function, not the table', () => {
  it('because an upsert must read the row it conflicts with', () => {
    // 143. `.upsert()` is INSERT ... ON CONFLICT DO UPDATE, and the table has no SELECT
    // policy by design — the rows hold names, phone numbers and emails. The two rules
    // were each right and together made every save fail with 42501, silently.
    expect(libCode).toMatch(/rpc\('save_contractor_draft'/);
    expect(libCode).not.toMatch(/\.upsert\(/);
  });

  it('and the source travels with it', () => {
    expect(lib).toMatch(/p_source:\s*snap\.source \?\? 'public'/);
    expect(lib).toMatch(/p_user_id:\s*snap\.userId \?\? null/);
  });

  it('an in-app draft may only be written by its owner', () => {
    // The function runs with definer rights, so without this check any caller could
    // attach a draft to any account.
    expect(strip(m143)).toMatch(/not_your_draft/);
    expect(strip(m143)).toMatch(/p_user_id IS DISTINCT FROM auth\.uid\(\)/);
  });

  it('and reading them stays staff-only', () => {
    // The alternative fix — a SELECT policy for anon — would have published every
    // applicant's name, phone number and email.
    expect(strip(m143)).not.toMatch(/FOR SELECT/);
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

  it('and only while the application has not been filed', () => {
    // state !== 'none' means it is already in the queue; autosaving then would recreate
    // a draft for somebody who has finished.
    expect(form).toMatch(/state !== 'none' \|\| answered === 0\) return/);
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

describe('a draft can actually be saved', () => {
  /**
   * Found while testing 138: every write to the table was refused with 42501, as `anon`
   * and as `authenticated` alike. 043 wrote the policies; they were not in force. The
   * autosave swallows its errors by design — an autosave must never interrupt somebody
   * applying — so this failed silently, and /admin/drafts has been listing only rows
   * written before it broke.
   */
  it('139 re-asserts the write policies for both roles', () => {
    const sql = strip(m139);
    expect(sql).toMatch(/CREATE POLICY "anyone_can_draft"[\s\S]{0,120}FOR INSERT[\s\S]{0,60}TO anon, authenticated/);
    expect(sql).toMatch(/CREATE POLICY "anyone_can_update_draft"[\s\S]{0,120}FOR UPDATE[\s\S]{0,60}TO anon, authenticated/);
  });

  it('and is idempotent, so running it twice is harmless', () => {
    for (const name of ['anyone_can_draft', 'anyone_can_update_draft',
                        'admins_read_drafts', 'admins_delete_drafts']) {
      expect(strip(m139)).toMatch(new RegExp(`DROP POLICY IF EXISTS "${name}"`));
    }
  });

  it('without opening the rows up to being read', () => {
    // Names, phone numbers and emails. Only staff read them back; the applicant's own
    // client must never call .select() on a write either.
    const sql = strip(m139);
    expect(sql).toMatch(/CREATE POLICY "admins_read_drafts"[\s\S]{0,140}USING \(public\.is_admin\(\)\)/);
    expect(sql).not.toMatch(/FOR SELECT[\s\S]{0,60}TO anon/);
  });

  it('139 restored the write policies, which are still needed', () => {
    // 139 was applied and was necessary — a plain INSERT and a PATCH both work because
    // of it. It was not sufficient: the client upserts, and 143 is what makes that
    // possible without opening the rows up to being read.
    expect(strip(m139)).toMatch(/CREATE POLICY "anyone_can_draft"/);
    expect(strip(m139)).toMatch(/CREATE POLICY "anyone_can_update_draft"/);
  });

  it('and its verification says to test the upsert, not a bare insert', () => {
    expect(m139).toMatch(/resolution=merge-duplicates/);
  });

  it('and states the grants, so a missing one is not the next silent cause', () => {
    expect(strip(m139)).toMatch(/GRANT INSERT, UPDATE ON public\.contractor_application_drafts TO anon, authenticated/);
  });
});
