import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every place a notification is shown agrees with the table, and with itself.
 *
 * Two bugs here at once, and both were silent — which is why they survived:
 *
 *   1. WRONG COLUMN. `notifications.read_at` has been a TIMESTAMPTZ since 009. The
 *      standalone page carried `read: boolean`. `select('*')` simply returned no such
 *      field, so `!n.read` was true for every row and EVERYTHING showed as unread
 *      forever; `update({ read: true })` addressed a column that does not exist and the
 *      error was never checked. Confirmed against production: `read` answers 42703,
 *      exactly like a column invented for the control.
 *
 *   2. DEAD CLICKS. The page only marked a row read — it never navigated. The bell
 *      dropdown had been fixed and the page had not, so "clicking a notification opens
 *      the message" was true in one of the two places it can be clicked.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/** Everywhere that reads or writes the notifications table. */
const SURFACES = [
  'src/app/routes/notifications.tsx',
  'src/components/ui/NotificationBell.tsx',
  'src/app/routes/dashboard.tsx',
  'src/lib/supabase/notifications.ts',
];

describe('unread is read_at, everywhere', () => {
  it.each(SURFACES)('%s never names a boolean `read` column', (f) => {
    const src = code(f);
    // The column is `read_at`. A bare `read` field, or writing `read:` into an update,
    // is addressing something the database does not have.
    expect(src).not.toMatch(/\bn\.read\b(?!_)/);
    expect(src).not.toMatch(/\.eq\(\s*'read'/);
    expect(src).not.toMatch(/update\(\s*\{\s*read:\s/);
  });

  it('the page marks read with a timestamp, and filters on null', () => {
    const src = code('src/app/routes/notifications.tsx');
    expect(src).toMatch(/update\(\{ read_at: new Date\(\)\.toISOString\(\) \}\)/);
    expect(src).toMatch(/\.is\('read_at', null\)/);
    expect(src).toMatch(/filter\(n => !n\.read_at\)/);
  });

  it('and 009 is still what defines it', () => {
    expect(read('supabase/migrations/009_admin.sql')).toMatch(/read_at\s+TIMESTAMPTZ/);
  });
});

describe('a notification goes somewhere, wherever it is clicked', () => {
  it('the page navigates, not merely marks read', () => {
    const src = code('src/app/routes/notifications.tsx');
    expect(src).toMatch(/destinationFor/);
    expect(src).toMatch(/if \(to\) navigate\(to\)/);
  });

  it('using the SAME resolver as the bell', () => {
    // Two answers to "where does this notification go" is how the two drifted apart.
    expect(code('src/app/routes/notifications.tsx'))
      .toMatch(/import \{ destinationFor \} from '@\/components\/ui\/NotificationBell'/);
  });

  it('an already-read notification is still a live link', () => {
    // `markOneRead` returns early when it is read; routing must not sit behind that, or
    // yesterday's notification becomes a dead click.
    const src = code('src/app/routes/notifications.tsx');
    const fn = src.slice(src.indexOf('function openNotification'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toMatch(/void markOneRead\(n\)/);
    expect(body).toMatch(/destinationFor/);
  });

  it('and a row is a button, so it is reachable from a keyboard', () => {
    const src = code('src/app/routes/notifications.tsx');
    expect(src).not.toMatch(/<div\s+key=\{n\.id\}\s+onClick/);
    expect(src).toMatch(/type="button"\s*\n?\s*onClick=\{\(\) => openNotification\(n\)\}/);
  });

  it('older rows that carry only project_id still route', () => {
    expect(code('src/app/routes/notifications.tsx'))
      .toMatch(/n\.data \?\? \(n\.project_id \? \{ project_id: n\.project_id \} : null\)/);
  });
});
