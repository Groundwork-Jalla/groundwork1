import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSelfVerify, awaitsSomeoneElse } from '@/lib/tier';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

// Client sign-off is approval across all tiers while paid verification gates are paused.
const ROOT = resolve(__dirname, '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
/** Comments explain the rule; they must not be what satisfies the assertion. */
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const tracker  = code('src/components/project/StageTracker.tsx');
const timeline = code('src/components/project/TimelineTab.tsx');
const overview = code('src/components/project/OverviewTab.tsx');

describe('isSelfVerify', () => {
  it('treats every tier as self-approval while pricing gates are paused', () => {
    for (const tier of ['self_verify', 'starter', 'jalla_verify', 'jalla_management', 'pro', 'enterprise']) {
      expect(isSelfVerify(tier)).toBe(true);
      expect(awaitsSomeoneElse(tier)).toBe(false);
    }
  });

  it('fails open to self-approval for unknown values in free mode', () => {
    for (const tier of [null, undefined, '', 'something_new']) {
      expect(isSelfVerify(tier)).toBe(true);
      expect(awaitsSomeoneElse(tier)).toBe(false);
    }
  });
});

describe('no client screen shows a Self Verify owner a wait that does not exist', () => {
  it('stage badges use client approval for all tiers', () => {
    expect(tracker).toContain("labelKey: 'project.stages.badgeYourApproval'");
    expect(tracker).not.toContain("'project.stages.badgeReview'");
  });

  it('timeline pills and legend use approval rather than verification', () => {
    expect(timeline).toContain("return 'project.costing.awaitingApproval'");
    expect(timeline).toContain("key: 'project.timeline.legendYourApproval'");
    expect(timeline).not.toContain("t('project.timeline.selfVerified')");
    expect(timeline).not.toContain("t('project.timeline.jallaVerified')");
  });

  it('the overview no longer states a stage status at all, so it cannot state a wrong one', () => {
    /**
     * This used to assert that the Overview's per-stage row forked on the tier, so a
     * Self Verify owner was never told they were waiting on Jalla. Philip, 2 Nov 2026,
     * had the whole block removed as redundant — the Stages tab renders the same list
     * and is where somebody goes to act on it.
     *
     * The protection is not weaker: the fork is still asserted on StageTracker and on
     * the timeline above. What changed is that the Overview is no longer a third place
     * that has to get it right.
     */
    expect(overview).not.toContain('project.overview.statusReview');
    expect(overview).not.toContain('project.overview.statusYourApproval');
  });

  it('client labels do not reintroduce tier-specific verification', () => {
    for (const body of [tracker, timeline, overview]) expect(body).not.toContain("=== 'starter'");
  });
});

describe('the strings exist in both languages', () => {
  const keys = [
    'project.stages.badgeYourApproval',
    'project.timeline.statusYourApproval',
    'project.timeline.legendYourApproval',
    'project.timeline.selfVerified',
    'project.timeline.jallaVerified',
  ];

  it.each(keys)('%s is translated', key => {
    for (const [lang, dict] of [['en', en], ['fr', fr]] as const) {
      const hit = lookup(dict as never, key);
      expect(hit, `${key} missing in ${lang}`).toBeTypeOf('string');
      expect(String(hit).trim().length, `${key} empty in ${lang}`).toBeGreaterThan(0);
    }
  });

  it('none of them implies somebody else is reviewing', () => {
    for (const key of keys.filter(k => k.endsWith('YourApproval'))) {
      const text = String(lookup(en as never, key)).toLowerCase();
      for (const banned of ['review', 'awaiting', 'jalla', 'verif']) {
        expect(text, `"${text}" must not say ${banned}`).not.toContain(banned);
      }
    }
  });

  it('the timeline badge is no longer hardcoded English', () => {
    expect(timeline).not.toContain("'Self-verified'");
    expect(timeline).not.toContain("'Jalla Verified'");
  });
});
