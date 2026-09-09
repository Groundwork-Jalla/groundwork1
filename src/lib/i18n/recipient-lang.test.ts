import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRecipientLang } from './translate';

/**
 * Outbound email is written in the RECIPIENT's language, never the sender's.
 *
 * A beta tester with an English account received a French invitation. The cause was not
 * the resolver — it was the invite endpoint passing `null` where the recipient's own
 * preference belongs, leaving the Cameroonian project country as the only signal.
 */

describe('resolveRecipientLang', () => {
  it('lets a stored choice beat the country', () => {
    // The exact reported bug: English account, Cameroonian project.
    expect(resolveRecipientLang('en', 'CM')).toBe('en');
    expect(resolveRecipientLang('fr', 'NG')).toBe('fr');
  });

  it('falls back to the country when nothing was chosen', () => {
    expect(resolveRecipientLang(null, 'CM')).toBe('fr');
    expect(resolveRecipientLang(null, 'NG')).toBe('en');
  });

  it('ignores a value that is neither language', () => {
    // `preferred_lang` is nullable and free-ish text; a stale or partial value must not
    // produce an email in no language at all.
    expect(resolveRecipientLang('de', 'CM')).toBe('fr');
    expect(resolveRecipientLang('', 'CM')).toBe('fr');
    expect(resolveRecipientLang(undefined, null)).toBe('en');
  });
});

describe('the invite endpoint reads the recipient', () => {
  const src = readFileSync(
    resolve(__dirname, '..', '..', '..', 'api/send-invite.ts'), 'utf8');

  it('looks the invitee up by their own email', () => {
    expect(src).toMatch(/from\('profiles'\)[\s\S]{0,80}preferred_lang/);
    // Case-insensitive: an invite typed `Ada@Example.com` must find `ada@example.com`.
    expect(src).toMatch(/\.ilike\('email', invite\.email\)/);
  });

  it('no longer hard-codes a null preference', () => {
    expect(src, 'the recipient preference must not be discarded again')
      .not.toMatch(/resolveRecipientLang\(\s*null/);
    expect(src).toMatch(/preferred_lang \?\? null/);
  });
});
