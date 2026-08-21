import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Vercel transpiles every file under `api/` on its own and does not bundle. The root
 * package.json is `"type": "module"`, so Node's ESM resolver loads the output — and it
 * requires an explicit extension on every relative specifier, refuses `@/*` aliases
 * (there is no bundler left to expand them), and has no `import.meta.env`.
 *
 * `api/README.md` spells this out, and it has still been broken twice:
 *
 *   1. Static imports, which fail at module load. Vercel serves FUNCTION_INVOCATION_FAILED
 *      and every function with a relative import dies at once — loud, and fixed in 7570f1c.
 *   2. Dynamic imports, which fail at *call* time. The function boots, answers, and only
 *      dies at the moment it tries to send. The contractor application path swallows the
 *      error in the browser, so applicants saw "submitted" while the email reached nobody
 *      and nothing was logged anywhere a person would look.
 *
 * The second kind is invisible to tsc, to `pnpm test`, and to `vite dev` — dev re-implements
 * these endpoints in middleware and never loads the real handler. This test is the only
 * thing standing between that class of bug and production, so it walks the actual import
 * graph rather than checking the entry files alone: the rule is transitive, and the two
 * regressions both entered through a module several hops down.
 */

// This lives under src/ because vitest.config.ts only collects `src/**/*.test.ts`, and
// the email chain is what both regressions came through. It checks all of api/ regardless.
const ROOT = resolve(__dirname, '..', '..', '..');
const API_DIR = join(ROOT, 'api');

/** Both `import x from '...'` / `export ... from '...'` and `import('...')`. */
const SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

/**
 * Comments have to go before anything is matched. Half the files in this graph *discuss*
 * the rule — `api/README.md` points at a note in translate.ts about `import.meta`, and the
 * module extracted for exactly this reason explains why in its header. Scanning raw text
 * flags those explanations as the violation they warn about. A commented-out import would
 * likewise count as real. Strings are tracked so a `//` inside a URL survives.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && next === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  '; i += 2; continue;
    }
    out += c; i++;
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    if (!e.name.endsWith('.ts') || e.name.endsWith('.test.ts')) return [];
    return [full];
  });
}

/** Map a written specifier onto a real file, honouring the `.js` → `.ts` rewrite. */
function resolveFile(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    `${base}.ts`,
    `${base}.tsx`,
    base,
    join(base, 'index.ts'),
  ];
  return candidates.find(c => existsSync(c) && statSync(c).isFile()) ?? null;
}

interface Violation { file: string; spec: string; rule: string }

function walk(): { visited: Set<string>; violations: Violation[] } {
  const violations: Violation[] = [];
  const visited = new Set<string>();
  const queue = sourceFiles(API_DIR);

  while (queue.length) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    const src = stripComments(readFileSync(file, 'utf8'));
    const where = relative(ROOT, file);

    // `import.meta.env` is the tell for a browser module (src/lib/supabase/client.ts).
    // Pulling one in is what dragged the Supabase client into the email template.
    if (/import\.meta/.test(src)) {
      violations.push({ file: where, spec: 'import.meta', rule: 'no import.meta in the api/ graph' });
    }

    for (const [, spec] of src.matchAll(SPECIFIER_RE)) {
      if (spec.startsWith('@/')) {
        violations.push({ file: where, spec, rule: 'no @/* alias — nothing expands it here' });
        continue;
      }
      if (!spec.startsWith('.')) continue;           // bare specifier: node_modules resolves it

      if (!/\.(js|json)$/.test(spec)) {
        violations.push({ file: where, spec, rule: "relative import needs an explicit .js" });
      }

      const target = resolveFile(file, spec);
      if (target) queue.push(target);
      else violations.push({ file: where, spec, rule: 'specifier resolves to no file' });
    }
  }

  return { visited, violations };
}

describe('api/ import graph', () => {
  const { visited, violations } = walk();

  it('uses extensioned relative imports, no aliases and no import.meta', () => {
    const report = violations
      .map(v => `  ${v.file}\n    ${v.spec} — ${v.rule}`)
      .join('\n');
    expect(violations, `\n${report}\n`).toEqual([]);
  });

  it('actually reached the shared modules under src/', () => {
    // Guards the guard. If resolveFile ever stops matching, the walk quietly shrinks to
    // the api/ directory itself and this file starts passing while proving nothing.
    const reached = [...visited].map(f => relative(ROOT, f));
    expect(reached).toContain('src/lib/email/shell.ts');
    expect(reached).toContain('src/lib/i18n/translate.ts');
    expect(reached).toContain('src/lib/contractor/application-types.ts');
  });
});
