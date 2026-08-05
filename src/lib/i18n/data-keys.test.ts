import { describe, expect, it } from 'vitest';
import { en } from './en';
import { fr } from './fr';
import { COUNTRIES } from '@/lib/countries';
import { RESOURCE_META, RESOURCE_STAGE_KEYS, RESOURCE_CATEGORIES } from '@/lib/resources-data';
import { TIER_ECONOMICS } from '@/lib/payments/config';

/**
 * `fr.ts` is typed `Mirror<EnDict>`, so the compiler already guarantees the two
 * dictionaries have identical shapes. What it cannot check is the other direction:
 * data files that tell a component *how many* keys to read.
 *
 * `useResources()` builds an article body from `paragraphs`, and `useTierBilling()`
 * builds a feature list from `featureCount`. If a paragraph is added to the dictionary
 * but the count is not bumped, the last paragraph silently vanishes from the page —
 * no error, no blank, just a shorter article. If the count is bumped without the key,
 * the raw key string renders as body text.
 *
 * Both failures are invisible in review and invisible to tsc. These tests are the
 * only thing that catches them.
 */

type Node = Record<string, unknown>;

const DICTS: Array<[string, Node]> = [['en', en as unknown as Node], ['fr', fr as unknown as Node]];

function at(dict: Node, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (node, seg) => (node && typeof node === 'object' ? (node as Node)[seg] : undefined),
    dict,
  );
}

function countSequential(dict: Node, base: string, prefix: string): number {
  let n = 0;
  while (typeof at(dict, `${base}.${prefix}${n + 1}`) === 'string') n += 1;
  return n;
}

describe('country dictionary', () => {
  for (const [lang, dict] of DICTS) {
    it(`${lang} names every country in COUNTRIES`, () => {
      const missing = COUNTRIES
        .filter(c => typeof at(dict, `country.${c.code}`) !== 'string')
        .map(c => c.code);
      expect(missing).toEqual([]);
    });
  }

  it('has no country keys for codes that were dropped from COUNTRIES', () => {
    const codes = new Set(COUNTRIES.map(c => c.code));
    const orphans = Object.keys(en.country).filter(code => !codes.has(code));
    expect(orphans).toEqual([]);
  });
});

describe('tier billing dictionary', () => {
  const DICT_KEY: Record<string, string> = {
    self_verify: 'selfVerify',
    jalla_verify: 'jallaVerify',
    jalla_management: 'jallaManagement',
  };

  for (const [lang, dict] of DICTS) {
    for (const [id, econ] of Object.entries(TIER_ECONOMICS)) {
      const base = `tierBilling.${DICT_KEY[id]}`;

      it(`${lang} ${id} has exactly ${econ.featureCount} feature bullets`, () => {
        expect(countSequential(dict, base, 'f')).toBe(econ.featureCount);
      });

      it(`${lang} ${id} carries period/tag only when declared`, () => {
        expect(typeof at(dict, `${base}.period`) === 'string').toBe(econ.hasPeriod);
        expect(typeof at(dict, `${base}.tag`) === 'string').toBe(econ.hasTag);
      });
    }
  }
});

describe('resource dictionary', () => {
  for (const [lang, dict] of DICTS) {
    for (const meta of RESOURCE_META) {
      const base = `resources.articles.${meta.key}`;

      it(`${lang} ${meta.slug} has exactly ${meta.paragraphs} body paragraphs`, () => {
        expect(countSequential(dict, base, 'p')).toBe(meta.paragraphs);
      });

      it(`${lang} ${meta.slug} has a title and description`, () => {
        expect(typeof at(dict, `${base}.title`)).toBe('string');
        expect(typeof at(dict, `${base}.desc`)).toBe('string');
      });
    }

    it(`${lang} labels every resource category`, () => {
      for (const cat of RESOURCE_CATEGORIES) {
        expect(typeof at(dict, `resources.categories.${cat}`)).toBe('string');
      }
    });

    it(`${lang} labels every tag actually used by an article`, () => {
      const used = new Set(RESOURCE_META.map(r => r.tag).filter(x => x !== null));
      for (const tag of used) {
        expect(typeof at(dict, `resources.tags.${tag}`)).toBe('string');
      }
    });
  }

  it('every stage an article references resolves to a real stage key', () => {
    const stages = RESOURCE_META.map(r => r.stage).filter((s): s is number => s !== null);
    for (const stage of stages) {
      const key = RESOURCE_STAGE_KEYS[stage];
      expect(key, `stage ${stage} has no key`).toBeTruthy();
      expect(typeof at(en as unknown as Node, `stages.${key}`)).toBe('string');
    }
  });

  it('slugs are unique — they are the article URLs', () => {
    const slugs = RESOURCE_META.map(r => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
