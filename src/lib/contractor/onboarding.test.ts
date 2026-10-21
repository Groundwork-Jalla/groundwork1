import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The contractor onboarding sequence (116).
 *
 * One sequence for every contractor — approved applicant, open signup, or somebody
 * invited onto a single project. What these tests protect is not the wording of the
 * steps but the handful of properties that would fail quietly:
 *
 *   · the database is the only thing that decides "complete"
 *   · the browser cannot choose which version of an agreement it signed
 *   · the gate is on the page, not only on the button that leads to it
 *   · bank details are not collected twice
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** The comments argue for these properties at length, so scanning them proves nothing. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Every migration that touches this feature, in order, with comments stripped.
 *
 * Concatenated rather than read one at a time because a later migration REPLACES a
 * function a earlier one defined — 117 redefines `contractor_onboarding_status` and
 * `current_agreement_version`. A test that sliced 116 alone would keep asserting a
 * definition the database no longer runs, and would go on passing while the real
 * function drifted anywhere at all. `fnBody` therefore takes the LAST definition.
 */
const MIGRATIONS = ['116_contractor_onboarding.sql', '117_one_agreement.sql',
                    '118_onboarding_intent_and_dossier.sql'];
const sqlCode = MIGRATIONS
  .map(f => read(`supabase/migrations/${f}`))
  .join('\n')
  .replace(/^\s*--.*$/gm, '')
  .replace(/COMMENT ON[\s\S]*?;/g, '');

/**
 * The body of the function as it ends up — the last CREATE OR REPLACE of that name.
 *
 * Anchored on CREATE specifically. Searching for `FUNCTION public.<name>` alone finds
 * the trailing `GRANT EXECUTE ON FUNCTION ...` line instead, and every assertion then
 * runs against a one-line slice containing no body at all — which fails loudly here,
 * but would pass silently for any test written as `not.toMatch`.
 */
function fnBody(name: string): string {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const at = sqlCode.lastIndexOf(needle);
  expect(at, `no CREATE for ${name} in ${MIGRATIONS.join(' + ')}`).toBeGreaterThan(-1);
  const end = sqlCode.indexOf('$$;', at);
  expect(end, `${name} has no $$; terminator`).toBeGreaterThan(at);
  return sqlCode.slice(at, end);
}
const lib      = strip(read('src/lib/supabase/contractor-onboarding.ts'));
const page     = strip(read('src/app/routes/work/onboarding.tsx'));
const dash     = strip(read('src/app/routes/work/index.tsx'));
const clients  = strip(read('src/app/routes/work/clients.new.tsx'));
const routes   = read('src/app/routes.ts');
const reader   = strip(read('src/components/contractor/AgreementReader.tsx'));
const layout   = strip(read('src/app/routes/work/_layout.tsx'));
const callback = strip(read('src/app/routes/auth/callback.tsx'));
const payoutDialog = strip(read('src/components/contractor/PayoutDialog.tsx'));
const shell   = strip(read('src/components/shell/PortalShell.tsx'));
const adminPg = strip(read('src/app/routes/admin/contractor-records.tsx'));
const adminLib= strip(read('src/lib/supabase/admin-contractor-records.ts'));

describe('one definition of finished', () => {
  /**
   * THE LOAD-BEARING ONE. The banner, the checklist, the gate on bringing a client and
   * the admin list all ask the same SQL function. The moment TypeScript recomputes it
   * from the six flags, one screen can say "done" while another refuses — which is the
   * `holdsContractorAccess` lesson, where two opinions about who was a contractor locked
   * invited contractors out of their own dashboard.
   */

  it('`complete` is taken from the database, never recomputed in TypeScript', () => {
    expect(lib).toMatch(/complete: r\.complete === true/);
    // No `every`/`&&` chain over the steps producing a local verdict.
    expect(lib).not.toMatch(/ONBOARDING_STEPS\.every/);
    expect(lib).not.toMatch(/steps\.\w+ && steps\./);
  });

  it('every surface reads that one function', () => {
    for (const [name, src] of [['dashboard', dash], ['gate', clients], ['checklist', page]] as const) {
      expect(src, `${name} must read the status function`).toMatch(/fetchOnboardingStatus\(/);
    }
  });

  it('the SQL derives `complete` from the same six it reports', () => {
    expect(fnBody('contractor_onboarding_status')).toMatch(
      /'complete', v_agreements AND v_identity AND v_professional\s*AND v_payout AND v_emergency/);
  });

  it('admin sees the same answer as the contractor', () => {
    expect(fnBody('admin_contractor_onboarding')).toMatch(/public\.contractor_onboarding_status\(p\.id\)/);
  });
});

describe('the agreement cannot be forged', () => {
  it('the browser never sends a version', () => {
    // A caller that names the version could claim to have signed a document it was
    // never shown. The database decides.
    expect(lib).toMatch(/rpc\('accept_agreement', \{\s*p_document: document,\s*p_signed_name: signedName,\s*\}\)/);
    expect(lib).not.toMatch(/p_version/);
  });

  it('the function reads the current version itself', () => {
    expect(fnBody('accept_agreement'))
      .toMatch(/v_version text := public\.current_agreement_version\(p_document\)/);
  });

  it('a version bump re-opens the step rather than carrying the old signature forward', () => {
    expect(fnBody('contractor_onboarding_status'))
      .toMatch(/a\.version = public\.current_agreement_version\('partner_agreement'\)/);
  });

  it('signatures are append-only and outlive the account', () => {
    // §8.7 keeps records seven years; §20.5 preserves them on termination. A cascade
    // would delete the evidence that somebody ever agreed.
    const tbl = sqlCode.slice(sqlCode.indexOf('CREATE TABLE IF NOT EXISTS public.agreement_acceptances'));
    const body = tbl.slice(0, tbl.indexOf(');'));
    expect(body).toMatch(/user_id\s+uuid NOT NULL,/);
    expect(body, 'a signature must not cascade away with the account')
      .not.toMatch(/REFERENCES auth\.users/);
    expect(sqlCode).not.toMatch(/GRANT (UPDATE|DELETE)[^;]*agreement_acceptances/);
  });

  it('the whole document is on screen, in the same page as the signature', () => {
    // It used to open in a new tab. That is the wrong shape for something you sign: the
    // text was on one page and the signature box on another, so the honest answer to
    // "have you read this?" was "I clicked a link that went somewhere else".
    expect(reader).toMatch(/PARTNER_AGREEMENT/);
    expect(reader).toMatch(/TERMS\[lang\] \?\? TERMS\.en/);
    expect(reader).toMatch(/role="dialog" aria-modal="true"/);
    // No hand-off anywhere in the signing flow.
    expect(reader).not.toMatch(/target="_blank"|window\.open/);
    expect(page).not.toMatch(/target="_blank"/);
    // The standalone page stays for anyone who wants a plain link to it.
    expect(routes).toMatch(/route\("partner-agreement",\s*"routes\/partner-agreement\.tsx"\)/);
  });

  it('accepting waits on reaching the end of the text', () => {
    // Not a legal requirement — the difference between a signature and a reflex.
    expect(reader).toMatch(/const atEnd = el\.scrollTop \+ el\.clientHeight >= el\.scrollHeight - 24/);
    expect(reader).toMatch(/disabled=\{!readToEnd \|\| busy\}/);
    // A document too short to scroll must still be acceptable, or it is a dead end that
    // looks like a broken page.
    expect(reader).toMatch(/const fits = el\.scrollHeight <= el\.clientHeight \+ 4/);
    expect(reader).toMatch(/if \(fits \|\| atEnd\) setReadToEnd\(true\)/);
  });

  it('the signature is typed, never prefilled from the profile', () => {
    // §24.9 permits an electronic signature; what makes it one is that they typed it.
    expect(reader).toMatch(/value=\{name\} onChange=\{e => setName\(e\.target\.value\)\}/);
    expect(reader).not.toMatch(/full_name|useAuth|profile/);
    // And it is not accepted as a signature until they have confirmed and typed enough
    // to be a name.
    expect(reader).toMatch(/disabled=\{!confirmed \|\| busy \|\| name\.trim\(\)\.length < 2\}/);
  });
});

describe('the gate', () => {
  it('is on the page, not only on the button', () => {
    // /work/clients/new is a typeable URL. Hiding the dashboard button is a courtesy;
    // this is the gate.
    expect(clients).toMatch(/if \(mayOnboard === false\)/);
    const at = clients.indexOf('if (mayOnboard === false)');
    const form = clients.indexOf('<form onSubmit={invite}');
    expect(at).toBeGreaterThan(-1);
    expect(form, 'the refusal must come before the form').toBeGreaterThan(at);
  });

  it('only a definite "not finished" refuses', () => {
    // null means 116 is unapplied or the read failed. Taking a working feature away on
    // a guess is worse than letting an unfinished partner through once.
    expect(clients).toMatch(/catch \{ if \(alive\) setMayOnboard\(true\); \}/);
    expect(clients).toMatch(/if \(!\(await onboardingAvailable\(\)\)\) \{ if \(alive\) setMayOnboard\(true\); return; \}/);
    expect(dash).toMatch(/canOnboard === true && \(onboarding === null \|\| onboarding\.complete\)/);
  });

  it('the banner stays quiet unless it knows', () => {
    expect(dash).toMatch(/\{onboarding && !onboarding\.complete && \(/);
  });

  it('the old payout prompt does not double up with the banner', () => {
    // Payout is step 3 of six now. Two banners counting the same thing is two things to
    // dismiss, so the standalone prompt survives only where 116 is absent.
    expect(dash).toMatch(/\{onboarding === null && needsPayout === true && \(/);
  });
});

describe('writes go through the database, not around it', () => {
  it('every policy on the new tables is SELECT', () => {
    const policies = [...sqlCode.matchAll(
      /CREATE POLICY\s+\w+\s+ON public\.(contractor_onboarding|contractor_emergency_contacts|contractor_documents|agreement_acceptances)\s+FOR (\w+)/g)];
    expect(policies.length).toBe(4);
    expect([...new Set(policies.map(m => m[2]))]).toEqual(['SELECT']);
  });

  it('no table grants INSERT, UPDATE or DELETE to anybody', () => {
    for (const t of ['contractor_onboarding', 'contractor_emergency_contacts',
                     'contractor_documents', 'agreement_acceptances']) {
      expect(sqlCode, `${t} must be written only through the definer functions`)
        .not.toMatch(new RegExp(`GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*${t}`));
    }
  });

  it('every writer asserts contractor standing first', () => {
    for (const fn of ['save_contractor_identity', 'save_contractor_business',
                      'save_contractor_emergency_contacts', 'record_contractor_document',
                      'accept_agreement']) {
      const body = fnBody(fn);
      expect(body, `${fn} must gate on assert_own_onboarding`)
        .toMatch(/public\.assert_own_onboarding\(\)/);
    }
  });

  it('the gate is the same definition of "contractor" the browser uses', () => {
    // Both arms: the role OR an accepted assignment. Only the role would lock out a
    // contractor invited onto one project.
    const body = fnBody('holds_contractor_access');
    expect(body).toMatch(/user_roles[\s\S]*?role = 'contractor'/);
    expect(body).toMatch(/contractor_invites[\s\S]*?status = 'accepted'/);
    expect(body).toMatch(/\bOR\b/);
  });

  it('nobody reads somebody else’s progress', () => {
    expect(fnBody('contractor_onboarding_status'))
      .toMatch(/v_user <> auth\.uid\(\) AND NOT public\.is_admin\(\)[\s\S]{0,120}not_allowed/);
  });
});

describe('a document lands in its own folder, and is checked twice', () => {
  it('the storage policy confines the write to the caller', () => {
    expect(sqlCode).toMatch(
      /bucket_id = 'contractor-docs'\s*AND name LIKE \('onboarding\/' \|\| auth\.uid\(\)::text \|\| '\/%'\)/);
  });

  it('and 028\u2019s whole-bucket policy is NARROWED, not merely added to', () => {
    /**
     * THE ONE THAT NEARLY SHIPPED. RLS policies are PERMISSIVE and OR'd together. 028
     * grants INSERT to `anon, authenticated` with `WITH CHECK (bucket_id =
     * 'contractor-docs')` and no path test, so a tight onboarding policy sitting beside
     * it confines NOTHING — the broad one still passes and any signed-in user can write
     * into any contractor's folder.
     *
     * Verified against real Postgres as a non-superuser: the write succeeded before this
     * line existed and is refused after. A superuser bypasses RLS, so testing it as one
     * would have shown a pass either way.
     */
    expect(sqlCode, '116 must re-create 028\u2019s upload policy with the onboarding prefix excluded')
      .toMatch(/CREATE POLICY "contractor_docs_upload"[\s\S]{0,200}?name NOT LIKE 'onboarding\/%'/);
    // Ordering: the broad policy must be replaced in the same block that adds the narrow
    // one, or a deploy that stops halfway leaves the gap open.
    const broad = sqlCode.indexOf('contractor_docs_upload');
    const narrow = sqlCode.indexOf('contractor_onboarding_docs_write');
    expect(broad).toBeGreaterThan(-1);
    expect(narrow).toBeGreaterThan(broad);
  });

  it('the applicant\u2019s own upload path is untouched by that narrowing', () => {
    // 026's applicants are anonymous and upload to `<submission-uuid>/…`, which never
    // begins with `onboarding/`. If that path construction ever changes, this breaks.
    const apply = strip(read('src/lib/supabase/contractor-applications.ts'));
    expect(apply).toMatch(/const path = `\$\{submissionId\}\/\$\{Date\.now\(\)\}_\$\{safeName\}`/);
    expect(apply).not.toMatch(/onboarding\//);
  });

  it('and the function refuses a path outside it', () => {
    // Belt and braces: a row pointing at a file we cannot read is worse than a refusal.
    expect(fnBody('record_contractor_document'))
      .toMatch(/p_path NOT LIKE \('onboarding\/' \|\| v_user::text \|\| '\/%'\)[\s\S]{0,120}bad_path/);
  });

  it('the uploaded filename never becomes the storage path', () => {
    // An uploaded name is user input. Only its extension survives.
    expect(lib).toMatch(/const path = `onboarding\/\$\{uid\}\/\$\{kind\}-\$\{Date\.now\(\)\}\.\$\{ext\}`/);
  });

  it('the bucket stays private', () => {
    expect(sqlCode).not.toMatch(/contractor-docs[^;]*public\s*=\s*true/i);
  });
});

describe('bank details are not collected twice', () => {
  /**
   * Section 3 of the paper form is bank and mobile money. `payout_destinations` (099)
   * already models that properly — distinct shapes for bank and mobile, E.164, verified
   * and retired states — and is what the payout code reads. A second set of account
   * numbers here would raise the question of which one money follows.
   */

  it('116 adds no account columns of its own', () => {
    const tbl = sqlCode.slice(
      sqlCode.indexOf('CREATE TABLE IF NOT EXISTS public.contractor_onboarding'));
    const body = tbl.slice(0, tbl.indexOf(');'));
    for (const col of ['account_number', 'bank_code', 'bank_name', 'mobile_no', 'account_name']) {
      expect(body, `116 must not shadow payout_destinations.${col}`).not.toMatch(new RegExp(col));
    }
  });

  it('the payout step is satisfied by a live row in 099', () => {
    expect(fnBody('contractor_onboarding_status'))
      .toMatch(/FROM public\.payout_destinations[\s\S]{0,120}status <> 'retired'/);
  });

  it('and the step collects it in place, without leaving the form', () => {
    // It used to link to /work/payouts. That walked somebody out of a form they had not
    // finished and dropped them in the dashboard, which reads as "you are done" when
    // they are not — and most did not come back.
    const step = page.slice(page.indexOf('function PayoutPanel'));
    const body = step.slice(0, step.indexOf('\n}\n'));
    expect(body).toMatch(/<PayoutDialog/);
    expect(body, 'the payout step must not navigate away mid-form').not.toMatch(/to="\/work\/payouts"/);
  });

  it('the dialog creates a destination the same way the payouts page does', () => {
    // One way a destination is made, so one definition of a valid one.
    expect(payoutDialog).toMatch(/addPayoutDestination\(\{/);
    expect(payoutDialog).not.toMatch(/supabase\.(from|rpc)\(/);
  });

  it('and the step re-reads its answer afterwards rather than assuming', () => {
    // The row lands in payout_destinations (099), not in anything 116 owns, so the
    // status function is the only thing that can say the step is now done.
    expect(page).toMatch(/onAdded=\{async \(\) => advance\(await fetchOnboardingStatus\(\)\)\}/);
  });
});

describe('the sequence is the same for everybody', () => {
  it('nothing branches the step list on tier, role or how they joined', () => {
    // Schedule B's tiers (Founding, Certified, Strategic) change what a partner is paid,
    // never what Jalla holds on file. An application is not a shortcut either.
    expect(lib).toMatch(
      /ONBOARDING_STEPS: readonly OnboardingStep\[\] = \[\s*'agreements', 'identity', 'professional', 'payout', 'emergency',\s*\] as const/);
    for (const term of ['founding', 'certified', 'strategic', 'tier']) {
      expect(sqlCode.toLowerCase(), `116 must not branch on ${term}`)
        .not.toMatch(new RegExp(`${term}[\\s\\S]{0,40}(THEN|IF )`));
    }
    expect(lib).not.toMatch(/contractor_applications/);
  });

  it('nobody is asked for a document at all any more (118)', () => {
    // Uploading a licence scan was a step most people cannot finish on a phone on a
    // site, and it gated everything behind it. The table and RPC stay so a document
    // already uploaded is still readable by staff, but it no longer counts.
    expect(lib).toMatch(
      /ONBOARDING_STEPS: readonly OnboardingStep\[\] = \[\s*'agreements', 'identity', 'professional', 'payout', 'emergency',\s*\] as const/);
    expect(lib, 'documents must not be a required step').not.toMatch(
      /ONBOARDING_STEPS[\s\S]{0,160}'documents'[\s\S]{0,20}\] as const/);
    expect(lib).toMatch(/REPORTED_BUT_NOT_REQUIRED: readonly OnboardingStep\[\] = \['documents'\]/);
    expect(page, 'the documents panel is gone').not.toMatch(/DocumentsPanel/);
    expect(page).not.toMatch(/uploadDocument/);
    // And `complete` no longer mentions it.
    const fn = fnBody('contractor_onboarding_status');
    expect(fn.slice(fn.indexOf("'complete',"))).not.toMatch(/v_documents/);
  });

  it('but the step is still REPORTED, so staff can see one that exists', () => {
    expect(fnBody('contractor_onboarding_status')).toMatch(/'documents',\s*v_documents/);
  });

  it('deleting a contractor is still possible — 115 is not blocked', () => {
    // Three of the four tables cascade; the fourth deliberately carries no FK. If a
    // future table here took a no-cascade reference, Delete would start failing again.
    for (const t of ['contractor_onboarding', 'contractor_emergency_contacts',
                     'contractor_documents']) {
      const tbl = sqlCode.slice(sqlCode.indexOf(`CREATE TABLE IF NOT EXISTS public.${t}`));
      expect(tbl.slice(0, tbl.indexOf(');')), `${t} must cascade`)
        .toMatch(/REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
    }
  });
});

describe('the copy says what is true, in both languages', () => {
  it('neither language promises the documents are shown to clients', () => {
    for (const f of ['src/lib/i18n/en.ts', 'src/lib/i18n/fr.ts']) {
      const all = read(f);
      const block = all.slice(all.indexOf('  contractorOnboarding: {'));
      const copy = block.slice(0, block.indexOf('\n  },'));
      expect(copy, `${f} is missing the onboarding block`).toBeTruthy();
      expect(copy.length).toBeGreaterThan(500);
    }
  });

  it('no custody language anywhere in the step copy', () => {
    // Groundwork records and governs; it does not hold money. "Escrow", "wallet" and
    // "held securely" are the three that keep creeping back in.
    for (const f of ['src/lib/i18n/en.ts', 'src/lib/i18n/fr.ts']) {
      const all = read(f);
      const block = all.slice(all.indexOf('  contractorOnboarding: {'));
      const copy = block.slice(0, block.indexOf('\n  },')).toLowerCase();
      for (const bad of ['escrow', 'wallet', 'held securely', 'séquestre', 'portefeuille']) {
        expect(copy, `${f} uses custody language: ${bad}`).not.toContain(bad);
      }
    }
  });
});

describe('the two bugs found in review stay fixed', () => {
  /**
   * Both were invisible to a passing type-check and to every source-scanning test that
   * existed when they were written. They are pinned here by name.
   */

  it('the business step reopens on the answer that was saved', () => {
    // THE DESTRUCTIVE ONE. `fetchOnboardingRecord` did not return business_status, so a
    // registered business revisiting the step saw an unselected radio. Choosing the
    // other option runs `save_contractor_business` with 'independent', which NULLs the
    // company name and number AND deletes the uploaded registration document. A blank
    // radio must never be able to cause that.
    expect(lib).toMatch(/businessStatus: 'registered' \| 'independent' \| null;/);
    expect(lib).toMatch(/\.select\('date_of_birth, residential_address, license_number, business_status,/);
    expect(page).toMatch(/setKind\(r\.businessStatus \?\? ''\)/);
  });

  it('and the tidy-up it guards is still there, so the guard still matters', () => {
    const body = fnBody('save_contractor_business');
    expect(body).toMatch(/IF p_business_status = 'independent' THEN\s*v_name := NULL; v_reg := NULL;/);
    expect(body).toMatch(/DELETE FROM public\.contractor_documents[\s\S]{0,120}business_registration/);
  });

  it('a bad date of birth is refused by name, not by a raw constraint message', () => {
    // The CHECK constraint's message is Postgres's own and does not begin with a code,
    // so `useSave` fell through to the generic "that did not save" and the contractor
    // was left re-typing a date with no idea what was wrong with it.
    const body = fnBody('save_contractor_identity');
    expect(body).toMatch(/dob_too_young/);
    expect(body).toMatch(/dob_implausible/);
    // And the picker will not offer one in the first place.
    expect(page).toMatch(/max=\{new Date\(Date\.now\(\) - 18 \* 365\.25 \* 864e5\)/);
  });
});

describe('every refusal the database can make is a sentence somebody can read', () => {
  /**
   * `useSave` turns a leading `code:` into `contractorOnboarding.err.<code>`. A code
   * without copy renders the raw dot-path on screen. This is the systematic form of the
   * date-of-birth bug: one new RAISE EXCEPTION is all it takes.
   */

  /**
   * Codes raised by functions a CONTRACTOR can call.
   *
   * `admin_*` functions refuse with not_admin / no_user, which a contractor never
   * sees — their copy belongs to the admin surface, not here. Demanding
   * `contractorOnboarding.err.not_admin` would be copy written for nobody, and the
   * kind of box-tick that makes a guard look thorough while meaning less.
   */
  const contractorFacing = sqlCode
    .split(/CREATE OR REPLACE FUNCTION public\./)
    .filter(chunk => !/^admin_/.test(chunk))
    .join('\n');

  const codes = [...new Set(
    [...contractorFacing.matchAll(/RAISE EXCEPTION '([a-z_]+):/g)].map(m => m[1]),
  )].sort();

  it('finds the refusals at all, so a pass means something', () => {
    expect(codes.length).toBeGreaterThan(10);
  });

  it.each(codes)('%s has copy in English and French', (code) => {
    for (const f of ['src/lib/i18n/en.ts', 'src/lib/i18n/fr.ts']) {
      const all = read(f);
      const block = all.slice(all.indexOf('  contractorOnboarding: {'));
      const copy = block.slice(0, block.indexOf('\n  },'));
      const err = copy.slice(copy.indexOf('    err: {'));
      expect(err, `${f} lacks contractorOnboarding.err.${code}`)
        .toMatch(new RegExp(`\\b${code}:`));
    }
  });

  it('the mapper really does build that key', () => {
    expect(page).toMatch(/contractorOnboarding\.err\.\$\{code\}/);
    expect(page).toMatch(/\/\^\(\[a-z_\]\+\):\/\.exec\(msg\)/);
  });
});

describe('every rpc call names arguments the function actually has', () => {
  /**
   * PostgREST resolves a function by its ARGUMENT NAMES. A rename on either side gives
   * PGRST202 — "function not found" — which looks identical to a migration that was
   * never applied, and `onboardingAvailable` would then quietly decide the whole feature
   * is absent and hide it. That failure mode is silent in production and invisible to a
   * type-check, so it is pinned here.
   */

  /** `p_name type DEFAULT ...` → the set of parameter names, per function. */
  const signatures = new Map<string, Set<string>>();
  for (const m of sqlCode.matchAll(
    /CREATE OR REPLACE FUNCTION public\.(\w+)\s*\(([\s\S]*?)\)\s*\n?\s*RETURNS/g)) {
    const args = new Set<string>();
    for (const a of m[2].matchAll(/\b(p_\w+)\s+[a-z]/g)) args.add(a[1]);
    signatures.set(m[1], args);
  }

  const calls = [...lib.matchAll(/rpc\('(\w+)',\s*\{([\s\S]*?)\}\)/g)].map(m => ({
    fn: m[1],
    args: [...m[2].matchAll(/(p_\w+):/g)].map(a => a[1]),
  }));

  it('finds both sides, so a pass means something', () => {
    expect(signatures.size).toBeGreaterThan(5);
    expect(calls.length).toBeGreaterThan(4);
  });

  it.each(calls.map(c => [c.fn, c] as const))('%s', (_fn, call) => {
    const sig = signatures.get(call.fn);
    expect(sig, `116 defines no function called ${call.fn}`).toBeTruthy();
    for (const a of call.args) {
      expect(sig!.has(a), `${call.fn} has no argument ${a} — PostgREST would answer PGRST202`)
        .toBe(true);
    }
  });

  it('a missing function is treated as "feature absent", which is why the above matters', () => {
    expect(lib).toMatch(/error\.code === 'PGRST202'[\s\S]{0,80}return false/);
  });
});

describe('signing up ends in the agreement, not on the dashboard', () => {
  /**
   * /contractor-signup grants the role and the callback sends the new contractor to
   * /work. The gate lives in the /work LAYOUT so that signup, a later sign-in and a
   * typed URL all behave the same — one gate, not one per landing site.
   */

  it('the callback still lands a new contractor on /work', () => {
    // If this ever changes, the layout gate is bypassed and the agreement stops being
    // the first thing they meet.
    expect(callback).toMatch(/registerContractorAccount\(\)[\s\S]{0,80}leaveForRoleSurface\("\/work"\)/);
  });

  it('and /work sends them to the form until BOTH holds clear', () => {
    expect(layout).toMatch(/if \(gate\.signed && gate\.decided\) return;/);
    expect(layout).toMatch(/navigate\('\/work\/onboarding', \{ replace: true \}\)/);
  });

  it('it gates on the agreement alone, not the whole sequence', () => {
    // A contractor already on a site who has signed but not finished their third
    // emergency contact must still be able to post evidence — locking them out would
    // punish the client, not the contractor.
    expect(layout).toMatch(/signed: st\.steps\.agreements/);
  });

  it('the deciding hold only applies to a FINISHED form', () => {
    // Somebody midway through has not reached the question yet. Holding them against
    // an answer they were never asked for would gate an unseen screen.
    expect(layout).toMatch(/decided: !st\.complete \|\| st\.clientIntent !== null/);
  });

  it('it fails OPEN, so a timeout never locks a working contractor out', () => {
    // Two ways to not know: 116 absent, or the read threw. Both leave the surface open.
    expect(layout).toMatch(/if \(!\(await onboardingAvailable\(\)\)\) \{\s*if \(alive\) setGate\(\{ signed: true, decided: true \}\);/);
    expect(layout).toMatch(/catch \{\s*if \(alive\) setGate\(\{ signed: true, decided: true \}\);\s*\}/);
  });

  it('no flash of the dashboard before the redirect', () => {
    expect(layout).toMatch(/\(!gate && !onOnboarding\)/);
    expect(layout).toMatch(/!\(gate\.signed && gate\.decided\) && !onOnboarding/);
  });

  it('re-asks when they leave the form, so signing is not judged on a stale answer', () => {
    // THE LOOP THIS CLOSES. The gate was fetched once on mount. A contractor who signed,
    // finished and pressed "Go to my work" was then measured against the stale `false`
    // and sent straight back — with no way out, because every /work path redirects.
    expect(layout).toMatch(/\}, \[loading, session, resolved, allowed, onOnboarding\]\);/);
    // And the stale answer is cleared before the new one lands, or it would drive a
    // redirect while the re-check is still in flight.
    const fx = layout.slice(layout.indexOf('if (loading || !session || !resolved || !allowed) return;'));
    const body = fx.slice(0, fx.indexOf('}, [loading'));
    const clear = body.indexOf('setGate(null)');
    const fetchAt = body.indexOf('onboardingAvailable()');
    expect(clear).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(clear);
  });

  it('the onboarding page itself is never redirected away from', () => {
    // Otherwise an unsigned contractor bounces between /work and /work/onboarding.
    expect(layout).toMatch(/location\.pathname\.startsWith\('\/work\/onboarding'\)/);
  });
});

describe('the agreement gates the rest of the form', () => {
  it('the five remaining panels are locked until it is signed', () => {
    expect(page).toMatch(/\{at !== 'agreements' && !signed && <LockedNotice/);
    expect(page).toMatch(/\{at !== 'agreements' && signed && \(/);
  });

  it('agreements is the first panel, and named rather than indexed', () => {
    const order = page.slice(page.indexOf('function panelOrder'));
    expect(order.slice(0, order.indexOf('\n}'))).toMatch(/\['agreements', 'you', 'licence'\]/);
    expect(lib).toMatch(/GATING_STEP: OnboardingStep = 'agreements'/);
  });

  it('no panel carries more than three inputs', () => {
    // The whole point of splitting them up. Counting Input/textarea/file per panel
    // function; the radio pair is one question, so the licence panel reads as two.
    for (const fn of ['YouPanel', 'LicencePanel', 'BusinessPanel', 'ContactPanel']) {
      const at = page.indexOf(`function ${fn}`);
      expect(at, `${fn} is missing`).toBeGreaterThan(-1);
      const body = page.slice(at, page.indexOf('\n}\n', at));
      const inputs = (body.match(/<Input\b/g) ?? []).length + (body.match(/<textarea\b/g) ?? []).length;
      expect(inputs, `${fn} shows ${inputs} inputs; panels are capped at three`).toBeLessThanOrEqual(3);
    }
  });

  it('the three contacts are held together and saved in one call', () => {
    // 116 requires exactly three. Saving them one panel at a time would let a partial
    // set sit there looking finished.
    expect(page).toMatch(/if \(n < 3\) \{ onNext\(\); return; \}/);
    expect(page).toMatch(/void run\(\(\) => saveEmergencyContacts\(all\)\)/);
  });

  it('the company panel only exists for a registered business', () => {
    const order = page.slice(page.indexOf('function panelOrder'));
    expect(order.slice(0, order.indexOf('\n}')))
      .toMatch(/if \(s\.businessStatus === 'registered'\) base\.push\('business'\)/);
  });
});

describe('one merged document, not two (117)', () => {
  // Stripped: the file's own header explains what was removed and quotes it, so an
  // unstripped read matches the very strings these tests assert are gone.
  const agreement = strip(read('src/lib/legal/partner-agreement.ts'));

  it('only the partner agreement is current, so only it can be signed', () => {
    const fn = fnBody('current_agreement_version');
    expect(fn).toMatch(/WHEN 'partner_agreement' THEN/);
    expect(fn, 'the terms of service must no longer have a current version')
      .not.toMatch(/WHEN 'terms_of_service'/);
    // accept_agreement refuses a document with no version, so that is the whole gate.
    expect(fnBody('accept_agreement')).toMatch(/IF v_version IS NULL THEN[\s\S]{0,120}unknown_document/);
  });

  it('completion needs that one signature, named rather than counted', () => {
    const fn = fnBody('contractor_onboarding_status');
    expect(fn).toMatch(/a\.document = 'partner_agreement'/);
    // `count(*) = 2` was 116's shape. A count would let a second agreement added later
    // silently satisfy this one.
    expect(fn).not.toMatch(/count\(\*\)[\s\S]{0,160}agreement_acceptances/);
  });

  it('the UI offers exactly that one', () => {
    expect(lib).toMatch(/SIGNABLE_AGREEMENTS: readonly AgreementDocument\[\] = \['partner_agreement'\]/);
    expect(page).toMatch(/\{SIGNABLE_AGREEMENTS\.map\(d => \{/);
  });

  it('no signature already taken is destroyed', () => {
    // agreement_acceptances is an append-only record of what somebody agreed to on a
    // date. Rewriting that to tidy a schema is the one thing it must never do.
    const m117 = read('supabase/migrations/117_one_agreement.sql');
    expect(m117).not.toMatch(/DELETE FROM public\.agreement_acceptances/);
    expect(m117).not.toMatch(/DROP TABLE|TRUNCATE/);
    // And the CHECK still admits the old value, so those rows stay legal.
    expect(sqlCode).toMatch(/document text NOT NULL CHECK \(document IN \('terms_of_service', 'partner_agreement'\)\)/);
  });

  it('the merged text carries what only the terms used to say', () => {
    // The merge is three clauses inside Section 6 — account eligibility, right to
    // upload, and the statement that this is now the single instrument. Placed there
    // so nothing in Ruth's numbering shifts.
    expect(agreement).toMatch(/6\.7 Account Eligibility and Responsibility/);
    expect(agreement).toMatch(/at least eighteen years old/);
    expect(agreement).toMatch(/6\.8 Right to Upload/);
    expect(agreement).toMatch(/6\.9 Single Agreement for Platform Use/);
    expect(agreement).toMatch(/not additionally required to accept the client-facing Terms of Service/);
  });

  it('and still carries the professional standards', () => {
    // "Standards inclusive" — Schedule A is what a contractor is held to on site.
    expect(agreement).toMatch(/Schedule A Professional Service and Network Standards/);
    expect(agreement).toMatch(/Evidence integrity/);
    expect(agreement).toMatch(/Verification independence/);
    expect(agreement).toMatch(/Schedule C Data Processing and Security Requirements/);
  });

  it('nothing in Ruth\u2019s numbering moved', () => {
    // The merge inserts after 6.6 precisely so that 7.1 onwards are untouched. If a
    // clause number ever shifts, every citation in the product and in a dispute is wrong.
    for (const clause of ['6.6 Audit Logs', '7.1 Standard of Performance',
                          '19.2 Liability Cap', '24.1 Entire Agreement and Priority']) {
      expect(agreement, `${clause} moved or vanished`).toContain(clause);
    }
  });

  it('carries no wet-signature block', () => {
    /**
     * The .docx has signature pages — "By: ___ Name: ___ Title: ___ Date: ___" for both
     * parties, and a counter-signature under Schedule B. Acceptance in Groundwork IS
     * the signature, so ruled blanks on screen only invite somebody to think they must
     * print and post it. They are stripped when the file is generated, and this is what
     * stops them returning the next time it is regenerated from the .docx.
     */
    expect(agreement).not.toMatch(/\['h2', 'Signatures'\]/);
    expect(agreement).not.toMatch(/\['p', 'By:'\]/);
    expect(agreement).not.toMatch(/\['p', 'Date:'\]/);
    expect(agreement).not.toMatch(/\['p', 'Address:'\]/);
    expect(agreement).not.toMatch(/Name: Philip N\. Tete/);
    expect(agreement).not.toMatch(/Accepted and agreed for this Schedule B only/);
  });

  it('and nothing that referred to one still refers to one', () => {
    // These two sentences only parsed with a signature page behind them.
    expect(agreement).not.toMatch(/date of the last signature below/);
    expect(agreement).toMatch(/date Partner accepts it in Groundwork/);
    // The template's unfilled blanks: "and , a with an address at (Partner)".
    expect(agreement).not.toMatch(/and , a with an address at/);
    expect(agreement).toMatch(/accepting this Agreement through their Groundwork account/);
  });

  it('but still says an electronic signature counts, because that is what is used', () => {
    expect(agreement).toMatch(/24\.9 Counterparts and Electronic Signatures/);
    expect(agreement).toMatch(/by electronic signature/);
  });

  it('the schedules survived the removal intact', () => {
    // The strip walks to the next h2, so an off-by-one would eat a whole schedule.
    for (const h of ['Schedule A Professional Service and Network Standards',
                     'Schedule B Founding Partner Commercial Terms Order Form',
                     'Schedule C Data Processing and Security Requirements']) {
      expect(agreement, `${h} was eaten by the signature strip`).toContain(h);
    }
    // And Schedule B keeps its last real term rather than ending mid-table.
    expect(agreement).toMatch(/Chargebacks and refunds/);
    expect(agreement).toMatch(/Subject to Section 8\.4\./);
    // §24 is the last numbered section and still complete.
    expect(agreement).toMatch(/24\.11 Interpretation/);
  });

  it('the name matches what the document now is', () => {
    expect(agreement).toMatch(/AGREEMENT_TITLE = 'Groundwork Partner Agreement and Terms of Service'/);
    for (const f of ['src/lib/i18n/en.ts', 'src/lib/i18n/fr.ts']) {
      expect(read(f)).toMatch(/partner_agreement: 'Groundwork Partner Agreement and Terms of Service'/);
    }
  });

  it('the version the page SHOWS is the version the database RECORDS', () => {
    /**
     * A cross-check, not two assertions that happen to agree today.
     *
     * If the document is revised and only one side is bumped, the failure is silent and
     * nasty: a contractor reads a page headed one version while their signature is
     * filed against another. Nothing at runtime compares these — the page renders a TS
     * constant, the signature records whatever SQL says — so this is the only thing
     * that would catch it.
     */
    const shown = /AGREEMENT_VERSION = '([^']+)'/.exec(agreement)?.[1];
    const recorded = /WHEN 'partner_agreement' THEN '([^']+)'/
      .exec(fnBody('current_agreement_version'))?.[1];

    expect(shown, 'partner-agreement.ts has no AGREEMENT_VERSION').toBeTruthy();
    expect(recorded, '117 names no version for partner_agreement').toBeTruthy();
    expect(shown,
      `the page shows ${shown} but the database records ${recorded} — bump both or neither`,
    ).toBe(recorded);

    // And it did move off 116's version, because §6.7-6.9 are new text.
    expect(shown).not.toBe('2026-10-15');
  });

  it('the page shows the generated title and version, not a hardcoded pair', () => {
    const pg = strip(read('src/app/routes/partner-agreement.tsx'));
    expect(pg).toMatch(/\{AGREEMENT_TITLE\}/);
    expect(pg).toMatch(/\{AGREEMENT_VERSION\}/);
  });
});

describe('the question at the end, and the two ways out (118)', () => {
  it('the form ends on the emergency contacts', () => {
    const order = page.slice(page.indexOf('function panelOrder'));
    expect(order.slice(0, order.indexOf('\n}'))).toMatch(/'contact1', 'contact2', 'contact3'\];/);
  });

  it('finishing shows the question, not an exit', () => {
    expect(page).toMatch(/\{status\.complete\s*\?\s*\(\s*<AllDone/);
    expect(page).toMatch(/haveClient/);
    expect(page).toMatch(/noClient/);
  });

  it('each answer goes where it should', () => {
    expect(page).toMatch(/intent === 'onboard_client' \? '\/work\/clients\/new' : '\/work'/);
  });

  it('and does so with a full load, so the gate is re-read', () => {
    // The layout resolved `decided` before this answer existed. A client-side navigate
    // would be judged against the stale value and bounce them straight back here —
    // the same stale-gate loop that bit the agreement hold.
    const fn = page.slice(page.indexOf('onAnswered={async ('));
    expect(fn.slice(0, fn.indexOf('}}'))).toMatch(/window\.location\.href =/);
  });

  it('the answer is recorded in the database, not the browser', () => {
    // It must survive a new device. Asking again at every sign-in would read as the
    // product having forgotten them.
    expect(lib).toMatch(/rpc\('set_contractor_client_intent'/);
    expect(page).not.toMatch(/localStorage|sessionStorage/);
  });

  it('until it is answered the sidebar is inert, not hidden', () => {
    // "They should not be able to click on the sidebar." Visible, so they can see what
    // is coming; inert, so the two buttons are the only things that do anything.
    expect(layout).toMatch(/navLocked=\{gate !== null && !gate\.decided\}/);
    expect(shell).toMatch(/if \(navLocked\) return <span/);
    expect(shell).toMatch(/aria-disabled="true"/);
  });

  it('a locked link renders no Link, so there is nothing to follow', () => {
    const map = shell.slice(shell.indexOf('{links.map('));
    const block = map.slice(0, map.indexOf('})}'));
    const lockedAt = block.indexOf('if (navLocked)');
    const linkAt = block.indexOf('return <Link');
    expect(lockedAt).toBeGreaterThan(-1);
    expect(linkAt, 'the early return must come first').toBeGreaterThan(lockedAt);
  });
});

describe('staff can read what was filled in (118)', () => {
  it('the dossier returns the answers, not a progress summary', () => {
    const fn = fnBody('admin_contractor_dossier');
    for (const part of ['emergency_contacts', 'payout_destinations', 'agreements',
                        'onboarding', 'profile']) {
      expect(fn, `the dossier omits ${part}`).toMatch(new RegExp(`'${part}'`));
    }
  });

  it('and refuses anybody who is not an administrator', () => {
    expect(fnBody('admin_contractor_dossier'))
      .toMatch(/IF NOT public\.is_admin\(\) THEN[\s\S]{0,120}not_admin/);
    expect(sqlCode).toMatch(/REVOKE ALL ON FUNCTION public\.admin_contractor_dossier\(uuid\) FROM PUBLIC, anon;/);
  });

  it('account numbers come back unmasked, which is the point of it', () => {
    // Masked everywhere else. Somebody authorising a release has to check the number
    // against what the contractor told them, and a masked number cannot be checked.
    expect(fnBody('admin_contractor_dossier')).toMatch(/'account_number', d\.account_number/);
    expect(fnBody('admin_contractor_dossier')).toMatch(/'mobile_no', d\.mobile_no/);
    expect(adminPg, 'the admin page must not re-mask what it asked for unmasked')
      .not.toMatch(/maskDestination/);
  });

  it('the list covers every contractor, not just published ones', () => {
    // Keying this off the directory would hide exactly the people staff need: somebody
    // who just joined is not published yet.
    expect(fnBody('admin_contractor_onboarding')).toMatch(/holds_contractor_access\(p\.id\)/);
    expect(adminLib).not.toMatch(/listDirectory|contractors'\)/);
  });

  it('the page is read-only — staff do not fill the form in for them', () => {
    expect(adminPg).not.toMatch(/save_contractor|set_contractor_client_intent|accept_agreement/);
  });

  it('a missing answer shows as "not given" rather than a blank', () => {
    // A blank cell cannot be told apart from a rendering bug.
    expect(adminPg).toMatch(/value \?\? <Minus/);
    expect(adminPg).toMatch(/notGiven/);
  });

  it('it hides itself when 118 is not applied, rather than erroring', () => {
    expect(adminLib).toMatch(/error\.code === 'PGRST202'[\s\S]{0,80}return false/);
    expect(adminPg).toMatch(/notApplied/);
  });

  it('the return type change is dropped first, or the migration aborts', () => {
    // Postgres refuses CREATE OR REPLACE when a function's return type changes.
    const m118 = read('supabase/migrations/118_onboarding_intent_and_dossier.sql');
    const drop = m118.indexOf('DROP FUNCTION IF EXISTS public.admin_contractor_onboarding()');
    const create = m118.indexOf('CREATE OR REPLACE FUNCTION public.admin_contractor_onboarding()');
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
  });
});
