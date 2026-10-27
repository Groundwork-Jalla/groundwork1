import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every category the database allows is rendered somewhere.
 *
 * The admin Documents tab builds its groups by walking a fixed ORDER array, not by
 * walking the rows. A category missing from that array is a document that exists, is
 * readable, is returned by the query — and appears nowhere on screen.
 *
 * That is not hypothetical: `boq` was added to the table's CHECK by migration 096 and
 * to the wizard's upload at the same time, and this list was never updated. The one
 * document a project is priced on could be uploaded and then be invisible to staff.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('the Documents tab can show every category that exists', () => {
  /** The categories the database will accept, read from the migration that sets them. */
  const allowed = (() => {
    const sql = read('supabase/migrations/096_boq_uploads.sql');
    const m = /category IN \(([^)]+)\)/.exec(sql);
    expect(m, 'could not read the category CHECK out of 096').toBeTruthy();
    return m![1].split(',').map(s => s.trim().replace(/'/g, ''));
  })();

  const rendered = (() => {
    const tab = read('src/components/admin/workspace/DocumentsTab.tsx');
    const m = /const ORDER: ProjectDocumentRow\['category'\]\[\] =\s*\[([^\]]+)\]/.exec(tab);
    expect(m, 'could not read ORDER out of DocumentsTab').toBeTruthy();
    return m![1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
  })();

  it('reads both lists, so a pass means something', () => {
    expect(allowed.length).toBeGreaterThan(5);
    expect(rendered.length).toBeGreaterThan(5);
  });

  it.each(allowed)('%s is rendered', (category) => {
    expect(rendered, `category "${category}" is allowed by the database but shown nowhere`)
      .toContain(category);
  });

  it('a bill of quantities leads, being the paper the project is priced on', () => {
    expect(rendered[0]).toBe('boq');
  });

  it('and nothing is listed that the database would refuse', () => {
    for (const category of rendered) expect(allowed).toContain(category);
  });
});

describe('the wizard files its two documents under categories that show', () => {
  const plan = read('src/lib/projects/plan-answer.ts');

  it('the bill of quantities as boq', () => {
    expect(plan).toMatch(/answer\.bq, category: 'boq'/);
  });

  it('and the floor plan NOT as boq — two bills of quantities and no plan is worse', () => {
    expect(plan).toMatch(/for \(const file of answer\.floorPlans\)/);
    expect(plan).toMatch(/category: 'other'/);
  });
});
