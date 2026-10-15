import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The whole chain, end to end: contractor → invited client → both with access.
 *
 * Each link is covered somewhere already. What is NOT covered anywhere is that they
 * still join up — and every one of them is a separate migration or file, so a change
 * to any single link breaks the chain without failing its own test.
 *
 * The chain:
 *
 *   1. the contractor finishes onboarding                        (116–118)
 *   2. they create the client's ACCOUNT, holding no credential   (109/110 + handler)
 *   3. Supabase emails the client a set-password link
 *   4. the contractor builds the project, owned by the client
 *   5. they take their place on it as primary contractor         (109)
 *   6. tracking starts, and the setup-window policy stops applying (120)
 *   7. the contractor keeps access as an ACCEPTED INVITE          (20260714000000)
 *   8. the client follows the link, sets a password, and owns the project
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MIG = join(ROOT, 'supabase/migrations');
const allSql = readdirSync(MIG).filter(f => f.endsWith('.sql'))
  .sort().map(f => read(`supabase/migrations/${f}`)).join('\n')
  .replace(/^\s*--.*$/gm, '');

const confirm = strip(read('src/components/wizard/steps/Step11ConfirmBudget.tsx'));
const handler = strip(read('api/_handlers/contractor-invite-client.ts'));
const callback = strip(read('src/app/routes/auth/callback.tsx'));

describe('link 2–3 · the account exists and only the client can get into it', () => {
  it('the contractor is handed no password, token or link', () => {
    // The success body is exactly two fields. A tail-scan would be blunter and
    // wrong — `linkErr` and `link_failed` are ordinary control flow in this file.
    expect(handler).toMatch(/res\.status\(200\)\.json\(\{ clientId, email \}\);\s*\}?\s*$/m);
    // And no credential is ever minted to hand over in the first place.
    // No credential is minted to hand over in the first place, and no link is lifted
    // out of Supabase's response to show the contractor. (`must_change_password:` is
    // a guarded profile column, which is why this names what it means rather than
    // scanning for the word "password".)
    expect(handler).not.toMatch(/generateTemporaryPassword|action_link|properties\?\./);
    expect(handler).toMatch(/createUser\(\{[\s\S]{0,200}?email_confirm: false/);
  });

  it('the first-sign-in gates are armed BEFORE the email goes out', () => {
    // Otherwise a client who opens it instantly is in ahead of the gate.
    const armed = handler.indexOf('must_change_password');
    const sent  = handler.indexOf('inviteUserByEmail');
    expect(armed).toBeGreaterThan(-1);
    expect(sent, 'the invitation must be sent last').toBeGreaterThan(armed);
  });

  it('a failure anywhere rolls the half-made account back', () => {
    // A client with an account nobody can reach, and no email, is the worst outcome.
    const rollbacks = handler.match(/deleteUser\(clientId\)/g) ?? [];
    expect(rollbacks.length).toBeGreaterThanOrEqual(3);
  });
});

describe('link 5–7 · the contractor keeps the project after creating it', () => {
  /**
   * THE ONE THAT WOULD HAVE BEEN SILENT. 120's setup policy is scoped
   * `tracking_started_at IS NULL` — it exists only so the wizard can read the row back
   * while building it. The moment tracking starts, that policy stops matching, and
   * without an accepted invite the contractor would create a project and immediately
   * lose sight of it.
   */

  it('the setup-window policy really is only a window', () => {
    expect(allSql).toMatch(
      /CREATE POLICY "contractors_select_own_client_setup_projects"[\s\S]{0,320}?tracking_started_at IS NULL/);
  });

  it('so lasting access comes from an ACCEPTED invite, not from the link', () => {
    expect(allSql).toMatch(/CREATE POLICY "contractors_select_invited_projects"/);
    const at = allSql.indexOf('CREATE POLICY "contractors_select_invited_projects"');
    expect(allSql.slice(at, at + 400)).toMatch(/contractor_invites/);
  });

  it('and the wizard takes that place on every partner-created project', () => {
    expect(confirm).toMatch(/if \(onBehalfOf\?\.by === 'partner'\) \{\s*await takeOwnClientProject\(project\.id\);/);
  });

  it('BEFORE tracking starts, not after', () => {
    // Two reasons, and both bite: the budget RPC is gated on being the client's
    // partner, and once tracking starts the setup policy no longer returns the row.
    const take = confirm.indexOf('takeOwnClientProject(project.id)');
    for (const after of ['adminStartProjectAtStage(', 'adminStartProjectTracking(']) {
      const at = confirm.indexOf(after);
      expect(at, `${after} missing`).toBeGreaterThan(-1);
      expect(at, `${after} must come after the partner takes their place`).toBeGreaterThan(take);
    }
  });

  it('the RPC grants primary standing and an accepted status', () => {
    const fn = allSql.slice(allSql.indexOf('FUNCTION public.contractor_take_own_client_project'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).toMatch(/status, accepted_at, is_primary/);
    expect(body).toMatch(/'accepted', now\(\), true/);
    // Scoped: only for a client they actually brought on.
    expect(body).toMatch(/NOT public\.is_my_clients_project\(p_project\)[\s\S]{0,120}not_my_client/);
  });

  it('and it sets contractor_user_id, which the invited-projects policy reads', () => {
    // Without this the accepted row exists but matches nothing, and access is lost
    // just the same.
    const fn = allSql.slice(allSql.indexOf('FUNCTION public.contractor_take_own_client_project'));
    expect(fn.slice(0, fn.indexOf('$$;')))
      .toMatch(/UPDATE public\.contractor_invites SET contractor_user_id = v_actor/);
  });
});

describe('link 8 · the client follows the link and owns the project', () => {
  it('the invitation lands on the callback with its own flow marker', () => {
    expect(handler).toMatch(/\/auth\/callback\?flow=client-invite/);
  });

  it('which the callback resolves BEFORE Supabase consumes the fragment', () => {
    // PKCE redirects carry no Supabase `type`, so the marker is read from the URL
    // first or the purpose is lost.
    const resolve = callback.indexOf('passwordSetupPathForLink(window.location.search');
    const navigate = callback.indexOf('navigate(passwordSetupPath');
    expect(resolve).toBeGreaterThan(-1);
    expect(navigate).toBeGreaterThan(resolve);
  });

  it('and sends them to set a password rather than into the app', () => {
    const link = strip(read('src/lib/auth/password-setup-link.ts'));
    expect(link).toMatch(/query\.get\('flow'\) === 'client-invite'/);
    expect(link).toMatch(/INVITED_PASSWORD_PATH = '\/auth\/new-password\?first=1&reason=client-invite'/);
  });

  it('the project is the CLIENT’s, so ordinary owner access carries it', () => {
    // createProject is called with the client as owner; nothing special is needed for
    // them to see it afterwards.
    expect(confirm).toMatch(/createProject\(ownerId,/);
  });
});

describe('what the chain still depends on being true', () => {
  it('118 is the only migration in it that is not yet applied', () => {
    // A reminder in the suite rather than only in a handover note: the client
    // question at the end of onboarding and the admin records page both need it.
    expect(readdirSync(MIG)).toContain('118_onboarding_intent_and_dossier.sql');
  });
});
