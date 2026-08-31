import { describe, expect, it } from 'vitest';
import { normalisePhone } from '../../../api/ghl/_phone';

/**
 * WhatsApp addresses a contact by an E.164 number. Everything already in the CRM was
 * stored the way people type it — `670 00 00 00` — which renders as a filled-in phone
 * field that cannot be messaged. These are the shapes real Cameroonian applicants use.
 */
describe('normalisePhone', () => {
  it('adds the Cameroon dial code to a bare local number', () => {
    expect(normalisePhone('670000000', 'CM')).toBe('+237670000000');
  });

  it('ignores the spaces people write numbers with', () => {
    expect(normalisePhone('670 00 00 00', 'CM')).toBe('+237670000000');
    expect(normalisePhone('6 77-12-34-56', 'CM')).toBe('+237677123456');
  });

  it('defaults to Cameroon when no country is known', () => {
    expect(normalisePhone('677123456')).toBe('+237677123456');
  });

  it('leaves an already-international number alone', () => {
    expect(normalisePhone('+237670000000', 'CM')).toBe('+237670000000');
    expect(normalisePhone('+33 6 12 34 56 78', 'FR')).toBe('+33612345678');
  });

  it('treats a leading 00 as +', () => {
    expect(normalisePhone('00237670000000', 'CM')).toBe('+237670000000');
  });

  it('does not double the dial code when it was typed without a plus', () => {
    expect(normalisePhone('237670000000', 'CM')).toBe('+237670000000');
  });

  it('drops a national trunk zero where the plan has one', () => {
    expect(normalisePhone('07911123456', 'GB')).toBe('+447911123456');
    expect(normalisePhone('06 12 34 56 78', 'FR')).toBe('+33612345678');
    expect(normalisePhone('08031234567', 'NG')).toBe('+2348031234567');
  });

  it('keeps a leading digit that is NOT a trunk prefix', () => {
    // Cameroon has no trunk prefix. Stripping here would break a valid number, which is
    // why CM is deliberately absent from TRUNK_PREFIX_COUNTRIES.
    expect(normalisePhone('237', 'CM')).not.toBe('+23737');
  });

  it('passes through rather than inventing a number it cannot place', () => {
    expect(normalisePhone('12', 'CM')).toBe('12');              // too short to be real
    expect(normalisePhone('670000000', 'ZZ')).toBe('670000000'); // unknown country
    expect(normalisePhone('not a phone', 'CM')).toBe('not a phone');
  });

  it('returns null for nothing, so a missing phone stays missing', () => {
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone('   ')).toBeNull();
  });
});
