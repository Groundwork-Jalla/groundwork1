import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { createDocumentReadRequests } from '@/components/wizard/ArchitecturePlanGate';

/**
 * Uploading both documents must never leave Continue dead with nothing said.
 *
 * Favour, 11 Nov 2026, blocked mid-wizard: "why is the continue button not clicking
 * after uploading boq and floor plan??"
 *
 * Both files WERE attached — the pickers set their state synchronously, before any
 * reading starts. What disabled the button was `scanning`, raised while the plan and
 * the bill are read on the device. A scanned drawing goes through Tesseract, and that
 * pass had no end: a stalled worker left `scanCount` above zero and Continue disabled
 * for ever, under a status line that said only "Reading…".
 *
 * ── THE READ IS NOT SHORTENED ────────────────────────────────────────────────────────
 * Favour, same minute: "dont skip ocr / read accordingly but dont make the person
 * clueless as to what is happening."
 *
 * So nothing is abandoned. The bill's total becomes ten stage payments and the plan's
 * footprint becomes every quantity in the take-off; cutting either short to light up a
 * button would be the worse trade. What changes is that the wait is VISIBLE and that it
 * stops being a silent hold: after a grace period the button unlocks while the read
 * carries on, and the screen says so.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const src  = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const GATE = 'src/components/wizard/ArchitecturePlanGate.tsx';

describe('the read runs in full', () => {
  const body = code(GATE);

  it('neither extractor is raced, cut short or abandoned', () => {
    // The first draft of this fix resolved a null at a deadline and carried on without
    // the figures. That is "skip ocr" by another name.
    expect(body).not.toMatch(/withDeadline/);
    expect(body).not.toMatch(/Promise\.race/);
    expect(body).toMatch(/await Promise\.all\(files\.map\(file => extractFloorPlanFacts\(file\)\)\)/);
    expect(body).toMatch(/const out = await extractBqTotal\(file\);/);
  });

  it('tracks the bill and drawings independently', () => {
    const requests = createDocumentReadRequests();
    const billCurrent = requests.begin('boq');
    const planCurrent = requests.begin('floorPlan');
    expect(billCurrent()).toBe(true);
    expect(planCurrent()).toBe(true);
    requests.begin('floorPlan');
    expect(planCurrent()).toBe(false);
    expect(billCurrent()).toBe(true);
    expect(body).toContain("readRequests.begin('floorPlan')");
    expect(body).toContain("readRequests.begin('boq')");
  });

  it.each(['floorPlan', 'boq'] as const)('removing or replacing %s invalidates its pending result', kind => {
    const requests = createDocumentReadRequests();
    const first = requests.begin(kind);
    requests.invalidate(kind);
    expect(first()).toBe(false);
    const replacement = requests.begin(kind);
    expect(replacement()).toBe(true);
    expect(first()).toBe(false);
    expect(body).toContain(`readRequests.invalidate('${kind}')`);
  });

  it('the counter is always brought back down', () => {
    // Both scans must decrement in `finally`, or one throw strands the button again.
    const finallys = body.match(/finally \{\s*setScanCount\(count => Math\.max\(0, count - 1\)\);/g);
    expect(finallys ?? []).toHaveLength(2);
  });
});

describe('and it never silently holds the button', () => {
  const body = code(GATE);

  it('normal Continue waits for the bill, while a slow bill offers explicit manual entry', () => {
    expect(body).toMatch(/const heldByRead = scanning && readSeconds < READ_GRACE_SECONDS;/);
    expect(body).toMatch(/disabled=\{!floorPlans\.length \|\| !bq \|\| heldByRead \|\| boqScanning\}/);
    expect(body).toContain('boqReadSeconds >= READ_GRACE_SECONDS');
    expect(body).toContain("t('planGate.enterTotalManually')");
    expect(body).toContain('floorPlans, bq, reading: null, lineItems: []');
    // The old condition is what stranded it.
    expect(body).not.toMatch(/disabled=\{!floorPlans\.length \|\| !bq \|\| scanning\}/);
  });

  it('the wait is counted out loud', () => {
    expect(body).toMatch(/setReadSeconds\(Math\.round\(\(Date\.now\(\) - startedAt\) \/ 1000\)\)/);
    expect(body).toMatch(/clearInterval\(id\)/);
    expect(body).toMatch(/t\('planGate\.readingElapsed', \{ s: readSeconds \}\)/);
  });

  it('it says why a scan is slow, and when you may go on without it', () => {
    expect(body).toMatch(/planGate\.readingScanned/);
    expect(body).toMatch(/!heldByRead && !boqScanning && \(/);
    expect(body).toMatch(/planGate\.readingContinueAnyway/);
  });

  it('the grace period is long enough to be worth waiting out', () => {
    // Short enough that nobody sits in front of a dead button; long enough that an
    // ordinary text-layer read is never interrupted by the offer to skip it.
    const seconds = Number(src(GATE).match(/const READ_GRACE_SECONDS = (\d+);/)?.[1]);
    expect(seconds).toBeGreaterThanOrEqual(10);
    expect(seconds).toBeLessThanOrEqual(45);
  });
});

describe('both languages say all three things', () => {
  for (const key of ['readingElapsed', 'readingScanned', 'readingContinueAnyway', 'boqStillReading', 'enterTotalManually'] as const) {
    it(`planGate.${key}`, () => {
      const e = (en.planGate as Record<string, unknown>)[key];
      const f = (fr.planGate as Record<string, unknown>)[key];
      expect(e, `en.planGate.${key}`).toBeTypeOf('string');
      expect(f, `fr.planGate.${key}`).toBeTypeOf('string');
      expect(f).not.toBe('');
    });
  }

  it('the elapsed string carries the count', () => {
    expect(String((en.planGate as Record<string, string>).readingElapsed)).toContain('{s}');
    expect(String((fr.planGate as Record<string, string>).readingElapsed)).toContain('{s}');
  });
});
