import { describe, expect, it } from 'vitest';
import { PRIVACY, TERMS } from '@/lib/legal/content';
import { MILESTONE_PAYMENTS_ARE_PREVIEW } from '@/lib/payments/config';
import type { Lang } from '@/lib/i18n/types';

/**
 * The subprocessor list has to describe the system as it actually is.
 *
 * It can be wrong in two directions, and both matter:
 *
 *   Naming a processor that handles nothing      — SwyChr was listed (as "Switchr")
 *                                                  while the payout rail had no caller
 *                                                  and no client money had ever moved
 *                                                  through it.
 *   Omitting one that does                       — the worse failure, and the one that
 *                                                  arrives quietly the day payouts go
 *                                                  live and nobody revisits the policy.
 *
 * A comment asking someone to remember is not a control. This is: the moment milestone
 * payments stop being preview, the second test below fails and the build stops until
 * the disclosure catches up.
 */
const LANGS: Lang[] = ['en', 'fr'];
const lines = (lang: Lang) => PRIVACY[lang].sections.flatMap(s => s.body);
const sharingLines = (lang: Lang) =>
  PRIVACY[lang].sections
    .filter(s => s.body.some(b => b.trim().startsWith('- ') && /Stripe/.test(b)))
    .flatMap(s => s.body)
    .filter(b => b.trim().startsWith('- '));

/** Every payout provider the product has considered, in each spelling seen in the tree. */
const PAYOUT_VENDORS = ['SwyChr', 'Swychr', 'swychr', 'Switchr', 'switchr', 'SwychrPay', 'AccountPe', 'accountpe'];

describe('the privacy policy names only processors that actually process something', () => {
  it.each(LANGS)('%s names no payout provider while the rail is unwired', lang => {
    // Guard the premise: if this flips, the assertion below is the wrong one to run.
    expect(MILESTONE_PAYMENTS_ARE_PREVIEW, 'payouts went live — see the next test').toBe(true);
    const text = lines(lang).join('\n');
    for (const vendor of PAYOUT_VENDORS) {
      expect(text, `${vendor} must not be disclosed before it processes anything`).not.toContain(vendor);
    }
  });

  it('a payout provider must be disclosed once milestone payments leave preview', () => {
    if (MILESTONE_PAYMENTS_ARE_PREVIEW) return; // Nothing to disclose yet.
    for (const lang of LANGS) {
      const text = lines(lang).join('\n');
      expect(
        PAYOUT_VENDORS.some(v => text.includes(v)),
        `Milestone payments are live, so ${lang} must name the payout processor in the ` +
        'subprocessor list. Put the line back in src/lib/legal/content.ts.',
      ).toBe(true);
    }
  });

  it('both languages disclose the same set of processors', () => {
    // A processor dropped from one translation only is the same defect, half-hidden.
    const named = (lang: Lang) =>
      ['Supabase', 'Resend', 'Stripe', 'GoHighLevel', 'Google', 'Vercel', 'Sentry']
        .filter(name => sharingLines(lang).some(b => b.includes(name)))
        .sort();
    expect(named('fr')).toEqual(named('en'));
    expect(named('en').length, 'the sharing list should not be empty').toBeGreaterThan(5);
  });

  it('the policy still says payouts happen, even with no vendor named', () => {
    // Removing the vendor must not quietly remove the purpose it was disclosed for.
    for (const lang of LANGS) {
      const text = lines(lang).join('\n').toLowerCase();
      expect(text, `${lang} should still describe contractor payouts as a purpose`)
        .toMatch(lang === 'en' ? /contractor payouts/ : /versements aux entrepreneurs/);
    }
  });

  it('no payout vendor leaks into the terms either', () => {
    for (const lang of LANGS) {
      const text = TERMS[lang].sections.flatMap(s => s.body).join('\n');
      for (const vendor of PAYOUT_VENDORS) {
        expect(text, `${vendor} must not appear in the ${lang} terms`).not.toContain(vendor);
      }
    }
  });
});
