import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANONICAL_SITE_URL, siteLink, siteUrl, trustedSiteOrigin } from './site-url';

/**
 * Keeps the site's origin written down in exactly one place.
 *
 * Both spellings resolve — `https://tryjalla.com` answers 308 and hands the browser to
 * `https://www.tryjalla.com` — so a wrong one never announces itself. That is how six
 * email templates ended up building links against the bare domain while the serverless
 * functions defaulted to www, with nothing failing and nobody noticing.
 *
 * A hardcoded origin is also what makes a preview deployment mail its testers links to
 * production. Route everything through site-url.ts and neither can happen quietly.
 */

const ROOT = resolve(__dirname, '..', '..');
const SCAN = ['src', 'api'];

/** Any absolute link to our own site. Bare `tryjalla.com` in prose or an email address
 *  is not a link, so the scheme is required. */
const ORIGIN = /https?:\/\/(?:www\.)?tryjalla\.com/;

const ALLOWED = new Set([
  'src/lib/site-url.ts',        // the definition itself
  'src/lib/site-url.test.ts',   // this file
]);

afterEach(() => vi.unstubAllEnvs());

function stripComments(src: string): string {
  let out = '', i = 0, quote: string | null = null;
  while (i < src.length) {
    const c = src[i], next = src[i + 1];
    if (quote) {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && next === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && next === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2; continue;
    }
    out += c; i++;
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

describe('site URL', () => {
  it('is not hardcoded anywhere else', () => {
    const offenders: string[] = [];
    for (const dir of SCAN) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (ALLOWED.has(rel)) continue;
        const src = stripComments(readFileSync(file, 'utf8'));
        for (const line of src.split('\n')) {
          if (ORIGIN.test(line)) offenders.push(`${rel}: ${line.trim().slice(0, 100)}`);
        }
      }
    }
    expect(offenders, `\nUse siteUrl()/siteLink() from src/lib/site-url.ts instead:\n${offenders.join('\n')}\n`)
      .toEqual([]);
  });

  it('is the host that actually serves the app', () => {
    // The bare domain 308s to this one. Building links against the redirect target keeps
    // auth links a single hop, which matters when they carry a token.
    expect(CANONICAL_SITE_URL).toBe('https://www.tryjalla.com');
    expect(siteUrl()).not.toMatch(/\/$/);
  });

  it('joins paths without doubling or dropping the slash', () => {
    expect(siteLink('invite/abc')).toBe(`${siteUrl()}/invite/abc`);
    expect(siteLink('/invite/abc')).toBe(`${siteUrl()}/invite/abc`);
  });

  it('uses the canonical domain instead of Vercel deployment hosts', () => {
    vi.stubEnv('PUBLIC_SITE_URL', 'https://groundwork1-phi.vercel.app');
    expect(siteUrl()).toBe(CANONICAL_SITE_URL);
    expect(trustedSiteOrigin('https://groundwork1-phi.vercel.com/invite')).toBe(CANONICAL_SITE_URL);
  });

  it('preserves trusted custom and local origins', () => {
    expect(trustedSiteOrigin('https://preview.tryjalla.com/path')).toBe('https://preview.tryjalla.com');
    expect(trustedSiteOrigin('http://localhost:5174')).toBe('http://localhost:5174');
  });

  /**
   * No deployment hostname may reach a person.
   *
   * The confirm-signup mail went out carrying `groundwork1-phl.vercel.app` in its
   * footer, because Supabase's Site URL setting had been left pointing at a preview
   * deployment and the template printed it. The address is correct for a preview and
   * wrong for everyone who receives it: it is not a domain we tell anybody to trust,
   * it is not where their account lives, and on an account-confirmation mail it is the
   * first thing a new contractor sees of us.
   *
   * The dashboard setting is not in this repository, so this only guards what is: no
   * template may hardcode a deployment host, and the footer origin must be the
   * canonical one. Generated links now fall back to the canonical origin if a Vercel
   * host is configured; Supabase's Site URL still needs to be production as documented.
   */
  it('no email template carries a deployment hostname', () => {
    const dir = join(ROOT, 'docs', 'supabase-email-templates');
    const offenders: string[] = [];
    for (const name of readdirSync(dir).filter(f => f.endsWith('.html'))) {
      const html = readFileSync(join(dir, name), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      for (const line of html.split('\n')) {
        if (/vercel\.app|netlify\.app|localhost:\d+/.test(line)) {
          offenders.push(`${name}: ${line.trim().slice(0, 100)}`);
        }
      }
    }
    expect(offenders, `\nEmail templates must not name a deployment host:\n${offenders.join('\n')}\n`)
      .toEqual([]);
  });

  it('every email template signs off with the canonical origin', () => {
    const dir = join(ROOT, 'docs', 'supabase-email-templates');
    for (const name of readdirSync(dir).filter(f => f.endsWith('.html'))) {
      const html = readFileSync(join(dir, name), 'utf8');
      expect(html, `${name} should link its footer to ${CANONICAL_SITE_URL}`)
        .toContain(`href="${CANONICAL_SITE_URL}"`);
    }
  });
});
