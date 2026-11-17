import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A self-signup contractor's role is granted by /auth/callback on the same first session
// that fires `crm-user`, so the role row is usually not there yet when the welcome is
// routed. The door they signed up at has to count, or every new contractor is filed as a
// client and hears the client welcome instead of their own (17 Nov 2026).
const code = readFileSync(resolve(__dirname, '../../../api/_handlers/user.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the signup welcome is routed by role OR signup door', () => {
  it('a contractor door counts before the role row exists', () => {
    expect(code).toContain("signupRoles.has('contractor') || user.user_metadata?.signup_intent === 'contractor'");
  });

  it('the door only picks the welcome: nothing here writes a role', () => {
    expect(code).not.toMatch(/from\('user_roles'\)\s*\.(insert|upsert|update)/);
    expect(code).not.toContain('register_contractor_account');
  });
});
