import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Admin-provisioned accounts hand a real credential to a member of staff. These are the
 * properties that make that acceptable, pinned as source scans because none of them is
 * something tsc or the unit tests can see:
 *
 *   · the password is drawn on the server and appears in one response, nowhere else;
 *   · only an admin can call it, and the check is on user_roles, not a client claim;
 *   · the browser never persists it;
 *   · every way into the app checks must_change_password — the sign-in form, the
 *     link callback, and the shell itself — so the temporary password cannot be kept.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const stripComments = (src: string) =>
  src.split('\n').filter(l => !/^\s*(\*|\/[/*])/.test(l)).join('\n');

const HANDLER = 'api/_handlers/admin-provision-user.ts';
const CLIENT  = 'src/lib/supabase/admin-provision.ts';
const PAGE    = 'src/app/routes/admin/users.new.tsx';

describe('admin-provision-user handler', () => {
  const code = stripComments(read(HANDLER));

  it('is registered as an action', () => {
    const events = stripComments(read('api/events.ts'));
    expect(events).toMatch(/'admin-provision-user':\s*adminProvisionUser/);
  });

  it('gates on user_roles.role = admin, not on anything the browser sends', () => {
    expect(code).toMatch(/from\('user_roles'\)/);
    expect(code).toMatch(/\.eq\('role',\s*'admin'\)/);
    // The refusal comes before any account is touched.
    const gate = code.indexOf("from('user_roles')");
    const create = code.indexOf('auth.admin.createUser(');
    expect(gate).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(gate);
  });

  it('draws the password itself and never takes one from the request', () => {
    expect(code).toMatch(/generateTemporaryPassword\(/);
    expect(code).not.toMatch(/body\.password/);
    expect(code).not.toMatch(/body\?\.password/);
  });

  it('never logs the password', () => {
    // Every console call in the file, with its argument list.
    const logs = [...code.matchAll(/console\.\w+\(([^;]*)\);/g)].map(m => m[1]);
    expect(logs.length).toBeGreaterThan(0);        // the scan found the calls at all
    for (const args of logs) expect(args).not.toMatch(/\bpassword\b/);
  });

  it('creates the account confirmed and forces the two first-sign-in steps', () => {
    expect(code).toMatch(/email_confirm:\s*true/);
    expect(code).toMatch(/email_mfa_enabled:\s*true/);
    expect(code).toMatch(/must_change_password:\s*true/);
    expect(code).toMatch(/onboarding_complete:\s*true/);
    expect(code).toMatch(/tier:\s*'jalla_management'/);
  });

  it('refuses an email that already has an account rather than re-issuing a password', () => {
    expect(code).toMatch(/'email_taken'/);
    const lookup = code.indexOf(".ilike('email'");
    const create = code.indexOf('auth.admin.createUser(');
    expect(lookup).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(lookup);
  });

  it('rolls the account back if provisioning cannot be recorded', () => {
    expect(code).toMatch(/auth\.admin\.deleteUser\(userId\)/);
  });
});

describe('the browser side', () => {
  it('never persists the password', () => {
    for (const path of [CLIENT, PAGE]) {
      const code = stripComments(read(path));
      expect(code, path).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(code, path).not.toMatch(/password=/);          // not in a URL either
    }
  });

  it('sends the caller token, so the server can check who is asking', () => {
    const code = stripComments(read(CLIENT));
    expect(code).toMatch(/Authorization:\s*`Bearer \$\{session\.access_token\}`/);
  });
});

describe('the forced password change cannot be walked around', () => {
  const ENTRY_POINTS = [
    'src/app/routes/auth/login.tsx',      // password sign-in
    'src/app/routes/auth/callback.tsx',   // magic link / OAuth / invite
    'src/app/routes/_layout.tsx',         // typing /dashboard into the bar
  ];

  it.each(ENTRY_POINTS)('%s checks must_change_password and sends to the password form', path => {
    const code = stripComments(read(path));
    expect(code).toMatch(/mustChangePassword\(/);
    expect(code).toMatch(/FORCED_PASSWORD_PATH/);
  });

  it('the check reads the guarded column, not user_metadata', () => {
    const code = stripComments(read('src/lib/auth/provisioned.ts'));
    expect(code).toMatch(/from\('profiles'\)/);
    expect(code).toMatch(/select\('must_change_password'\)/);
    expect(code).not.toMatch(/user_metadata/);
  });

  it('the sign-in form checks it before acting on the identity', () => {
    const code = stripComments(read('src/app/routes/auth/login.tsx'));
    const gate = code.indexOf('mustChangePassword(');
    const invite = code.indexOf('acceptInvite(');
    const route = code.indexOf('postAuthPath(');
    expect(gate).toBeGreaterThan(-1);
    expect(invite).toBeGreaterThan(gate);
    expect(route).toBeGreaterThan(gate);
  });

  it('migration 083 clears the flag only from a real password change, never from the client', () => {
    const sql = read('supabase/migrations/083_admin_provisioned_accounts.sql');
    expect(sql).toMatch(/AFTER UPDATE OF encrypted_password ON auth\.users/);
    expect(sql).toMatch(/WHEN \(OLD\.encrypted_password IS DISTINCT FROM NEW\.encrypted_password\)/);
    expect(sql).toMatch(/NEW\.must_change_password := OLD\.must_change_password/);
    // The guard is BEFORE UPDATE on profiles — the table the client can write.
    expect(sql).toMatch(/BEFORE UPDATE ON public\.profiles[\s\S]*guard_provisioning_columns/);
  });
});
