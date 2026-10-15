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

const sql      = read('supabase/migrations/116_contractor_onboarding.sql');
const sqlCode  = sql.replace(/^\s*--.*$/gm, '').replace(/COMMENT ON[\s\S]*?;/g, '');
const lib      = strip(read('src/lib/supabase/contractor-onboarding.ts'));
const page     = strip(read('src/app/routes/work/onboarding.tsx'));
const dash     = strip(read('src/app/routes/work/index.tsx'));
const clients  = strip(read('src/app/routes/work/clients.new.tsx'));
const routes   = read('src/app/routes.ts');

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
    const fn = sqlCode.slice(sqlCode.indexOf('FUNCTION public.contractor_onboarding_status'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).toMatch(
      /'complete', v_identity AND v_professional AND v_payout\s*AND v_emergency AND v_documents AND v_agreements/);
  });

  it('admin sees the same answer as the contractor', () => {
    const fn = sqlCode.slice(sqlCode.indexOf('FUNCTION public.admin_contractor_onboarding'));
    expect(fn.slice(0, fn.indexOf('$$;'))).toMatch(/public\.contractor_onboarding_status\(p\.id\)/);
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
    const fn = sqlCode.slice(sqlCode.indexOf('FUNCTION public.accept_agreement'));
    expect(fn.slice(0, fn.indexOf('$$;')))
      .toMatch(/v_version text := public\.current_agreement_version\(p_document\)/);
  });

  it('a version bump re-opens the step rather than carrying the old signature forward', () => {
    const fn = sqlCode.slice(sqlCode.indexOf('FUNCTION public.contractor_onboarding_status'));
    expect(fn.slice(0, fn.indexOf('$$;')))
      .toMatch(/a\.version = public\.current_agreement_version\(a\.document\)/);
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

  it('it can be read before it is signed', () => {
    // Signing a document nobody could open is not a signature.
    expect(routes).toMatch(/route\("partner-agreement",\s*"routes\/partner-agreement\.tsx"\)/);
    expect(page).toMatch(/href: '\/partner-agreement'/);
    expect(page).toMatch(/href: '\/terms'/);
    // And the sign button waits on the confirmation.
    expect(page).toMatch(/disabled=\{busy \|\| !\(read\[a\.key\] \?\? false\)\}/);
  });

  it('the signature is typed, never prefilled from the profile', () => {
    // §24.9 permits an electronic signature; what makes it one is that they typed it.
    const block = page.slice(page.indexOf('function AgreementsForm'));
    expect(block).toMatch(/value=\{signed\[a\.key\] \?\? ''\}/);
    expect(block).not.toMatch(/full_name|user\?\.|profile/);
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
      const at = sqlCode.indexOf(`FUNCTION public.${fn}`);
      expect(at, `${fn} is missing`).toBeGreaterThan(-1);
      const body = sqlCode.slice(at, sqlCode.indexOf('$$;', at));
      expect(body, `${fn} must gate on assert_own_onboarding`)
        .toMatch(/public\.assert_own_onboarding\(\)/);
    }
  });

  it('the gate is the same definition of "contractor" the browser uses', () => {
    // Both arms: the role OR an accepted assignment. Only the role would lock out a
    // contractor invited onto one project.
    const fn = sqlCode.slice(sqlCode.indexOf('FUNCTION public.holds_contractor_access'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).toMatch(/user_roles[\s\S]*?role = 'contractor'/);
    expect(body).toMatch(/contractor_invites[\s\S]*?status = 'accepted'/);
    expect(body).toMatch(/\bOR\b/);
  });

  it('nobody reads somebody else’s progress', () => {
    const fn = sqlCode.slice(sqlCode.indexOf('FUNCTION public.contractor_onboarding_status'));
    expect(fn.slice(0, fn.indexOf('$$;')))
      .toMatch(/v_user <> auth\.uid\(\) AND NOT public\.is_admin\(\)[\s\S]{0,120}not_allowed/);
  });
});

describe('a document lands in its own folder, and is checked twice', () => {
  it('the storage policy confines the write to the caller', () => {
    expect(sqlCode).toMatch(
      /bucket_id = 'contractor-docs'\s*AND name LIKE \('onboarding\/' \|\| auth\.uid\(\)::text \|\| '\/%'\)/);
  });

  it('and the function refuses a path outside it', () => {
    // Belt and braces: a row pointing at a file we cannot read is worse than a refusal.
    const fn = sqlCode.slice(sqlCode.indexOf('FUNCTION public.record_contractor_document'));
    expect(fn.slice(0, fn.indexOf('$$;')))
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
    const fn = sqlCode.slice(sqlCode.indexOf('FUNCTION public.contractor_onboarding_status'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).toMatch(/FROM public\.payout_destinations[\s\S]{0,120}status <> 'retired'/);
  });

  it('and the step sends them to the page that owns it', () => {
    const step = page.slice(page.indexOf('function PayoutStep'));
    expect(step.slice(0, step.indexOf('\n}'))).toMatch(/to="\/work\/payouts"/);
  });
});

describe('the sequence is the same for everybody', () => {
  it('nothing branches the step list on tier, role or how they joined', () => {
    // Schedule B's tiers (Founding, Certified, Strategic) change what a partner is paid,
    // never what Jalla holds on file. An application is not a shortcut either.
    expect(lib).toMatch(
      /ONBOARDING_STEPS = \[\s*'identity', 'professional', 'payout', 'emergency', 'documents', 'agreements',\s*\] as const/);
    for (const term of ['founding', 'certified', 'strategic', 'tier']) {
      expect(sqlCode.toLowerCase(), `116 must not branch on ${term}`)
        .not.toMatch(new RegExp(`${term}[\\s\\S]{0,40}(THEN|IF )`));
    }
    expect(lib).not.toMatch(/contractor_applications/);
  });

  it('an independent contractor is not asked for a company document', () => {
    // Otherwise the checklist is impossible to finish for a sole trader.
    const fn = sqlCode.slice(sqlCode.indexOf('FUNCTION public.contractor_onboarding_status'));
    expect(fn.slice(0, fn.indexOf('$$;')))
      .toMatch(/NOT coalesce\(v_registered, false\) OR EXISTS/);
    expect(page).toMatch(/\{status\.needsBusinessDoc && \(/);
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
