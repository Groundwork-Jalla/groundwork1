import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalisePhone, isE164 } from '@/lib/phone';
import { isDeliverablePhone } from './whatsapp-shortcut';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * The bug this slice closes: the profile form saved the client's phone into
 * `auth.users.user_metadata` and nowhere else, while `profiles.phone` — which every
 * product feature reads — had existed since migration 001 with NO WRITER AT ALL. The
 * client saw "Saved" and the number reached nothing.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const lib     = code('src/lib/supabase/client-contact.ts');
const page    = code('src/app/routes/profile.tsx');
const handler = code('api/_handlers/user.ts');

describe('profiles.phone is the canonical field', () => {
  it('the save writes it, not only user metadata', () => {
    expect(lib).toContain("from('profiles').update({ phone: canonical })");
    expect(lib).toContain("eq('id', userId)");
    expect(page).toContain('saveClientPhone');
  });

  it('the stored value is normalised at the write, not at read time', () => {
    expect(lib).toContain('normalisePhone(typed, country)');
    expect(lib).toContain('isE164(canonical)');
    // Rejected before the update runs, so malformed provider-ready data is never stored.
    expect(lib.indexOf('return { ok: false, problem: ')).toBeLessThan(lib.indexOf("from('profiles').update"));
  });

  it('metadata is kept aligned but is written from the canonical value', () => {
    // The copy takes what the database accepted, never what was typed.
    expect(page).toContain('phone: canonicalPhone');
    expect(page).not.toMatch(/phone:\s*phone\.trim\(\)/);
  });

  it('a client updates their own row and no other', () => {
    // 001: USING (auth.uid() = id) on UPDATE, which also serves as the check.
    expect(src('supabase/migrations/001_profiles.sql')).toContain('USING (auth.uid() = id)');
    expect(lib).toContain("eq('id', userId)");
    expect(lib).not.toMatch(/\.in\('id'|neq\('id'/);
  });
});

describe('what counts as a usable number', () => {
  it('normalises the way people actually write them', () => {
    expect(normalisePhone('670 00 00 00', 'CM')).toBe('+237670000000');
    expect(normalisePhone('+237670000000', 'CM')).toBe('+237670000000');
    expect(normalisePhone('00237670000000', 'CM')).toBe('+237670000000');
  });

  it('a number it cannot place comes back unchanged — which is not valid', () => {
    const passthrough = normalisePhone('nonsense', 'ZZ');
    expect(isE164(passthrough)).toBe(false);
    for (const bad of ['', null, undefined, '12', 'abc', '+', '+12', '+1234567890123456', '670000000']) {
      expect(isE164(bad as string), String(bad)).toBe(false);
    }
    expect(isE164('+237670000000')).toBe(true);
  });

  it('there is one validator, shared with the WhatsApp shortcut', () => {
    // A number accepted at the keyboard and refused at the provider is the worst outcome.
    expect(isDeliverablePhone).toBe(isE164);
  });

  it('there is one normaliser, shared between browser and server', () => {
    // The server module re-exports the shared one rather than keeping a second copy.
    expect(src('api/ghl/_phone.ts')).toContain("from '../../src/lib/phone.js'");
    expect(src('api/ghl/_phone.ts')).not.toContain('DIAL_CODES');
  });

  it('an empty number is legitimate and clears the field', () => {
    expect(lib).toContain('let canonical: string | null = null');
    expect(lib).toContain('if (typed) {');
  });
});

describe('the number reaches the CRM, including for clients who already synced', () => {
  it('the first sync now carries the phone', () => {
    expect(handler).toContain("select('full_name, email, country, preferred_lang, phone, synced_to_ghl, ghl_contact_id')");
    expect(handler).toMatch(/phone:\s+\(profile\.phone as string \| null\) \?\? null,/);
  });

  it('a later change updates the existing contact instead of being skipped', () => {
    // `synced_to_ghl` is the right gate for announcing a person once and the wrong one
    // for a detail they edit later.
    expect(handler).toContain('req.body?.syncPhone === true');
    expect(handler).toContain('updateContactPhone');
    expect(handler.indexOf('syncPhone === true')).toBeLessThan(handler.indexOf('profile.synced_to_ghl'));
  });

  it('it updates by contact id, so no second contact is created', () => {
    expect(handler).toContain('updateContactPhone(cfg, contactId, phone)');
    expect(handler).not.toMatch(/upsertContact\(/);
    // By id is the whole point: the upsert endpoint matches on email.
    expect(src('api/ghl/_client.ts')).toMatch(/updateContactPhone[\s\S]{0,200}PATHS\.contact\(contactId\)/);
  });

  it('the browser never calls the provider itself', () => {
    expect(lib).toContain('/api/events?action=crm-user');
    for (const banned of ['leadconnector', 'ghlFetch', 'updateContactPhone', 'GHL_']) {
      expect(lib, banned).not.toContain(banned);
      expect(page, banned).not.toContain(banned);
    }
  });

  it('a CRM failure never blocks the client saving their own number', () => {
    expect(page).toContain('void syncPhoneToCrm()');
    // Fired after the value is stored, not before.
    expect(page.indexOf('saveClientPhone')).toBeLessThan(page.indexOf('void syncPhoneToCrm()'));
  });
});

describe('a number entered before the fix is not thrown away', () => {
  it('canonical wins; legacy metadata is only a starting value', () => {
    expect(lib).toContain('legacyPhone: phone ? null : (legacy || null)');
    expect(page).toContain('c.phone ?? c.legacyPhone');
    expect(page).toContain('setPhoneLegacy(!c.phone && !!c.legacyPhone)');
  });

  it('the client is told it is not reaching us yet, and nothing is bulk-migrated', () => {
    expect(page).toContain('profile.phoneLegacy');
    expect(String(lookup(en, 'profile.phoneLegacy'))).toMatch(/not reaching us yet/i);
    // No backfill from the browser.
    expect(lib).not.toMatch(/\.select\('id'\)[\s\S]{0,80}\.update\(/);
  });
});

describe('nothing claims the number is verified', () => {
  it('no verification language anywhere near it', () => {
    for (const key of ['profile.phoneHelp', 'profile.phoneLegacy', 'profile.phoneInvalid']) {
      const copy = String(lookup(en, key));
      expect(copy, `${key} must not claim verification`).not.toMatch(/verified|verify|confirmed number/i);
    }
    expect(page).not.toMatch(/phoneVerified|verifiedPhone/);
  });

  it('EN and FR both answer, and differ', () => {
    for (const key of ['profile.phoneHelp', 'profile.phoneLegacy', 'profile.phoneInvalid']) {
      const e = lookup(en, key), f = lookup(fr, key);
      expect(e, key).toBeTypeOf('string');
      expect(f, key).toBeTypeOf('string');
      expect(e, `${key} is not translated`).not.toBe(f);
    }
  });
});
