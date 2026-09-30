import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * A client invites somebody who is not on Groundwork yet.
 *
 * That invite has always granted the contractor role — `accept_contractor_invite`
 * (20260714000000) writes it on accept. Two things made it not feel like an account:
 *
 *   the email said "Accept Invite" and explained nothing about an account, and
 *   accepting dropped them on /projects/:id — the OWNER's page.
 *
 * They could read the project (project_member, 086) but every affordance there assumes
 * an owner, so an accepted invite looked like it had done nothing. Their surface is
 * /work.
 *
 * This is deliberately a different door from the application claim (100): a client
 * vouching for a named contractor on their own project is not self-registration, so it
 * needs no approved application.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const code = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const invitePage = code('src/app/routes/invite.tsx');
const callback   = code('src/app/routes/auth/callback.tsx');

describe('an accepted invite lands on the contractor surface', () => {
  it('the invite page sends them to /work', () => {
    expect(invitePage).toContain('navigate(`/work/projects/${projectId}`, { replace: true });');
    expect(invitePage).not.toContain('navigate(`/projects/${projectId}`');
  });

  it('so does the post-signup callback', () => {
    expect(callback).toContain('navigate(`/work/projects/${projectId}`, { replace: true });');
    expect(callback).not.toContain('navigate(`/projects/${projectId}`');
  });
});

describe('the invitation reads as an account, in both languages', () => {
  const accountish = {
    en: /account/i,
    fr: /compte/i,
  } as const;

  it.each(['email.invite.explain', 'email.invite.cta', 'invite.explainer', 'invite.createAccount'])(
    '%s says an account is being created', key => {
      for (const [lang, dict] of [['en', en], ['fr', fr]] as const) {
        const text = String(lookup(dict as never, key) ?? '');
        expect(text.length, `${key} missing in ${lang}`).toBeGreaterThan(0);
        expect(text, `${key} (${lang}) should mention an account`).toMatch(accountish[lang]);
      }
    });

  it('the signup subtitle for an invite mentions the contractor account', () => {
    for (const [lang, dict] of [['en', en], ['fr', fr]] as const) {
      const text = String(lookup(dict as never, 'auth.signup.subtitleInvite') ?? '');
      expect(text, `subtitleInvite (${lang})`).toMatch(accountish[lang]);
    }
  });

  it('still tells someone who already has an account what happens', () => {
    // The email cannot know whether they have one, so it must not lie to either reader.
    expect(String(lookup(en as never, 'email.invite.explain'))).toMatch(/already have an account/i);
    expect(String(lookup(fr as never, 'email.invite.explain'))).toMatch(/déjà un compte/i);
  });

  it('does not claim the account costs anything', () => {
    expect(String(lookup(en as never, 'email.invite.explain'))).toMatch(/free/i);
  });
});
