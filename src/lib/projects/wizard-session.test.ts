import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The project wizard outliving its own session.
 *
 * Reported as "why can't I create a project?" — eleven steps, a budget confirmed, and
 * then `new row violates row-level security policy for table "projects" (42501)` printed
 * verbatim above the button.
 *
 * The policies were all correct. `owner_insert_projects` exists with
 * `WITH CHECK (auth.uid() = user_id)`. The problem is that EVERY insert policy on
 * `projects` reads `auth.uid()` — the owner's, the admin's and the partner's alike — so
 * when the token has quietly expired all three fail at once and Postgres has no way to
 * say "you are signed out".
 *
 * The wizard's own guard did not catch it: it checks for a session OBJECT at page load,
 * and AuthContext goes on holding a stale one. Eleven steps is longer than a one-hour
 * token.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const step11 = strip(read('src/components/wizard/steps/Step11ConfirmBudget.tsx'));
const ctx    = read('src/contexts/WizardContext.tsx');

describe('the session is checked before anything is written', () => {
  it('asks for a live session, which refreshes a stale token', () => {
    expect(step11).toMatch(/await supabase\.auth\.getSession\(\)/);
  });

  it('does so BEFORE the project is created, not after it fails', () => {
    const check = step11.indexOf('supabase.auth.getSession()');
    const write = step11.indexOf('createProject(');
    expect(check).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(check);
  });

  it('stops without writing when there is no session', () => {
    const at = step11.indexOf('if (!live)');
    expect(at).toBeGreaterThan(-1);
    const branch = step11.slice(at, at + 220);
    expect(branch).toMatch(/errSignedOut/);
    expect(branch).toMatch(/return;/);
  });

  it('does not navigate away — the answers only exist on this page', () => {
    // The wizard keeps its data in memory. Sending somebody to /auth/login to fix this
    // would throw away all eleven steps, which is worse than the error they started with.
    const at = step11.indexOf('if (!live)');
    expect(step11.slice(at, at + 220)).not.toMatch(/navigate\(/);
  });
});

describe('the wizard really does keep its answers in memory', () => {
  it('nothing persists them, which is why the fix must not navigate', () => {
    // If this ever changes, the copy below can promise more and the branch above can
    // afford to redirect. Until then, both depend on this being true.
    expect(ctx).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });
});

describe('what a refusal says', () => {
  it('tells a signed-out person what to do, and what is still there', () => {
    const en = read('src/lib/i18n/en.ts');
    const block = en.slice(en.indexOf('    confirmBudget: {'));
    const copy = block.slice(0, block.indexOf('\n    },'));
    expect(copy).toMatch(/errSignedOut/);
    expect(copy).toMatch(/still on this page/);
    // It must not claim the answers survive leaving, because they do not.
    expect(copy).not.toMatch(/answers will still be here/);
  });

  it('distinguishes a dead session from a genuine refusal', () => {
    // A live session that is still refused is a different problem and a different
    // message — the raw Postgres string served neither.
    expect(step11).toMatch(/code === '42501'/);
    expect(step11).toMatch(/session \? 'wizard\.confirmBudget\.errRefused' : 'wizard\.confirmBudget\.errSignedOut'/);
  });

  it('never shows the raw policy error to a client', () => {
    expect(step11).not.toMatch(/violates row-level security/);
  });
});
