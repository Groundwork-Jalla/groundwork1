import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCENT_CLASS, BLOCKER_LABEL, LIFECYCLE_META, UNKNOWN_META, badgeModel, primaryBlocker,
} from './lifecycle-badge';
import { STATE_SEVERITY, stageLifecycle, type StageBlocker, type StageLifecycle, type StageLifecycleState } from '@/lib/lifecycle/stage';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * The badge renders the lifecycle; it must never re-derive it.
 *
 * Every state the lifecycle can produce has a word, an accent and a translation in both
 * languages; the blocker beside the word is the stage's own reason, never the project's
 * hold; and the component file contains no lifecycle arithmetic at all.
 */

const ROOT = resolve(__dirname, '..', '..', '..');

/** Every state, taken from the lifecycle module's own severity table so the two cannot drift. */
const STATES = Object.keys(STATE_SEVERITY) as StageLifecycleState[];
const BLOCKERS: StageBlocker[] = ['verifier_not_selected', 'awaiting_funding', 'on_hold'];

const lc = (state: StageLifecycleState, blockers: StageBlocker[] = []): StageLifecycle => ({ state, blockers });

describe('every lifecycle state has a row, and the accents follow 05 §7', () => {
  it('covers exactly the states stageLifecycle() can return — no more, no fewer', () => {
    expect(Object.keys(LIFECYCLE_META).sort()).toEqual([...STATES].sort());
    expect(STATES).toHaveLength(14);
  });

  it.each([
    ['locked', 'grey'], ['in_progress', 'neutral'], ['evidence_submitted', 'neutral'],
    ['verification_pending', 'amber'], ['verification_in_progress', 'amber'],
    ['rejected', 'red'], ['payment_failed', 'red'],
    ['verified', 'green'], ['approved', 'green'], ['payment_eligible', 'green'],
    ['release_authorised', 'green'], ['disbursement_initiated', 'green'], ['disbursed', 'green'], ['completed', 'green'],
  ] as const)('%s → %s', (state, accent) => {
    expect(LIFECYCLE_META[state].accent).toBe(accent);
  });

  it('emphasises payment_eligible and nothing else — the one state the desk acts on', () => {
    expect(STATES.filter(s => LIFECYCLE_META[s].emphasis)).toEqual(['payment_eligible']);
  });

  it('accents are a dot and a text colour only — no background tile', () => {
    for (const a of Object.values(ACCENT_CLASS)) {
      expect(a.dot).toMatch(/^bg-state-/);
      expect(a.text).toMatch(/^text-/);
    }
    const component = readFileSync(resolve(ROOT, 'src/components/admin/workspace/StageLifecycleBadge.tsx'), 'utf8');
    expect(component).not.toMatch(/bg-(green|amber|red|yellow|emerald|rose)-\d/);
    expect(component).not.toMatch(/rounded-full px-/);   // the pill shape with padding = a tile
  });
});

describe('every word exists in both dictionaries', () => {
  for (const state of STATES) {
    it(`state ${state} → en + fr`, () => {
      const key = LIFECYCLE_META[state].labelKey;
      expect(lookup(en, key), `en lacks ${key}`).toBeTypeOf('string');
      expect(lookup(fr, key), `fr lacks ${key}`).toBeTypeOf('string');
      expect(lookup(en, key)).not.toBe(lookup(fr, key));   // actually translated, not copied
    });
  }
  for (const blocker of BLOCKERS) {
    it(`blocker ${blocker} → en + fr`, () => {
      const key = BLOCKER_LABEL[blocker];
      expect(lookup(en, key)).toBeTypeOf('string');
      expect(lookup(fr, key)).toBeTypeOf('string');
    });
  }
  it('the unknown-state fallback is translated too', () => {
    expect(lookup(en, UNKNOWN_META.labelKey)).toBe('Unknown state');
    expect(lookup(fr, UNKNOWN_META.labelKey)).toBeTypeOf('string');
  });
});

describe('primaryBlocker names the stage’s reason, never the project’s hold', () => {
  it('returns the first blocker that is not on_hold', () => {
    expect(primaryBlocker(lc('approved', ['awaiting_funding']))).toBe('awaiting_funding');
    expect(primaryBlocker(lc('verification_pending', ['on_hold', 'verifier_not_selected']))).toBe('verifier_not_selected');
    expect(primaryBlocker(lc('approved', ['on_hold', 'awaiting_funding']))).toBe('awaiting_funding');
  });

  it('returns null when the only blocker is on_hold, or there is none', () => {
    expect(primaryBlocker(lc('locked', ['on_hold']))).toBeNull();
    expect(primaryBlocker(lc('in_progress'))).toBeNull();
  });
});

describe('badgeModel', () => {
  it('renders the state it was given — the same word for the same lifecycle, wherever it is shown', () => {
    const m = badgeModel(lc('verification_pending', ['verifier_not_selected']));
    expect(m).toMatchObject({
      state: 'verification_pending', known: true, accent: 'amber', emphasis: false,
      labelKey: 'admin.lifecycle.state.verification_pending',
      blockerKey: 'admin.lifecycle.blocker.verifier_not_selected',
      onHold: false, dot: 'bg-state-held', text: 'text-state-held',
    });
  });

  it('on_hold is an overlay on any state, and does not displace the stage’s own blocker', () => {
    expect(badgeModel(lc('locked', ['on_hold']))).toMatchObject({ onHold: true, blockerKey: null, accent: 'grey' });
    expect(badgeModel(lc('approved', ['on_hold', 'awaiting_funding'])))
      .toMatchObject({ onHold: true, blockerKey: 'admin.lifecycle.blocker.awaiting_funding', accent: 'green' });
    expect(badgeModel(lc('completed', ['on_hold']))).toMatchObject({ onHold: true, accent: 'green' });
  });

  it('a state this build does not know falls back to grey + "unknown" rather than throwing', () => {
    const future = { state: 'escrow_released' as StageLifecycleState, blockers: [] as StageBlocker[] };
    const m = badgeModel(future);
    expect(m).toMatchObject({ known: false, state: 'escrow_released', accent: 'grey', labelKey: 'admin.lifecycle.state.unknown', blockerKey: null });
  });

  it('agrees with stageLifecycle() end to end for the states a real ladder produces', () => {
    const active = { status: 'active' as const };
    const req = (id: string, status: 'locked' | 'active' | 'pending_review' | 'complete') =>
      ({ id, status, stage_number: 1, verification_required: true, payment_milestone_usd: 5000 });
    expect(badgeModel(stageLifecycle(req('a', 'locked'), [], active)).labelKey).toBe('admin.lifecycle.state.locked');
    expect(badgeModel(stageLifecycle(req('b', 'pending_review'), [], active)))
      .toMatchObject({ labelKey: 'admin.lifecycle.state.verification_pending', blockerKey: 'admin.lifecycle.blocker.verifier_not_selected' });
    expect(badgeModel(stageLifecycle(req('c', 'complete'), [], active, false, null, [])))
      .toMatchObject({ labelKey: 'admin.lifecycle.state.approved', blockerKey: 'admin.lifecycle.blocker.awaiting_funding' });
    expect(badgeModel(stageLifecycle(req('d', 'complete'), [], { status: 'on_hold' }, false, null, null)))
      .toMatchObject({ labelKey: 'admin.lifecycle.state.approved', onHold: true, blockerKey: null });
  });
});

describe('the component only renders (static)', () => {
  // Code only: both files EXPLAIN in comments that they never recompute the lifecycle.
  const code = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const component = code('src/components/admin/workspace/StageLifecycleBadge.tsx');
  const model = code('src/lib/admin/lifecycle-badge.ts');

  it('takes a StageLifecycle and calls badgeModel — no stage row, verification or ledger in sight', () => {
    expect(component).toMatch(/lifecycle: StageLifecycle/);
    expect(component).toContain('badgeModel(lifecycle)');
    for (const forbidden of ['stageLifecycle(', 'availableFunds', 'payment_status', 'verification_required', 'payment_milestone', 'decision', 'listProjectPayments', 'supabase']) {
      expect(component, `component must not touch ${forbidden}`).not.toContain(forbidden);
      expect(model, `model must not touch ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('translates through the dictionary keys the model chose', () => {
    expect(component).toContain('t(m.labelKey)');
    expect(component).toContain('t(m.blockerKey)');
    expect(component).toContain("t('admin.lifecycle.blocker.on_hold')");
  });

  it('exposes the state for tests and styling without encoding it in colour alone', () => {
    expect(component).toContain('data-lifecycle={m.state}');
  });
});
