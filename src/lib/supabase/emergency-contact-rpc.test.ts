import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The client and the database must agree on the NAME and the KEYS.
 *
 * 142 reduced the emergency contacts from three to one and changed the wrong function:
 * it wrote `save_emergency_contacts` with camelCase keys while the application calls
 * `save_contractor_emergency_contacts` with snake_case ones. So the live form went on
 * refusing a single contact — "All three emergency contacts are required" — while a
 * scratch-cluster test of the new function passed, because it exercised the function
 * that had just been written rather than the one that actually runs.
 *
 * Neither a type-check nor a passing migration test can see that gap. This can.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const lib = read('src/lib/supabase/contractor-onboarding.ts');

/** Every migration, newest last, with `--` comments stripped. */
const allSql = readdirSync(join(ROOT, 'supabase/migrations'))
  .filter(f => f.endsWith('.sql')).sort()
  .map(f => read(`supabase/migrations/${f}`))
  .join('\n')
  .replace(/^\s*--.*$/gm, '');

describe('the function the client calls is the one that exists', () => {
  const calls = [...lib.matchAll(/rpc\('(\w+)'/g)].map(m => m[1]);

  it('finds the calls, so a pass means something', () => {
    expect(calls.length).toBeGreaterThan(4);
  });

  it.each([...new Set(calls)])('%s is defined in a migration', fn => {
    expect(allSql, `nothing defines public.${fn}`)
      .toMatch(new RegExp(`FUNCTION public\\.${fn}\\s*\\(`));
  });
});

/**
 * The live body of the contacts function: the LAST `CREATE OR REPLACE` wins.
 *
 * Anchored on CREATE because `REVOKE`, `GRANT` and `COMMENT ON FUNCTION` all name the
 * function too, and matching those picked up a fragment with no body in it.
 */
function newestDefinition(): string {
  const defs = [...allSql.matchAll(
    /CREATE OR REPLACE FUNCTION public\.save_contractor_emergency_contacts\s*\([\s\S]*?END \$\$;/g)];
  expect(defs.length, 'no CREATE for the contacts function').toBeGreaterThan(0);
  return defs[defs.length - 1][0];
}

describe('the emergency contacts agree on their keys', () => {
  it('the client sends snake_case', () => {
    const fn = lib.slice(lib.indexOf('export async function saveEmergencyContacts'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/full_name:/);
    expect(body).toMatch(/relationship:/);
    expect(body).toMatch(/phone:/);
    expect(body, 'camelCase keys would be read as NULL by the SQL').not.toMatch(/fullName:\s*c\./);
  });

  it('and the function it calls reads the same keys', () => {
    // The newest definition wins, so take the last one in migration order.
    const newest = newestDefinition();
    for (const key of ['full_name', 'relationship', 'phone']) {
      expect(newest, `the SQL does not read ${key}`).toMatch(new RegExp(`c->>'${key}'`));
    }
  });

  it('one contact is enough', () => {
    const newest = newestDefinition();
    expect(newest, 'still demands exactly three').not.toMatch(/v_n <> 3/);
    expect(newest).toMatch(/v_n < 1/);
  });

  it('and the message says one, not three', () => {
    for (const dict of ['src/lib/i18n/en.ts', 'src/lib/i18n/fr.ts']) {
      const src = read(dict);
      const line = src.split('\n').find(l => l.includes('contacts_count:')) ?? '';
      expect(line, `${dict} still says three`).not.toMatch(/three|trois/i);
    }
  });
});
