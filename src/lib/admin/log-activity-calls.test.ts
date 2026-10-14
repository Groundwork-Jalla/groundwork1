import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every call to `log_activity`, across every migration, checked against its own guards.
 *
 * 089 refuses two shapes at runtime:
 *
 *   · an entity type without an entity id  → `bad_entity`
 *   · neither a project nor a person       → `no_subject`
 *
 * Both are RAISE EXCEPTION, so a bad call does not log badly — it aborts whatever
 * function made it. That is how a Delete button did nothing at all: the purge in 115
 * passed null for both subjects, `no_subject` fired, and the entire transaction rolled
 * back before a single row was touched. The admin saw a generic failure.
 *
 * I made this mistake in 105, caught it, and then made it again in 115. A reviewer
 * reading one migration cannot see it; this can.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const DIR = join(ROOT, 'supabase/migrations');

/** Comments discuss these arguments constantly; only statements count. */
const files = readdirSync(DIR)
  .filter(f => f.endsWith('.sql'))
  .map(f => [f, readFileSync(join(DIR, f), 'utf8').replace(/^\s*--.*$/gm, '')] as const);

/** Split a call's argument list on top-level commas, ignoring nested parens and strings. */
function args(call: string): string[] {
  const inner = call.slice(call.indexOf('(') + 1, call.lastIndexOf(')'));
  const out: string[] = [];
  let depth = 0, quote = false, cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "'" && inner[i - 1] !== '\\') quote = !quote;
    if (!quote && (c === '(' || c === '[')) depth++;
    if (!quote && (c === ')' || c === ']')) depth--;
    if (!quote && c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Positional: (project, action, entity_type, entity_id, person, details). */
function calls(sql: string): { raw: string; a: string[] }[] {
  const found: { raw: string; a: string[] }[] = [];
  for (const m of sql.matchAll(/log_activity\s*\(/g)) {
    let depth = 0, i = m.index! + m[0].length - 1;
    for (; i < sql.length; i++) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') { depth--; if (depth === 0) break; }
    }
    const raw = sql.slice(m.index!, i + 1);
    found.push({ raw, a: args(raw) });
  }
  return found;
}

const isNull = (v: string | undefined) => (v ?? '').trim().toUpperCase() === 'NULL';

describe('log_activity is always called in a shape 089 accepts', () => {
  const all = files.flatMap(([f, sql]) => calls(sql).map(c => ({ file: f, ...c })));

  it('finds the calls at all, so a passing suite means something', () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it.each(all.map(c => [c.file, c.raw.replace(/\s+/g, ' ').slice(0, 90), c] as const))(
    '%s — %s',
    (_file, _label, c) => {
      const [project, , entityType, entityId, person] = c.a;

      // `no_subject`: an activity is about a project, a person, or both.
      expect(
        isNull(project) && isNull(person),
        `${c.file}: both project and person are NULL — this raises no_subject and aborts the caller`,
      ).toBe(false);

      // `bad_entity`: entity_type and entity_id come together or not at all.
      expect(
        isNull(entityType) !== isNull(entityId),
        `${c.file}: entity_type and entity_id must both be given or both omitted`,
      ).toBe(false);
    },
  );
});
