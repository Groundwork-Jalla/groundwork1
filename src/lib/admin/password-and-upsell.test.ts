import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/**
 * Two small things that were each reported as confusing rather than broken.
 */

describe('a password can be looked at before it is submitted', () => {
  const field = read('src/components/ui/PasswordField.tsx');
  const PAGES = ['src/app/routes/auth/login.tsx', 'src/app/routes/auth/signup.tsx',
                 'src/app/routes/auth/new-password.tsx', 'src/components/auth/RoleSignup.tsx'];

  it.each(PAGES)('%s uses the shared field, not a bare password input', (p) => {
    // Seven inputs across four files; pasting a toggle into each is how they drift.
    const src = read(p);
    expect(src).toMatch(/<PasswordField/);
    expect(src).not.toMatch(/<Input[^>]*type="password"/);
  });

  it('the toggle is a real button with a name that changes', () => {
    expect(field).toMatch(/aria-label=\{t\(shown \? 'auth\.hidePassword' : 'auth\.showPassword'\)\}/);
    expect(field).toMatch(/type="button"/);
  });

  it('and it never touches autoComplete', () => {
    // That is what tells a password manager whether this is a new password or an
    // existing one, and it must keep saying so while revealed.
    expect(field).not.toMatch(/autoComplete=/);
  });

  it('both labels exist in both languages', () => {
    for (const d of [en, fr]) {
      for (const k of ['showPassword', 'hidePassword']) {
        expect(typeof (d as any).auth[k], k).toBe('string');
      }
    }
    expect((fr as any).auth.showPassword).toBe('Afficher le mot de passe');
  });
});

describe('self-verify users are told why they have no certificate', () => {
  const page = read('src/app/routes/documents.tsx');

  it('the empty state distinguishes "not yet" from "never"', () => {
    /**
     * An approval certificate records an INDEPENDENT check. On self_verify the client
     * approves their own stages, so none is ever issued — which, with the old wording,
     * read as "yours haven't arrived yet". It is a plan boundary, not a delay.
     */
    expect(page).toMatch(/allSelfVerify \? 'documents\.certsSelfVerifyTitle' : 'documents\.noCertificates'/);
    expect(page).toMatch(/allSelfVerify \? 'documents\.certsSelfVerifyBody' : 'documents\.certsEarnBody'/);
  });

  it('and it offers the upgrade only to them', () => {
    expect(page).toMatch(/\{allSelfVerify && \(/);
    expect(page).toMatch(/documents\.certsUpgradeCta/);
    expect(page).toMatch(/to="\/upgrade"/);
  });

  it('it says what Jalla Verify actually adds, not just "upgrade"', () => {
    const body = (en as any).documents.certsSelfVerifyBody as string;
    expect(body).toMatch(/independent/i);
    expect(body).toMatch(/Jalla Verify/);
  });

  it('every new string is in both languages', () => {
    for (const d of [en, fr]) {
      for (const k of ['certsEarnBody', 'certsSelfVerifyTitle', 'certsSelfVerifyBody', 'certsUpgradeCta']) {
        expect(typeof (d as any).documents[k], k).toBe('string');
        expect((d as any).documents[k].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the fan-out and its trigger agree on what is carried', () => {
  const handler = read('api/_handlers/message-fanout.ts');

  it('both require a project and neither requires a channel', () => {
    /**
     * They disagreed, and it cost a working feature: 129 widened the trigger to any
     * channel so the WhatsApp button would send over WhatsApp, and this handler kept
     * demanding `jalla`. The database called for every message; the endpoint refused
     * every one with `not_a_project_thread`, silently.
     */
    expect(handler).toMatch(/if \(!message\.project_id\) \{/);
    expect(handler).not.toMatch(/message\.channel \?\? 'jalla'\) !== 'jalla'/);
    expect(read('supabase/migrations/129_choose_the_channel.sql'))
      .toMatch(/IF NEW\.project_id IS NULL THEN RETURN NEW; END IF;/);
  });

  it('a contact with no phone at the provider is repaired, once', () => {
    // Found live: Groundwork held +237… and the CRM contact had nothing, so every send
    // failed with CONVERSATIONS_MSG_NO_PHONE.
    expect(handler).toMatch(/NO_PHONE\|Missing phone/);
    // BY ID. An upsert matches on email and would repair a different record while the
    // send kept failing against this one — the module's own updateContactEmail warns
    // about precisely that.
    expect(handler).toMatch(/updateContactPhone\(cfg, thread\.contactId, phone as string\)/);
    expect(handler).not.toMatch(/upsertContact/);
  });
});
