import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PENDING_CLAIM_KEY } from '@/lib/supabase/contractor-claim';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * From "approved" to an account that can actually do the work.
 *
 * Approval used to email a link to /auth/signup. That produced an ordinary account: the
 * directory listing existed, the person existed, and nothing joined them — so an approved
 * contractor could sign in and find no work, and could not be assigned any.
 *
 * The chain now is: accept → token issued → emailed → account created → claim applied.
 * These pin the two places it could silently break, which are the seams: the email
 * pointing at the wrong place, and the claim never running after sign-up.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src  = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const email     = code('src/lib/email/application-decision-html.ts');
const sender    = code('api/send-application-decision.ts');
const page      = code('src/app/routes/claim.tsx');
const callback  = code('src/app/routes/auth/callback.tsx');
const routes    = code('src/app/routes.ts');
const migration = src('supabase/migrations/100_contractor_account_claim.sql');

describe('the acceptance email carries the claim link', () => {
  it('points at the branded contractor door, carrying the token', () => {
    // Was /claim/<token>, which then handed off to /auth/signup — the client page, with
    // a client heading and an account-type question the applicant had already answered.
    // One link, one page, one button now (105's sibling change).
    expect(email).toContain('`${siteUrl}/contractor-signup?t=${encodeURIComponent(claimToken)}`');
  });

  it('falls back to the application, not to a signup that cannot grant standing', () => {
    // Without a token no page can make them a contractor. /auth/signup would produce an
    // ordinary account — 100's original defect, which looks like success and is not — so
    // the button goes back to the application instead.
    expect(email).toContain('`${siteUrl}/contractor-apply`');
    expect(email).not.toContain('`${siteUrl}/auth/signup`');
  });

  it('the token is issued as the admin, not the service role', () => {
    // issue_contractor_claim reads auth.uid(); a service-role client has none.
    expect(sender).toContain("asCaller.rpc('issue_contractor_claim'");
  });

  it('a failure to issue still sends the decision', () => {
    // The status is already saved. An applicant who hears nothing is worse off than one
    // who gets the old link and has to be re-invited.
    expect(sender).toMatch(/if \(error\) console\.error\('\[decision\] could not issue a claim token/);
    expect(sender).not.toMatch(/if \(error\)[^\n]*\n\s*(res\.status|throw|return)/);
  });
});

describe('the claim survives account creation', () => {
  it('the page parks the token before sending them to sign up', () => {
    expect(page).toContain('rememberClaim(token)');
  });

  it('the callback finishes it, so nothing is pressed twice', () => {
    expect(callback).toContain('takeRememberedClaim()');
    expect(callback).toContain('await claimContractorAccount(claim)');
    expect(callback).toContain('navigate("/work", { replace: true })');
  });

  it('the claim is handled before the project invite', () => {
    // A contractor claiming an account has no project yet; running the invite branch
    // first would send them to a project that does not exist.
    expect(callback.indexOf('takeRememberedClaim()'))
      .toBeLessThan(callback.indexOf('localStorage.getItem("pendingInvite")'));
  });

  it('a used or stolen token falls through instead of stranding them', () => {
    const block = callback.slice(callback.indexOf('takeRememberedClaim()'));
    expect(block.slice(0, 400)).toContain('catch');
  });

  it('the route exists and is public', () => {
    expect(routes).toContain('route("claim/:token",        "routes/claim.tsx")');
  });

  it('the parked key is namespaced, so it cannot collide with the invite handoff', () => {
    expect(PENDING_CLAIM_KEY).toBe('pendingContractorClaim');
    expect(PENDING_CLAIM_KEY).not.toBe('pendingInvite');
  });
});

describe('the page can name the applicant before they sign in', () => {
  it('the preview RPC is granted to anon', () => {
    // A claim page that cannot say whose invitation it is reads as phishing.
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.contractor_claim_preview(uuid) TO anon, authenticated;');
  });

  it('but claiming is never anon', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.claim_contractor_account(uuid)  FROM PUBLIC, anon;');
  });

  it('an already-claimed link says so instead of failing', () => {
    expect(page).toContain('preview.claimed');
    expect(page).toContain("t('claim.alreadyTitle')");
  });
});

describe('every string is translated', () => {
  const keys = [
    'claim.eyebrow', 'claim.title', 'claim.body', 'claim.cta', 'claim.createAccount',
    'claim.haveAccount', 'claim.signIn', 'claim.invalidTitle', 'claim.invalidBody',
    'claim.alreadyTitle', 'claim.alreadyBody', 'claim.failed',
    'admin.apps.claimInvite', 'admin.apps.claimInviteHint', 'admin.apps.claimSent',
    'admin.apps.claimFailed',
  ];
  it.each(keys)('%s', key => {
    for (const [lang, dict] of [['en', en], ['fr', fr]] as const) {
      const hit = lookup(dict as never, key);
      expect(hit, `${key} missing in ${lang}`).toBeTypeOf('string');
      expect(String(hit).trim().length).toBeGreaterThan(0);
    }
  });
});
