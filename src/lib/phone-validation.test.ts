import { describe, expect, it } from 'vitest';
import { isValidPhone } from './phone';

describe('isValidPhone', () => {
  it('accepts valid numbers from different country plans', () => {
    expect(isValidPhone('+237670000000')).toBe(true);
    expect(isValidPhone('+447911123456')).toBe(true);
  });

  it('rejects invalid national lengths and malformed values', () => {
    expect(isValidPhone('+23767000000')).toBe(false);
    expect(isValidPhone('+237000000000')).toBe(false);
    expect(isValidPhone('670000000')).toBe(false);
    expect(isValidPhone('not a phone')).toBe(false);
  });
});
