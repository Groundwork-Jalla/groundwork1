import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildClientInviteHtml, clientInviteSubject } from './client-invite-html';

/**
 * A contractor sets up a client's account; the client's first email is in the
 * contractor's language.
 *
 * Favour, 11 Nov 2026: "when a contractor invited a client, it sent out the email in
 * French even though that contractor was using English."
 *
 * The other two invitations were fixed that morning and this one was not, because it
 * never went through our email at all: `auth.admin.inviteUserByEmail` sends Supabase's
 * dashboard template — one template, one language, not in the repository. No line of
 * code here could have changed what that client received.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const code = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the email itself', () => {
  it('is written in the language it is asked for', () => {
    expect(buildClientInviteHtml('en', 'Brian', 'https://x/verify')).toMatch(/Set my password/);
    expect(buildClientInviteHtml('fr', 'Brian', 'https://x/verify')).toMatch(/mot de passe/);
    expect(clientInviteSubject('en', 'Brian')).toMatch(/^Brian has set up/);
    expect(clientInviteSubject('fr', 'Brian')).toMatch(/^Brian a cr/);
  });

  it('names the contractor and carries the link', () => {
    const html = buildClientInviteHtml('en', 'Sage <Ltd>', 'https://x/auth/v1/verify?type=invite&token=t');
    expect(html).toContain('Sage &lt;Ltd&gt;');          // escaped, not trusted
    expect(html).toContain('https://x/auth/v1/verify?type=invite&amp;token=t');
  });
});

describe('the handler no longer lets Supabase send it', () => {
  const src = code('api/_handlers/contractor-invite-client.ts');

  it('generates the link and sends through Resend', () => {
    expect(src).not.toMatch(/inviteUserByEmail\(/);
    expect(src).toMatch(/generateLink\(\{\s*\n?\s*type: 'invite'/);
    expect(src).toMatch(/sendViaResend\(/);
    expect(src).toMatch(/buildClientInviteHtml\(lang, contractorName, actionLink\)/);
  });

  it('keeps the same callback flow, so nothing downstream changes', () => {
    expect(src).toMatch(/\/auth\/callback\?flow=client-invite/);
  });

  it('resolves the language from the contractor, with the screen last and the country after it', () => {
    expect(src).toMatch(/const uiLang = \(req\.body as \{ lang\?: unknown \} \| undefined\)\?\.lang;/);
    expect(src).toMatch(/resolveRecipientLang\(\s*\n?\s*null,\s*\n?\s*contractor\?\.signup_country \?\? null,\s*\n?\s*contractor\?\.preferred_lang \?\? null,\s*\n?\s*uiLang === 'en' \|\| uiLang === 'fr' \? uiLang : null,/);
  });

  it('writes that language to the new account, as admin provisioning does', () => {
    // Every later email to this client reads `preferred_lang` first.
    expect(src).toMatch(/preferred_lang:\s+lang,/);
  });

  it('never returns the link to the caller', () => {
    // The contractor must not hold a credential for the client's account.
    expect(src).toMatch(/res\.status\(200\)\.json\(\{ clientId, email \}\)/);
    expect(src).not.toMatch(/json\(\{[^}]*actionLink/);
  });

  it('still rolls the account back when the email cannot be sent', () => {
    // An account whose owner never received the email is a dead end for both people.
    const afterSend = src.slice(src.indexOf('sendViaResend('));
    expect(afterSend).toMatch(/if \(!sent\.ok\)[\s\S]{0,400}deleteUser\(clientId\)/);
  });
});

describe('the caller sends the screen language', () => {
  it('contractor-clients.ts', () => {
    const src = code('src/lib/supabase/contractor-clients.ts');
    expect(src).toMatch(/lang: detectLang\(\)/);
  });
});

describe('both languages carry the copy', () => {
  it.each(['src/lib/i18n/en.ts', 'src/lib/i18n/fr.ts'])('%s', file => {
    const dict = readFileSync(resolve(ROOT, file), 'utf8');
    expect(dict).toMatch(/\n    clientInvite: \{/);
    for (const key of ['subject', 'heading', 'body', 'explain', 'cta', 'ignore']) {
      expect(dict, key).toMatch(new RegExp(`clientInvite: \\{[\\s\\S]{0,1200}${key}:`));
    }
  });
});
