import { describe, expect, it } from 'vitest';
import { currencyFractionDigits } from './format';

// 17 Nov session: the client dashboard read "Confirmed received 949,139.371425 XAF".
describe('currencyFractionDigits', () => {
  it('gives a franc no decimals and a dollar two', () => {
    expect(currencyFractionDigits('XAF')).toBe(0);
    expect(currencyFractionDigits('XOF')).toBe(0);
    expect(currencyFractionDigits('USD')).toBe(2);
    expect(currencyFractionDigits('EUR')).toBe(2);
  });
  it('falls back to two for an unknown or missing code', () => {
    expect(currencyFractionDigits('NOT-A-CODE')).toBe(2);
    expect(currencyFractionDigits(null)).toBe(2);
  });
  it('turns the reported figure into a payable one', () => {
    expect((949139.371425).toLocaleString('en-US', { maximumFractionDigits: currencyFractionDigits('XAF') })).toBe('949,139');
  });
});
