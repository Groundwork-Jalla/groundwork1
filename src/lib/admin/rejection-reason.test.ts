import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REJECTION_REASONS } from '@/lib/supabase/admin-applications';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * A rejection after a meeting says why.
 *
 * It used to be a bare status flip: Ruth decided, the applicant was emailed, and three
 * weeks later nobody could say what was wrong — not to answer the applicant, and not to
 * see a pattern across them. 154 added the column; this is the half that fills it.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const sql = read('supabase/migrations/154_a_rejection_after_a_meeting_says_why.sql');
const lib = read('src/lib/supabase/admin-applications.ts');
const page = read('src/app/routes/admin/applications.detail.tsx');

describe('one vocabulary, three places', () => {
  it('every reason the UI offers is one the table allows', () => {
    // A reason the picker offers but the CHECK rejects fails at the moment of saving
    // a decision — the worst possible time to discover it.
    const allowed = sql.slice(sql.indexOf('contractor_applications_decision_reason'));
    for (const r of REJECTION_REASONS) {
      expect(allowed, `${r} missing from the CHECK`).toContain(`'${r}'`);
    }
  });

  it('and every one of them has a label in both languages', () => {
    for (const r of REJECTION_REASONS) {
      expect(typeof (en.adminPipeline.why as Record<string, string>)[r]).toBe('string');
      expect(typeof (fr.adminPipeline.why as Record<string, string>)[r]).toBe('string');
    }
  });

  it('shares the board’s labels rather than keeping a second list', () => {
    expect(page).toMatch(/adminPipeline\.why\.\$\{r\}/);
  });
});

describe('what gets written', () => {
  it('records the reason and the note on a rejection', () => {
    expect(lib).toMatch(/patch\.decision_reason = decision\?\.reason/);
    expect(lib).toMatch(/patch\.decision_note = decision\?\.note/);
  });

  it('clears a stale reason when a rejection is reversed', () => {
    // Accepting somebody previously rejected must not leave the board reading
    // "accepted — could not be reached".
    const body = lib.slice(lib.indexOf('export async function setApplicationStatus'));
    expect(body.slice(0, body.indexOf('\n}'))).toMatch(
      /else \{[\s\S]{0,400}patch\.decision_reason = null;[\s\S]{0,200}patch\.decision_note = null;/);
  });

  it('attributes the decision from the session, not from the browser', () => {
    // The caller does not get to say who decided.
    const body = lib.slice(lib.indexOf('export async function setApplicationStatus'));
    const fn = body.slice(0, body.indexOf('\n}'));
    expect(fn).toMatch(/supabase\.auth\.getUser\(\)/);
    expect(fn).not.toMatch(/decision\?\.(decidedBy|by)\b/);
  });
});

describe('the decision is not taken until the reason is given', () => {
  it('pressing Reject opens the panel rather than rejecting', () => {
    expect(page).toMatch(/if \(s === 'rejected'\) \{ setRejecting\(true\); return; \}/);
  });

  it('and confirming is held back until a reason is chosen', () => {
    expect(page).toMatch(/disabled=\{!reason \|\| saving\}/);
    expect(page).toMatch(/if \(!reason\) return;/);
  });

  it('the note is optional — a decision is never blocked by a form field', () => {
    expect(page).toMatch(/void decide\('rejected', \{ reason, note \}\)/);
  });

  it('cancelling leaves the application untouched', () => {
    expect(page).toMatch(/setRejecting\(false\); setReason\(null\); setNote\(''\)/);
  });
});
