import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 18 Nov testing: accepting a homeowner invitation (/auth/signup?share=…) showed the email
 * field locked AND empty — the invitation carries no address, so nobody could type one.
 * The field is now locked only when the invitation actually brought an email.
 */
const page = readFileSync(resolve(__dirname, '../../app/routes/auth/signup.tsx'), 'utf8');

describe('the invitation email field', () => {
  it('is locked only when the link carried an address', () => {
    expect(page).toContain("const emailLocked    = isInviteFlow && inviteEmail.trim() !== '';");
    expect(page).toContain('{emailLocked ? (');
    expect(page).not.toMatch(/\{isInviteFlow \? \(\s*<div className="relative">\s*<Input\s*id="email"/);
  });

  it('starts filled with the invited address when there is one, and stays editable otherwise', () => {
    expect(page).toContain('useState(inviteEmail)');
    expect(page).toMatch(/autoComplete="email"\s*value=\{email\}\s*onChange=\{\(e\) => setEmail\(e\.target\.value\)\}/);
  });

  it('a homeowner invitation link sends no email, which is why the lock must not depend on the invitation alone', () => {
    const share = readFileSync(resolve(__dirname, '../../app/routes/share.tsx'), 'utf8');
    expect(share).toContain("withProjectInvitation('/auth/signup', token ? { kind: 'viewer', token } : null)");
  });
});
