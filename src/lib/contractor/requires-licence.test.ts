import { describe, expect, it } from 'vitest';
import { CONTRACTOR_ROLES, requiresLicence, credentialTrack } from './application-types';

/**
 * Who is asked for a professional licence.
 *
 * The rule exists because the opposite one did real damage: the licence was demanded of
 * everybody, which stopped an independent mason registering at all and filled the field
 * with "No" and keyboard noise from the people who got past it.
 */

describe('only the regulated professions are asked', () => {
  it.each(['architect', 'structural_engineer', 'quantity_surveyor', 'land_surveyor', 'land_lawyer'] as const)(
    '%s is asked for a licence', role => {
      expect(requiresLicence(role)).toBe(true);
    });

  it.each(['mason', 'carpenter', 'electrician', 'plumber', 'roofing', 'interior_finishing'] as const)(
    '%s is never asked', role => {
      expect(requiresLicence(role)).toBe(false);
    });

  it('a general contractor is not asked', () => {
    // They may be anything from a one-man operation upward.
    expect(requiresLicence('general_contractor')).toBe(false);
  });

  it('and neither is a specialty somebody typed in themselves', () => {
    // We cannot know what "other" is, so we cannot demand a credential for it.
    expect(requiresLicence('other')).toBe(false);
  });

  it('every known role has an answer', () => {
    // A new role added to the list must be classified deliberately, not default to true
    // and quietly re-block a trade.
    for (const role of CONTRACTOR_ROLES) {
      expect(typeof requiresLicence(role), role).toBe('boolean');
    }
  });

  it('is derived from the credential track, not a second list', () => {
    // Two lists of the same thing drift. This asserts they are the same thing.
    for (const role of CONTRACTOR_ROLES) {
      const track = credentialTrack(role);
      expect(requiresLicence(role), role).toBe(track === 'technical' || track === 'lawyer');
    }
  });

  it('the mason who reported this can register', () => {
    expect(requiresLicence('mason')).toBe(false);
  });
});
