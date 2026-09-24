import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_NAV, ADMIN_PLACEHOLDERS } from '@/components/shell/nav-config';

/**
 * Every /admin destination in the app leads to a real page.
 *
 * This exists because one did not. The top bar's WhatsApp icon pointed at
 * `/admin/whatsapp`, which was served by a placeholder until the Inbox shipped and the
 * per-channel placeholders were removed; the link was missed and started rendering
 * "There is no such section."
 *
 * Nothing caught it, and the reason is worth keeping in mind: `route("admin/:section")`
 * is a catch-all, so a naive link check finds a matching route for EVERY /admin/* path
 * and reports a clean bill of health. The catch-all is therefore excluded below, and a
 * path that falls through to it must be a declared placeholder — a deliberate "not built
 * yet" page — rather than an accident.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

const CATCH_ALL = '/admin/:section';

const routes = new Set(
  [...read('src/app/routes.ts').matchAll(/route\(\s*"([^"]+)"/g)]
    .map(m => '/' + m[1].replace(/^\//, ''))
    .filter(r => r !== CATCH_ALL),
);

const servedByAPage = (path: string) =>
  routes.has(path)
  || [...routes].some(r => r.includes(':') && new RegExp('^' + r.replace(/:[^/]+/g, '[^/]+') + '$').test(path))
  || Object.keys(ADMIN_PLACEHOLDERS).some(k => `/admin/${k}` === path);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(resolve(ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(resolve(ROOT, rel)).isDirectory()) sourceFiles(rel, out);
    else if (/\.tsx?$/.test(rel) && !rel.includes('.test.')) out.push(rel);
  }
  return out;
}

describe('no /admin link is a dead end', () => {
  it('every hard-coded admin destination in the app resolves to a real page', () => {
    const dead: string[] = [];
    for (const file of sourceFiles('src')) {
      const src = read(file);
      for (const m of src.matchAll(/(?:to|href)=\{?["'`](\/admin\/[^"'`\s?#{}]*)/g)) {
        const path = m[1].replace(/\/$/, '');
        if (path.includes('${')) continue;       // built at runtime; checked where it is built
        if (!servedByAPage(path)) dead.push(`${path}  (${file})`);
      }
    }
    expect(dead, `these go nowhere:\n  ${dead.join('\n  ')}`).toEqual([]);
  });

  it('every sidebar destination resolves too', () => {
    const dead = ADMIN_NAV
      .map(i => i.to.split('?')[0].replace(/\/$/, ''))
      .filter(p => p.startsWith('/admin/') && !servedByAPage(p));
    expect(dead).toEqual([]);
  });

  it('the top bar sends WhatsApp to the Inbox channel, not a section that does not exist', () => {
    const bar = read('src/components/admin/AdminTopBarActions.tsx');
    expect(bar).toContain('/admin/inbox?channel=whatsapp');
    expect(bar).not.toContain('"/admin/whatsapp"');
  });

  it('the catch-all is still last, so a real route is never shadowed by it', () => {
    const routesSrc = read('src/app/routes.ts');
    const concrete = [...routesSrc.matchAll(/route\(\s*"(admin\/[^"]+)"/g)]
      .map(m => ({ path: m[1], at: m.index ?? 0 }));
    const catchAll = concrete.find(r => r.path === 'admin/:section');
    expect(catchAll, 'the catch-all should exist').toBeDefined();
    for (const r of concrete) {
      if (r.path === 'admin/:section') continue;
      expect(r.at, `${r.path} is registered after the catch-all and will never match`)
        .toBeLessThan(catchAll!.at);
    }
  });
});
