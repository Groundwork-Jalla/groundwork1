import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Priority, in words.
 *
 * "Needs your attention" showed priority as a coloured dot with the word hidden in a
 * `title` — invisible on a phone, unreliable to a screen reader, and meaningless to
 * anyone who cannot separate amber from grey. Colour was the only carrier of a fact that
 * decides what an operator does first.
 */
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const list = src('src/components/admin/overview/AttentionList.tsx');

describe('the word carries the priority, not the colour', () => {
  it('the label is rendered as text', () => {
    expect(list).toContain('{t(`admin.attention.priority.${item.priority}` as TKey)}');
    // Inside an element, not an attribute.
    expect(list).toMatch(/<span className=\{cn\('text-\[10px\][^>]*>\s*\n\s*\{t\(`admin\.attention\.priority/);
  });

  it('it is no longer hidden in a title attribute', () => {
    expect(list).not.toMatch(/title=\{t\(`admin\.attention\.priority/);
  });

  it('the dot is decoration now the word is there', () => {
    expect(list).toMatch(/rounded-full', DOT\[item\.priority\]\)\} aria-hidden/);
  });

  it('all four steps have a colour and a word', () => {
    for (const p of ['critical', 'high', 'medium', 'low']) {
      expect(list, `${p} needs a dot colour`).toMatch(new RegExp(`${p}:\\s+'bg-`));
      expect(list, `${p} needs a text colour`).toMatch(new RegExp(`${p}:\\s+'text-`));
      expect(lookup(en, `admin.attention.priority.${p}`), p).toBeTypeOf('string');
      expect(lookup(fr, `admin.attention.priority.${p}`), p).toBeTypeOf('string');
    }
  });

  it('EN and FR both answer, and differ', () => {
    for (const p of ['critical', 'high', 'medium', 'low']) {
      const key = `admin.attention.priority.${p}`;
      expect(lookup(en, key), `${key} is not translated`).not.toBe(lookup(fr, key));
    }
    expect(lookup(en, 'admin.attention.priority.critical')).toBe('Critical');
  });

  it('a longer translation is not truncated', () => {
    // A minimum width lines the items up; it does not cap them. `truncate` on this span
    // would clip "Critique" to make a column look tidy.
    expect(list).toContain('min-w-[5.25rem]');
    const label = list.slice(list.indexOf('min-w-[5.25rem]'), list.indexOf('</span>', list.indexOf('admin.attention.priority')));
    expect(label).not.toContain('truncate');
  });
});

describe('everything else about the list is untouched', () => {
  it('one component still serves both surfaces', () => {
    expect(src('src/app/routes/admin/index.tsx')).toContain('<AttentionList items={actions.items} now={now} limit={OVERVIEW_ROWS} />');
    expect(src('src/app/routes/admin/action-center.tsx')).toContain('<AttentionList items={items} now={now} />');
  });

  it('the Overview preview is still five', () => {
    expect(src('src/components/admin/overview/Blocks.tsx')).toContain('export const OVERVIEW_ROWS = 5;');
  });

  it('ordering is still severity then age, and done once', () => {
    expect(src('src/lib/admin/action-center.ts'))
      .toContain('items.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.since.localeCompare(b.since))');
    // The list renders what it is given; it does not re-sort.
    expect(list).not.toContain('.sort(');
  });

  it('rows are still links to where the work happens', () => {
    expect(list).toContain('<Link');
    expect(list).toContain('to={item.to}');
  });

  it('the preview still has no priority filter — triage belongs to the queue', () => {
    // `.filter(Boolean)` assembling the context line is fine; narrowing by priority is not.
    expect(list).not.toMatch(/filter\([^)]*priority/);
    expect(src('src/app/routes/admin/action-center.tsx')).toContain('i.priority === priority');
  });
});
