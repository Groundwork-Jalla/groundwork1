import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

// 17 Nov session: the approve button and the dialog it opened carried the same words, so a
// client could not tell whether the first tap had already approved the work.
const src = (f: string) => readFileSync(resolve(__dirname, '../../..', f), 'utf8');

describe('approving work asks for a confirmation that reads as one', () => {
  it('the update dialog confirms with "Confirm approval", not the button that opened it', () => {
    expect(src('src/components/project/SubstageRow.tsx')).toContain("confirmLabel={t('project.clientUi.confirmApproval')}");
    for (const dict of [en, fr]) expect(dict.project.clientUi.confirmApproval).not.toBe(dict.project.stages.approveEvidence);
    expect(en.project.clientUi.confirmApproval).toBe('Confirm approval');
  });

  it('the stage dialog does the same', () => {
    expect(en.project.stages.confirmApproveCta).toBe('Confirm approval');
    for (const dict of [en, fr]) expect(dict.project.stages.confirmApproveCta).not.toBe(dict.project.stages.approveStage.replace(' {n}', ''));
  });
});
