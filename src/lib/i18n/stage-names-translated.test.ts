import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A stage name on a client or contractor screen goes through the dictionary.
 *
 * `project_stages.name` holds the English seed string written at creation;
 * `stage_key` is what makes it readable in the user's own language, and
 * `useStageLabels()` is the one helper that resolves the two with a fallback.
 *
 * Reading `.name` directly compiles, renders, and looks correct in English — which is
 * exactly why it kept happening. Two sites were live when this guard was written: the
 * ten-circle stage tracker on the client's project overview, and the stage and
 * substage names handed to the evidence-upload modal. Both showed a francophone
 * client English stage names on an otherwise French page.
 *
 * Admin is deliberately out of scope: it is a staff surface and reads the stored
 * English on purpose, so that the row being discussed matches the database.
 *
 * A line genuinely writing to staff rather than to the user — a notifyAdmins body, say —
 * marks itself `i18n-exempt` with the reason. That is a narrow, visible opt-out; it is
 * not a way to silence the guard on a screen a client actually reads.
 */

const ROOT = resolve(__dirname, '..', '..', '..');

const SURFACES = [
  'src/app/routes/projects',
  'src/app/routes/work',
  'src/app/routes/dashboard.tsx',
  'src/components/project',
  'src/components/contractor',
  'src/components/payments',
];

/** `stage.name`, `substage.name`, `sub.name` — but not `project.name` or `file.name`. */
const RAW = /\b(?:stage|substage|sub)\.name\b/;
/** `stages.find(…)?.name` and the same for substages. */
const RAW_FIND = /\b(?:stages|substages)\s*\.\s*find\([^)]*\)\s*\?\.\s*name\b/;

function walk(p: string): string[] {
  const full = join(ROOT, p);
  let st;
  try { st = statSync(full); } catch { return []; }
  if (!st.isDirectory()) return [p];
  return readdirSync(full).flatMap(f => walk(join(p, f)));
}

const files = SURFACES.flatMap(walk)
  .filter(f => (f.endsWith('.tsx') || f.endsWith('.ts')) && !f.includes('.test.'));

describe('stage names reach the screen translated', () => {
  it('scans a surface that actually exists', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('never reads a stage name straight off the row', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      src.split('\n').forEach((line, i) => {
        const code = line.trim();
        // Comments explain the rule; they do not break it.
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        if (!(RAW.test(line) || RAW_FIND.test(line))) return;
        // The opt-out has to be on the line itself or the one above it, so it stays
        // next to what it excuses rather than drifting to the top of the file.
        const prev = src.split('\n')[i - 1] ?? '';
        if (/i18n-exempt/.test(line) || /i18n-exempt/.test(prev)) return;
        offenders.push(`${f}:${i + 1}  ${code.slice(0, 90)}`);
      });
    }
    expect(offenders, `use useStageLabels() instead:\n${offenders.join('\n')}`).toEqual([]);
  });
});
