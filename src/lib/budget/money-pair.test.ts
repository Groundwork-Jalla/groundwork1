import { describe, expect, it } from 'vitest';
import { moneyPair } from './money-pair';

/**
 * Showing a bill's figure and its dollar equivalent together.
 *
 * Philip, 29 October: the bill said 26,687,728 and the wizard showed $44,480 in a
 * different card — "it will be different figures, and I don't know what exchange rate
 * it is using." Two numbers with no stated relationship read as a disagreement.
 */

describe('a bill priced in local currency', () => {
  const pair = moneyPair(26_687_728, 'XAF', 600);

  it('leads with the figure the document actually states', () => {
    expect(pair.local).toBe('26,687,728 XAF');
  });

  it('puts the dollar equivalent beside it', () => {
    expect(pair.usd).toBe('$44,480');
  });

  it('names the rate, so the conversion can be checked rather than believed', () => {
    expect(pair.rate).toBe('600 XAF = $1');
  });
});

describe('what it refuses to invent', () => {
  it('claims no conversion for a bill already in dollars', () => {
    const pair = moneyPair(44_480, 'USD', 600);
    expect(pair.local).toBe('$44,480');
    expect(pair.usd).toBeNull();
    expect(pair.rate).toBeNull();
  });

  it('claims no conversion when the rate is 1', () => {
    // A rate of 1 is `getApproxFx` saying it does not know this country, not a
    // currency that happens to trade at parity. "≈ $26,687,728" would be a lie.
    expect(moneyPair(26_687_728, 'XAF', 1).usd).toBeNull();
  });

  it('claims no conversion with no rate at all', () => {
    expect(moneyPair(1000, 'XAF', null).usd).toBeNull();
    expect(moneyPair(1000, 'XAF', 0).usd).toBeNull();
  });

  it('claims no conversion when the document named no currency', () => {
    const pair = moneyPair(1000, null, 600);
    expect(pair.local).toBe('$1,000');
    expect(pair.usd).toBeNull();
  });
});

describe('the other currencies Groundwork carries rates for', () => {
  it.each([
    ['NGN', 1600, 16_000_000, '16,000,000 NGN', '$10,000', '1,600 NGN = $1'],
    ['GHS', 16,      160_000,    '160,000 GHS', '$10,000',     '16 GHS = $1'],
    ['KES', 130,   1_300_000,  '1,300,000 KES', '$10,000',    '130 KES = $1'],
  ])('%s', (code, rate, amount, local, usd, shown) => {
    const pair = moneyPair(amount, code, rate);
    expect(pair.local).toBe(local);
    expect(pair.usd).toBe(usd);
    expect(pair.rate).toBe(shown);
  });

  it('rounds the dollar figure to whole dollars, not to the cent', () => {
    // A bill read to the franc does not become more accurate by quoting cents off an
    // approximate rate.
    expect(moneyPair(1_000_001, 'XAF', 600).usd).toBe('$1,667');
  });

  it('takes a lowercase currency code as the same currency', () => {
    expect(moneyPair(600, 'xaf', 600).local).toBe('600 XAF');
  });
});
