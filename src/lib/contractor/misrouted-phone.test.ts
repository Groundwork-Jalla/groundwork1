import { describe, expect, it } from 'vitest';
import { isMisroutedCameroonian, isOrphanRecord } from '../../../api/_handlers/crm-audit';

/**
 * This predicate decides which contacts get shown as junk, and eventually which get
 * deleted. It has to be narrow: flagging a real American contact as a corrupted
 * Cameroonian one would delete a genuine record.
 *
 * GHL stamps `+1` on any number handed to it without a country code, because the
 * sub-account is registered in Maryland. A Cameroonian mobile is nine digits starting
 * with 6, so `+1` + that shape is the specific corruption. A real US number is `+1` plus
 * ten digits and cannot collide.
 */
describe('isMisroutedCameroonian', () => {
  it('catches the corruption GHL actually produced', () => {
    // Observed live on 31 Aug 2026, alongside their +237 twins.
    expect(isMisroutedCameroonian('+1697784169')).toBe(true);
    expect(isMisroutedCameroonian('+1 671865045')).toBe(true);
    expect(isMisroutedCameroonian('+1654896710')).toBe(true);
    expect(isMisroutedCameroonian('+1654377931')).toBe(true);
  });

  it('leaves genuine US numbers alone', () => {
    expect(isMisroutedCameroonian('+1 202 555 0134')).toBe(false); // 10 digits
    expect(isMisroutedCameroonian('+13015550188')).toBe(false);
  });

  it('leaves correctly-formatted Cameroonian numbers alone', () => {
    expect(isMisroutedCameroonian('+237670000000')).toBe(false);
    expect(isMisroutedCameroonian('+237 6 54 89 67 10')).toBe(false);
  });

  it('does not flag a landline or a number of the wrong shape', () => {
    expect(isMisroutedCameroonian('+1233456789')).toBe(false);  // starts 2, not 6
    expect(isMisroutedCameroonian('+165489671')).toBe(false);   // 8 digits
    expect(isMisroutedCameroonian('')).toBe(false);
  });
});

/**
 * The rule that actually decides what gets deleted.
 *
 * Phone shape cannot do this job. Groundwork is diaspora-facing, so legitimate US and
 * Canadian homeowners are `+1` contacts — they are the customer base. And a mangled
 * Nigerian mobile is `+1` plus ten digits, indistinguishable from a real US number.
 * What the record *lacks* is country-independent.
 */
describe('isOrphanRecord', () => {
  const orphan  = { email: '', tags: [], source: '' };
  const real    = { email: 'a@b.c', tags: ['groundwork', 'groundwork:contractor'], source: 'groundwork_contractor_application' };

  it('selects the record the legacy webhook leaves behind', () => {
    expect(isOrphanRecord(orphan)).toBe(true);
  });

  it('never selects a contact the API created', () => {
    expect(isOrphanRecord(real)).toBe(false);
  });

  it('protects a legitimate US diaspora homeowner', () => {
    // A real +1 customer. Phone shape would say nothing either way; this must not match.
    expect(isOrphanRecord({
      email: 'diaspora@example.com', tags: ['groundwork', 'groundwork:homeowner'], source: 'groundwork_user_signup',
    })).toBe(false);
  });

  it('catches a mangled NIGERIAN number, which phone shape cannot', () => {
    // +1 plus ten digits is a valid US number by shape. Only the compound state sees it.
    const nigerian = { email: '', tags: [], source: '' };
    expect(isMisroutedCameroonian('+18031234567')).toBe(false); // shape rule is blind
    expect(isOrphanRecord(nigerian)).toBe(true);                // compound rule is not
  });

  it('spares anything carrying even one sign of us', () => {
    expect(isOrphanRecord({ email: 'x@y.z', tags: [], source: '' })).toBe(false);
    expect(isOrphanRecord({ email: '', tags: ['groundwork'], source: '' })).toBe(false);
    expect(isOrphanRecord({ email: '', tags: [], source: 'groundwork_user_signup' })).toBe(false);
  });
});
