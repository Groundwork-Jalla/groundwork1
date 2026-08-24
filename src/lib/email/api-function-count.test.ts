import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Vercel's Hobby plan allows 12 serverless functions per deployment, and every file under
 * `api/` is one.
 *
 * Going over does not fail loudly. The build fails, the previous deployment keeps
 * serving, and the site looks completely normal — so pushes appear to succeed while
 * production quietly freezes. It happened: seven endpoints were added over two days,
 * every deployment failed from the first one, and two separate bugs were chased for hours
 * that had both already been fixed and merged. Nothing in the app could have shown that,
 * because the app that was running predated the fixes.
 *
 * This test is the smoke alarm. If it fails, do not delete a feature — collapse entry
 * points instead: handlers live one per file under `api/_handlers/`, which Vercel does not
 * count, behind a dispatcher (`api/events.ts`). The other way out is the Pro plan.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const API = join(ROOT, 'api');

/** Vercel's cap on the Hobby plan. Raise this only when the plan actually changes. */
const LIMIT = 12;

/**
 * What Vercel turns into a function: every `.ts` under `api/`, except paths containing a
 * segment that starts with `_`. That underscore convention is what `api/_lib` and
 * `api/_handlers` rely on, so it is the rule this mirrors.
 */
function functionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    if (entry.startsWith('_')) return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return functionFiles(full);
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) return [];
    return [relative(ROOT, full)];
  });
}

describe('api/ serverless function count', () => {
  it(`stays within Vercel's limit of ${LIMIT}`, () => {
    const files = functionFiles(API).sort();
    expect(
      files.length,
      `\n${files.length} functions — Vercel Hobby allows ${LIMIT}. Over the limit every\n` +
      `deployment fails while the old build keeps serving, so the site looks fine and\n` +
      `nothing ships. Add an action to api/events.ts instead of a new file:\n\n` +
      files.map(f => `  ${f}`).join('\n') + '\n',
    ).toBeLessThanOrEqual(LIMIT);
  });

  it('keeps headroom for one more endpoint', () => {
    // A soft warning ahead of the hard wall: at the limit exactly, the next person to add
    // an endpoint breaks production and has no reason to suspect why.
    const count = functionFiles(API).length;
    expect(count, `${count}/${LIMIT} functions — consolidate before adding another`)
      .toBeLessThan(LIMIT);
  });
});
