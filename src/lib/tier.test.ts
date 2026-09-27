import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSelfVerify, awaitsSomeoneElse } from '@/lib/tier';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Self Verify has no reviewer.
 *
 * That is the whole plan: the owner uploads their evidence and approves it themselves.
 * Nobody at Jalla looks at it, so a screen that says "In Review" or "Awaiting Approval"
 * is describing a wait that cannot end — and a plan the owner did not buy.
 *
 * The write paths already fork on tier (`markSubstageComplete`, `approveStage`), so a
 * Self Verify stage should never reach `pending_review` at all. These pins are about the
 * READ path, which had no tier check: a legacy row, or a project whose plan changed,
 * would have been drawn with verification wording regardless. Three components render
 * that state, and each one now has to know the plan before it picks a word.
 */
const ROOT = resolve(__dirname, '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
/** Comments explain the rule; they must not be what satisfies the assertion. */
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const tracker  = code('src/components/project/StageTracker.tsx');
const timeline = code('src/components/project/TimelineTab.tsx');
const overview = code('src/components/project/OverviewTab.tsx');

describe('isSelfVerify', () => {
  it('accepts both names for the same plan', () => {
    // `starter` is the pre-rename value (migration 008) and still sits in old rows.
    expect(isSelfVerify('self_verify')).toBe(true);
    expect(isSelfVerify('starter')).toBe(true);
  });

  it('rejects the plans where somebody else decides', () => {
    for (const tier of ['jalla_verify', 'jalla_management', 'pro', 'enterprise']) {
      expect(isSelfVerify(tier), `${tier} has a reviewer`).toBe(false);
      expect(awaitsSomeoneElse(tier)).toBe(true);
    }
  });

  it('treats an unknown or missing tier as needing review, never as self-verify', () => {
    // Failing open would show a Jalla Verify owner their stage as self-approved.
    for (const tier of [null, undefined, '', 'something_new']) {
      expect(isSelfVerify(tier)).toBe(false);
    }
  });
});

describe('no client screen shows a Self Verify owner a wait that does not exist', () => {
  it('the stage badge picks its word from the tier', () => {
    expect(tracker).toContain("isSelfVerify(tier) ? 'project.stages.badgeYourApproval' : 'project.stages.badgeReview'");
    // The badge cannot answer without the tier, so it has to be handed one.
    expect(tracker).toMatch(/function StageBadge\(\{ status, tier \}/);
    expect(tracker).toContain('<StageBadge status={stage.status} tier={tier} />');
  });

  it('the timeline pill and its legend both fork', () => {
    expect(timeline).toContain("isSelfVerify(tier) ? 'project.timeline.statusYourApproval' : 'project.timeline.statusAwaiting'");
    expect(timeline).toContain("? 'project.timeline.legendYourApproval'");
    expect(timeline).toMatch(/function statusLabelKey\(status: string, tier: string\)/);
    expect(timeline).toContain('<StatusPill status={stage.status} tier={project.tier} />');
  });

  it('the overview stage row forks', () => {
    expect(overview).toContain("isSelfVerify(tier) ? 'project.overview.statusYourApproval' : 'project.overview.statusReview'");
    expect(overview).toContain('tier={project.tier}');
  });

  it('no client component decides this with a hand-written tier comparison', () => {
    // Fourteen copies of `tier === 'self_verify' || tier === 'starter'` is how one of
    // them eventually forgets `starter`. One predicate, imported.
    for (const [name, body] of [['StageTracker', tracker], ['TimelineTab', timeline], ['OverviewTab', overview]] as const) {
      expect(body, `${name} must import the predicate`).toContain("from '@/lib/tier'");
      expect(body, `${name} must not re-derive the tier check`).not.toContain("=== 'starter'");
    }
  });
});

describe('the strings exist in both languages', () => {
  const keys = [
    'project.stages.badgeYourApproval',
    'project.timeline.statusYourApproval',
    'project.timeline.legendYourApproval',
    'project.timeline.selfVerified',
    'project.timeline.jallaVerified',
    'project.overview.statusYourApproval',
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
