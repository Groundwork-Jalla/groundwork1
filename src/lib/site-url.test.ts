import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANONICAL_SITE_URL, siteLink, siteUrl } from './site-url';

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
});
