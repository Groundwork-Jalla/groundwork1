import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';
import { CONTRACTOR_ROLES } from '@/lib/contractor/application-types';

/**
 * The specialty dropdown must show trades, not translation keys.
 *
 * It shipped pointing at `contractorApply.form.roles.<key>` when the dictionary has
 * `contractorApply.form.role.<key>` — singular. Every option rendered as its own raw key:
 * "contractorApply.form.roles.general_contractor". A missing key resolves to the key
 * itself, so nothing threw and nothing failed; it was only visible by looking.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const page = readFileSync(join(ROOT, 'src/app/routes/work/onboarding.tsx'), 'utf8');

describe('every specialty has a readable label', () => {
  it.each(CONTRACTOR_ROLES)('%s resolves in both languages', role => {
    for (const [name, dict] of [['en', en], ['fr', fr]] as const) {
      const label = lookup(dict as never, `contractorApply.form.role.${role}`);
      expect(label, `${role} missing in ${name}`).toBeTypeOf('string');
      // The tell-tale of a missing key: the lookup hands back the path.
      expect(String(label), `${role} rendered as its key in ${name}`).not.toContain('contractorApply');
      expect(String(label).trim().length).toBeGreaterThan(1);
    }
  });

  it('and they read as trades, not identifiers', () => {
    // No snake_case leaking into the dropdown.
    for (const role of CONTRACTOR_ROLES) {
      expect(String(lookup(en as never, `contractorApply.form.role.${role}`))).not.toMatch(/_/);
    }
  });

  it('the dropdown points at that path, singular', () => {
    expect(page).toMatch(/contractorApply\.form\.role\.\$\{r\}/);
    expect(page, 'the plural path does not exist in the dictionary')
      .not.toMatch(/contractorApply\.form\.roles\./);
  });
});
