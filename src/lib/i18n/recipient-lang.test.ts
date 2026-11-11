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

/**
 * The same bug, one layer out — reported again by Philip on 3 Nov 2026.
 *
 * The earlier fix made the endpoint look the invitee up, which works when the invitee
 * already has an account. Philip invited a client who did NOT: no profile, no stored
 * preference, a Cameroon build. The country was the only signal left, so an English
 * contractor's invitation went out in French, and the link then opened an English
 * interface — the email was the only French thing in the flow.
 *
 * The country says where the house is. It does not say what language two people use
 * with each other. The person pressing the button does, and they chose it explicitly.
 */
describe('with no stated choice, the inviter outranks the build country', () => {
  it('the reported case: English contractor, Cameroon build, unknown invitee', () => {
    expect(resolveRecipientLang(null, 'CM', 'en')).toBe('en');
  });

  it('and its mirror', () => {
    expect(resolveRecipientLang(null, 'US', 'fr')).toBe('fr');
  });

  it('but never over a recipient who has chosen', () => {
    // A sender must not be able to overrule a stated preference.
    expect(resolveRecipientLang('en', 'CM', 'fr')).toBe('en');
    expect(resolveRecipientLang('fr', 'US', 'en')).toBe('fr');
  });

  it('and the country still decides when nobody has chosen anything', () => {
    expect(resolveRecipientLang(null, 'CM')).toBe('fr');
    expect(resolveRecipientLang(null, 'CM', null)).toBe('fr');
    expect(resolveRecipientLang(null, 'NG', null)).toBe('en');
  });

  it('junk in the new slot falls through rather than being trusted', () => {
    expect(resolveRecipientLang(null, 'CM', 'klingon')).toBe('fr');
  });
});

describe('the current sender screen beats stale sender preferences', () => {
  /*
   * 119 of 166 accounts have never touched the toggle, so `preferred_lang` is NULL on an
   * account whose screen has been English since sign-up. Nine of the fifteen most recent
   * invitations (10–11 Nov 2026) went out in French on that basis alone — to Brian three
   * times, from an English screen. The sender's UI language is the last human signal
   * before the country guesses.
   */
  it('the reported case: English screen, nothing stored anywhere, Cameroon build', () => {
    expect(resolveRecipientLang(null, 'CM', null, 'en')).toBe('en');
  });

  it('keeps the recipient choice and uses the current sender UI over an old sender choice', () => {
    expect(resolveRecipientLang('fr', 'CM', null, 'en')).toBe('fr');   // recipient chose
    expect(resolveRecipientLang('en', 'CM', 'fr', 'fr')).toBe('en');   // recipient chose
    expect(resolveRecipientLang(null, 'CM', 'fr', 'en')).toBe('en');   // sender changed
    expect(resolveRecipientLang(null, 'CM', 'en', 'fr')).toBe('fr');
  });

  it('is ignored when it is not a language', () => {
    expect(resolveRecipientLang(null, 'CM', null, 'klingon')).toBe('fr');
    expect(resolveRecipientLang(null, 'CM', null, '')).toBe('fr');
  });
});

describe('both invitation senders pass the inviter', () => {
  it.each([
    ['contractor invite', 'api/send-invite.ts'],
    ['client invite',     'api/_handlers/send-share-invite.ts'],
  ])('%s', (_name, path) => {
    const src = readFileSync(resolve(__dirname, '..', '..', '..', path), 'utf8');
    // Read off the row, not the request body: the caller does not get to pick the
    // language any more than it gets to pick the recipient.
    expect(src).toMatch(/select\('full_name, preferred_lang'\)/);
    expect(src).toMatch(/inviter\?\.preferred_lang \?\? null,/);
    // And the sender's screen language from the body — validated to the two values,
    // and in the LAST slot, so the row always wins over the request.
    expect(src).toMatch(/const uiLang = req\.body\?\.lang;/);
    expect(src).toMatch(/inviter\?\.preferred_lang \?\? null,\s*\n\s*uiLang === 'en' \|\| uiLang === 'fr' \? uiLang : null,/);
  });

  it.each([
    ['contractor invite', 'src/lib/supabase/invites.ts',         /lang,?\s*\n?\s*\}\)/],
    ['client invite',     'src/lib/supabase/project-viewers.ts', /shareToken, lang \}\)/],
  ])('%s: the caller actually sends it', (_name, path, shape) => {
    const src = readFileSync(resolve(__dirname, '..', '..', '..', path), 'utf8');
    expect(src).toMatch(shape);
  });
});
