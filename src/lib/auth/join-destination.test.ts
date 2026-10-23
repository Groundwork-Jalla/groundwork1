import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { joinDestination, rememberAccount } from './returning-user';

/**
 * Two buttons sit side by side and they do NOT share a destination.
 *
 * "Join for Free" guesses: a browser nobody has signed in on gets sign-up, one that has
 * gets log-in, and both pages link to the other so a wrong guess costs a click.
 *
 * The contractor CTA cannot take that guess. It carries `?role=contractor`, and only
 * the sign-up page reads that parameter — sending a returning browser to /auth/login
 * would drop it silently and land the person on a log-in form with no sign of the
 * thing they clicked.
 */
describe('where "Join for Free" goes', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* private mode */ } });

  it('sends a fresh browser to sign up', () => {
    expect(joinDestination(false)).toBe('/auth/signup');
  });

  it('may send a returning browser to log in', () => {
    // A hint, not a fact — and deliberately local, because an endpoint answering
    // "does this email have an account?" is account enumeration.
    rememberAccount();
    const landed = joinDestination(false);
    expect(['/auth/signup', '/auth/login']).toContain(landed);
  });

  it('sends a signed-in visitor past the auth pages', () => {
    expect(joinDestination(true)).toBe('/dashboard');
  });
});

describe('the contractor CTA does not share that guess', () => {
  it('names the sign-up page outright, in both places it appears', () => {
    const root = resolve(__dirname, '..', '..');
    for (const f of ['components/shell/SiteNav.tsx', 'components/landing/CTASection.tsx']) {
      const src = readFileSync(resolve(root, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src, f).toContain('to="/auth/signup?role=contractor"');
      // Never derived from the guess, which may be the log-in page.
      expect(src, f).not.toMatch(/to=\{`\$\{join\}[^`]*role=contractor`\}/);
    }
  });
});
