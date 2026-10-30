import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * What the Money tab is allowed to call "released".
 *
 * 30 Oct 2026, from Philip's "adjust the project money logic to ensure accurate
 * display": the tab summed the MILESTONES of every stage marked complete and
 * printed the total under "Released to you". Two defects in one number.
 *
 *   1. Approved is not paid. A stage signed off this morning and not yet paid was
 *      being shown as money the contractor had received.
 *   2. `pre_existing` stages are complete but were "never approved, verified or
 *      funded by us" (103) — work finished before the build joined Groundwork,
 *      carrying a zeroed milestone. Counting them produced "0 XAF · 4 stages
 *      approved": two true numbers that together say something false.
 *
 * The rule now: the schedule says what is contracted and what is outstanding; the
 * LEDGER says what moved. They are never the same figure, and an unreadable
 * ledger shows a dash rather than a zero.
 */

const SOURCE = readFileSync('src/app/routes/work/projects.detail.tsx', 'utf8');
const MONEY = SOURCE.slice(SOURCE.indexOf('function MoneyTab'), SOURCE.indexOf('function Figure('));

describe('the Money tab separates the schedule from the ledger', () => {
  it('takes "released" from the ledger, not from completed stages', () => {
    expect(MONEY).toMatch(/const ledger = payments\?\.available \? payments\.rows : null/);
    // The old derivation must not come back under any name.
    expect(MONEY).not.toMatch(/releasedLabel\s*=\s*money\.pair\(sum\(approved\)\)/);
  });

  it('shows a dash, not a zero, when the ledger cannot be read', () => {
    // `null` flows to FigureText, which prints an em dash. A 0 here would tell a
    // contractor nothing had been paid when the truth is we could not look.
    expect(MONEY).toMatch(/ledger === null \? null/);
  });

  it('never sums a ledger that holds more than one currency', () => {
    expect(MONEY).toMatch(/ledgerCodes\.size === 1/);
  });

  it('excludes pre-existing stages from what Groundwork approved', () => {
    expect(MONEY).toMatch(/s\.status === 'complete' && s\.pre_existing !== true/);
  });

  it('counts what is still to come from the stages that are not complete', () => {
    // Not "contract minus approved": a zeroed pre-existing stage would otherwise
    // inflate what is still owed.
    expect(MONEY).toMatch(/const outstanding = stages\.filter\(s => s\.status !== 'complete'\)/);
    expect(MONEY).toMatch(/toCome\s*=\s*money\.pair\(sum\(outstanding\)\)/);
  });

  it('says plainly that approved is not paid', () => {
    expect(MONEY).toMatch(/contractorMoney\.approvedNotPaid/);
  });
});

describe('the copy keeps the promise', () => {
  const en = readFileSync('src/lib/i18n/en.ts', 'utf8');

  it('spells out the difference where a contractor will read it', () => {
    const line = /approvedNotPaid:\s*'([^']+)'/.exec(en)?.[1] ?? '';
    expect(line).toMatch(/not the same as paid/i);
  });

  it('and still never says Groundwork holds the money', () => {
    // The custody rule, restated here because this is the screen most likely to
    // drift into implying it.
    const notCustodian = /notCustodian:\s*'([^']+)'/.exec(en)?.[1] ?? '';
    expect(notCustodian).toMatch(/does not hold your money/i);
  });
});
