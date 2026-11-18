import { describe, expect, it } from 'vitest';
import { en } from './en';

/**
 * Favour, 19 Nov 2026: "Homeowner" always begins with a capital H in the English copy,
 * mid-sentence too, and is one word. Keys and code values stay lowercase; only what a
 * person reads is checked here.
 */
function strings(node: unknown, path: string[] = [], out: [string, string][] = []): [string, string][] {
  if (typeof node === 'string') out.push([path.join('.'), node]);
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) strings(v, [...path, k], out);
  return out;
}

describe('Homeowner is written with a capital H', () => {
  it('no English string says "homeowner" or "home owner"', () => {
    const bad = strings(en).filter(([, s]) => /\bhome ?owner/.test(s) || /\bhome owner/i.test(s));
    expect(bad.map(([k, s]) => `${k}: ${s}`)).toEqual([]);
  });
});
