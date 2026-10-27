import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteUrl } from './stripe.js';

afterEach(() => vi.unstubAllEnvs());

describe('server-generated customer URLs', () => {
  it('uses the request domain when PUBLIC_SITE_URL is a Vercel deployment host', () => {
    vi.stubEnv('PUBLIC_SITE_URL', 'https://groundwork1-phi.vercel.app');
    expect(new URL(siteUrl({ headers: { host: 'www.tryjalla.com' } })).hostname)
      .toBe('www.tryjalla.com');
  });

  it('refuses to create a customer URL when every available host is a Vercel deployment', () => {
    vi.stubEnv('PUBLIC_SITE_URL', 'https://groundwork1-phi.vercel.app');
    expect(() => siteUrl({ headers: { host: 'groundwork1-phi.vercel.app' } }))
      .toThrow('A public site URL is required for customer-facing links');
  });
});
