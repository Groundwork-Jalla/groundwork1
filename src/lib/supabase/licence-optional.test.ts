import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * A mason is not an architect.
 *
 * 116 required a professional licence number in three places — the input, the save RPC
 * and the completion rule — so an independent tradesperson could not finish onboarding
 * at all. It was reported by an applicant who said plainly that he is a mason and
 * bricklayer with no formal licence and no registered company.
 *
 * The data agreed with him: of the onboarding records on the live database, 14 of 17
 * were independent and none was a registered business, and the mandatory licence box
 * had collected "No", several strings of keyboard noise, and a Registre du Commerce
 * number — which is a company registration, not a licence. The requirement was not
 * producing credentials, it was producing junk and losing people.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) => s.replace(/--.*$/gm, '');

const m141 = strip(read('supabase/migrations/141_licence_is_not_everyone.sql'));
const page = read('src/app/routes/work/onboarding.tsx');

describe('somebody with no licence can finish onboarding', () => {
  it('the save no longer refuses an empty licence', () => {
    expect(m141).not.toMatch(/RAISE EXCEPTION 'license_required/);
  });

  it('and completion does not wait on one', () => {
    // The whole gate was this conjunction. Trading status is what everyone can answer.
    expect(m141).toMatch(/v_professional := r\.business_status IS NOT NULL;/);
    expect(m141).not.toMatch(/v_professional :=[\s\S]{0,80}license_number/);
  });

  it('the field is only rendered for a regulated profession', () => {
    // 142 went further than 141: rather than showing everybody an optional box, the
    // question is skipped entirely unless the specialty is one of the regulated five.
    // A mason never sees it, which is what the applicant actually asked for.
    expect(page).toMatch(/\{needsLicence && \(/);
    expect(page).toMatch(/const needsLicence = specialty \? requiresLicence\(specialty\) : false;/);
  });

  it('and it is required of the professions that do hold one', () => {
    // Optional-for-everybody was the emergency fix. Where a licence genuinely exists,
    // asking for it is the point.
    const field = page.slice(page.indexOf('htmlFor="lic"'), page.indexOf('htmlFor="lic"') + 400);
    expect(field).toMatch(/<Input id="lic"[^>]*\brequired\b/);
  });

  it('the hint explains why they are being asked, in both languages', () => {
    for (const [name, dict] of [['en', en], ['fr', fr]] as const) {
      const hint = lookup(dict as never, 'contractorOnboarding.licenseHint');
      expect(hint, `${name} hint missing`).toBeTypeOf('string');
      expect(String(hint).trim().length).toBeGreaterThan(0);
    }
  });
});

describe('what it does not loosen', () => {
  it('how you trade is still required of everyone', () => {
    expect(m141).toMatch(/business_status_required/);
  });

  it('a registered business still owes its name and number', () => {
    expect(m141).toMatch(/business_details_required/);
  });

  it('a licence is still stored when somebody has one', () => {
    // An engineer or architect should still be recorded; the change is that the field
    // stops being a gate, not that it stops mattering.
    expect(m141).toMatch(/license_number\s*=\s*EXCLUDED\.license_number/);
  });

  it('and an absent licence is NULL, never an empty string', () => {
    // So "has no licence" and "left it blank" read identically to anybody querying it.
    expect(m141).toMatch(/NULLIF\(btrim\(coalesce\(p_license_number, ''\)\), ''\)/);
  });

  it('it does not touch who becomes a partner', () => {
    // Contractor access, partner acceptance and Certified Partner are three different
    // things. Vetting belongs at the application and the call, not at the front door.
    expect(m141).not.toMatch(/contractor_applications/);
    expect(m141).not.toMatch(/partner_interest/);
  });
});
