import { describe, expect, it } from 'vitest';
import { lookup } from '@/lib/i18n/translate';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

describe('project Team navigation and access copy', () => {
  it.each(['project.tabs.team', 'projectTeam.title', 'projectTeam.body', 'projectTeam.yourRole',
    'projectTeam.manageAccess', 'projectTeam.viewAccess', 'teamAccess.primaryContractor'])('%s exists in both languages', key => {
    const english = lookup(en, key), french = lookup(fr, key);
    expect(english).toBeTypeOf('string'); expect(french).toBeTypeOf('string');
    expect(english).not.toBe(french);
  });

  it('directs first-contractor setup to the translated project tab', () => {
    expect(en.tour.client.invite.body).toContain(en.project.tabs.team);
    expect(fr.tour.client.invite.body).toContain(fr.project.tabs.team);
  });
});
