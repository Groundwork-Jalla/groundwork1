import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stageDurationDays, buildDurationDays } from './timeline';

/**
 * Nobody gets to hard-code a build programme again.
 *
 * The 196-day estimate was not one mistake, it was five: `PREDICTED_DAYS = 196` in
 * `OverviewTab` and `Step9Summary`, and `STAGE_DAYS = [14,21,7,14,70,14,14,21,14,7]` —
 * which sums to exactly 196 — in `TimelineTab`, `tools/stages` and `tools/milestones`.
 *
 * Beta testers who had actually built in Cameroon rejected it, and fixing four of the five
 * would have left the Gantt and the public tools still quoting seven months for a bungalow
 * while the headline said something else. A timeline that disagrees with itself is worse
 * than one that is merely wrong.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const SRC  = join(ROOT, 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry) || entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) return [];
    return [relative(ROOT, full)];
  });
}

/** Comments discuss the old constant by name; only code counts as a violation. */
const stripComments = (src: string) =>
  src.split('\n').filter(l => !/^\s*(\*|\/[/*])/.test(l)).join('\n');

const files = sourceFiles(SRC)
  // The one place a duration may be written down.
  .filter(p => p !== 'src/lib/budget/timeline.ts')
  .map(path => ({ path, code: stripComments(readFileSync(join(ROOT, path), 'utf8')) }));

describe('build duration has one source', () => {
  it('finds source files at all', () => {
    // Guards against the scan passing because a path changed and it read nothing.
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no component assigning a literal day count', () => {
    // `PREDICTED_DAYS = 196`, `TOTAL_DAYS = 196`, and anything else of that shape.
    const offenders = files
      .filter(f => /\b(PREDICTED|TOTAL|BUILD|PROJECT)_DAYS\s*=\s*\d/.test(f.code))
      .map(f => f.path);

    expect(offenders, `\nDuration belongs in src/lib/budget/timeline.ts, not:\n` +
      offenders.map(f => `  ${f}`).join('\n') +
      `\n\nUse buildDurationDays(floors).\n`).toEqual([]);
  });

  it('has no component hard-coding the ten stage durations', () => {
    // The old array, and any literal array of ten numbers assigned to a *_DAYS name.
    const offenders = files
      .filter(f => /_DAYS\s*(:\s*number\[\]\s*)?=\s*\[\s*\d+(\s*,\s*\d+){9}\s*\]/.test(f.code))
      .map(f => f.path);

    expect(offenders, `\nStage durations come from stageDurationDays(floors), not:\n` +
      offenders.map(f => `  ${f}`).join('\n') + '\n').toEqual([]);
  });
});

describe('the replacement is actually wired in', () => {
  it('is imported by the screens that show a timeline', () => {
    // A passing scan above is also what you get if every timeline was simply deleted.
    const wired = [
      'src/components/project/OverviewTab.tsx',
      'src/components/project/TimelineTab.tsx',
      'src/components/wizard/steps/Step9Summary.tsx',
      'src/app/routes/tools/stages.tsx',
      'src/app/routes/tools/milestones.tsx',
    ];
    for (const path of wired) {
      const f = files.find(x => x.path === path);
      expect(f, `${path} not found — has it moved?`).toBeDefined();
      expect(f!.code, `${path} no longer derives its duration`)
        .toMatch(/buildDurationDays|stageDurationDays/);
    }
  });

  it('still totals the old 196 only for a building that genuinely takes that long', () => {
    // Not a magic number any more: 196 days is ~G+4.3, so nothing lands exactly on it.
    expect(buildDurationDays(1)).toBe(14);
    expect(stageDurationDays(1).reduce((a, b) => a + b, 0)).toBe(14);
    expect([1, 2, 3, 4, 5, 6, 8].map(buildDurationDays)).not.toContain(196);
  });
});
