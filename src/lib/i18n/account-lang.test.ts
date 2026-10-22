import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reconcileLang } from './persist-lang';
import { en } from './en';
import { fr } from './fr';

/**
 * A language choice belongs to the PERSON, not to the browser they made it in.
 *
 * `profiles.preferred_lang` has been written on every explicit toggle since 025, but
 * nothing ever read it back into the UI — only `resolveRecipientLang` consulted it on
 * the way out to email. The result was a francophone contractor who picked French on
 * a laptop, opened Groundwork on their phone, and got English: their account knew,
 * their screen did not, and the mail we sent them was correctly in French the whole
 * time. Clearing site data reverted them the same way.
 */
describe('reconcileLang', () => {
  it('adopts the account choice on a browser that has never been told', () => {
    expect(reconcileLang(null, 'fr')).toEqual({ adopt: 'fr' });
    expect(reconcileLang(null, 'en')).toEqual({ adopt: 'en' });
  });

  it('does nothing for a new browser when the account never chose either', () => {
    // Detection still runs: browser locale, then English. Not this function's job.
    expect(reconcileLang(null, null)).toEqual({});
  });

  it('never undoes a toggle just pressed on this device', () => {
    // Signing in must not flip the UI out from under someone. The local choice wins
    // and is pushed up instead — the account is the stale side here.
    expect(reconcileLang('en', 'fr')).toEqual({ push: 'en' });
    expect(reconcileLang('fr', 'en')).toEqual({ push: 'fr' });
  });

  it('teaches the account a choice made before signing in', () => {
    // Chose French on the marketing site, then created an account.
    expect(reconcileLang('fr', null)).toEqual({ push: 'fr' });
  });

  it('writes nothing when the two already agree', () => {
    expect(reconcileLang('fr', 'fr')).toEqual({});
    expect(reconcileLang('en', 'en')).toEqual({});
  });
});

/**
 * A confirmation word has to be the word on the screen.
 *
 * The delete dialog rendered `profile.deleteConfirmWord` and then compared what was
 * typed against the literal 'DELETE'. That matched for as long as both languages said
 * the same thing — and would have become a locked door the moment French said
 * SUPPRIMER: the prompt asks for one word, the button only unlocks for another.
 */
describe('the delete confirmation follows the language', () => {
  const profile = readFileSync(
    join(resolve(__dirname, '..', '..', '..'), 'src/app/routes/profile.tsx'), 'utf8');

  it('asks for a different word in each language', () => {
    expect(en.profile.deleteConfirmWord).toBe('DELETE');
    expect(fr.profile.deleteConfirmWord).toBe('SUPPRIMER');
  });

  it('never compares against a hard-coded word', () => {
    expect(profile).not.toMatch(/deleteInput\s*!==\s*['"]DELETE['"]/);
    expect(profile).toContain("t('profile.deleteConfirmWord')");
  });

  it('gates the button on the same check the handler uses', () => {
    expect(profile).toContain('disabled={!deleteConfirmed}');
    expect(profile).toContain('if (!deleteConfirmed) return;');
  });
});
