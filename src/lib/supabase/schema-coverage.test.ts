import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every table the app reads or writes must actually exist.
 *
 * `support_tickets` did not. Two screens had been inserting into it since launch, both
 * caught the "relation does not exist" error, and both told the user their message had
 * been received — so every support message and every account-deletion request was
 * discarded while its sender was thanked for it.
 *
 * Nothing failed. No test, no build, no type error: `supabase.from('anything')` is a
 * string, and PostgREST reports a missing relation as a runtime error object rather than
 * a throw. The only thing that would have caught it is this — comparing the table names
 * in the client against the tables the migrations create.
 */

const ROOT = resolve(__dirname, '..', '..', '..');

function walk(dir: string, test: (f: string) => boolean): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full, test);
    return test(entry) ? [relative(ROOT, full)] : [];
  });
}

/** Tables created anywhere in the migration history, including via ALTER/rename. */
function migratedTables(): Set<string> {
  const out = new Set<string>();
  for (const f of walk(join(ROOT, 'supabase', 'migrations'), n => n.endsWith('.sql'))) {
    const sql = readFileSync(join(ROOT, f), 'utf8');
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?(?:table|view|materialized\s+view)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)) {
      out.add(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:public\.)?"?([a-z0-9_]+)"?\s+rename\s+to\s+"?([a-z0-9_]+)"?/gi)) {
      out.add(m[2].toLowerCase());
    }
  }
  return out;
}

/**
 * Every literal passed to `.from('...')` in application code.
 *
 * `supabase.storage.from('evidence')` names a storage BUCKET, not a table, and buckets
 * are provisioned outside the migrations. Those calls are stripped before scanning rather
 * than allow-listed by name — a bucket and a table can share a name, and `documents` is
 * both a bucket here and (as `project_documents`) a table.
 */
function referencedTables(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const files = [
    ...walk(join(ROOT, 'src'), n => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)),
    ...walk(join(ROOT, 'api'), n => /\.ts$/.test(n) && !/\.test\.ts$/.test(n)),
  ];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8')
      .replace(/\bstorage\s*\.\s*from\(/g, 'STORAGE_BUCKET(');
    for (const m of src.matchAll(/\.from\(\s*['"]([a-z0-9_]+)['"]\s*\)/gi)) {
      const t = m[1].toLowerCase();
      out.set(t, [...(out.get(t) ?? []), f]);
    }
  }
  return out;
}

describe('every table the client touches is created by a migration', () => {
  // Storage buckets and auth tables are provisioned by Supabase, not by our SQL. They are
  // listed one by one rather than pattern-matched, so adding to this list is a decision.
  const PROVISIONED_ELSEWHERE = new Set<string>([
    'users',   // auth.users, owned by Supabase
  ]);

  it('finds no reference to a table that does not exist', () => {
    const created  = migratedTables();
    const missing: string[] = [];

    for (const [table, files] of referencedTables()) {
      if (PROVISIONED_ELSEWHERE.has(table) || created.has(table)) continue;
      missing.push(`${table}  <- ${[...new Set(files)].join(', ')}`);
    }

    expect(missing, `\nNo migration creates:\n  ${missing.join('\n  ')}\n`).toEqual([]);
  });

  it('sees the table whose absence caused all this', () => {
    // Guards the guard: if the regex above stops matching CREATE TABLE, the test would
    // pass by finding nothing at all rather than by everything being present.
    expect(migratedTables().has('support_tickets')).toBe(true);
    expect(migratedTables().size).toBeGreaterThan(20);
    expect(referencedTables().has('support_tickets')).toBe(true);
  });
});

/**
 * A failed write must never be reported as a success.
 *
 * The specific shape that caused this: `catch { setFormState('success') }`, plus an
 * explicit "treat table-not-found as success" branch. Both are gone; this keeps them gone
 * on the paths where a person is being told we have their problem.
 */
describe('support writes do not lie about failing', () => {
  it('goes through the one module, which throws', () => {
    const direct = [...referencedTables().get('support_tickets') ?? []]
      .filter(f => f !== 'src/lib/supabase/support.ts');
    expect(direct, 'write support_tickets through lib/supabase/support.ts').toEqual([]);

    const mod = readFileSync(join(ROOT, 'src/lib/supabase/support.ts'), 'utf8');
    expect(mod).toMatch(/throw new Error/);
  });

  it('has no success-from-catch left in the two screens that had one', () => {
    for (const f of ['src/app/routes/help.tsx', 'src/app/routes/profile.tsx']) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      // `catch { ...success... }` with no rethrow — the exact pattern that hid this.
      const bad = [...src.matchAll(/catch\s*(?:\([^)]*\))?\s*\{([^}]*)\}/g)]
        .filter(m => /success|Submitted|submitted/.test(m[1]));
      expect(bad.map(m => m[0]), `${f} reports success from a catch`).toEqual([]);
    }
  });
});
