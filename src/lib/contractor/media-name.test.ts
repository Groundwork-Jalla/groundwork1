import { describe, expect, it } from 'vitest';
import { mediaName } from '../../../api/ghl/_documents';

/**
 * GHL's Media Storage is one flat library shared by the whole account, and the uploader
 * originally led each filename with the application id. The result, seen live:
 *
 *     2538b51e-3d7a-4f22-8c2e-f9c...
 *     2538b51e-3d7a-4f22-8c2e-f9c...
 *
 * A 36-character UUID consumed the entire visible filename, so every applicant's
 * documents were indistinguishable from every other's. The files had uploaded correctly;
 * they were simply unusable.
 *
 * The name has to answer "whose is this?" in the width a file tile actually shows.
 */

describe('mediaName', () => {
  it('leads with the person, so a file tile identifies its owner', () => {
    const n = mediaName('Ketchouang Pierre', 'Business Registration', '2538b51e-3d7a-4f22', 0);
    expect(n.startsWith('Ketchouang-Pierre')).toBe(true);
    expect(n).toBe('Ketchouang-Pierre-Business-Registration-2538b51e');
  });

  it('keeps a short id so two applications from one person stay apart', () => {
    const a = mediaName('Ada Mbeki', 'ID', 'aaaaaaaa-1111', 0);
    const b = mediaName('Ada Mbeki', 'ID', 'bbbbbbbb-2222', 0);
    expect(a).not.toBe(b);
  });

  it('strips what GHL will not take in a filename', () => {
    const n = mediaName('Jean-Luc  Ébène / Sarl', 'Attestation (CNPS)', 'abcd1234-x', 0);
    expect(n).toMatch(/^[a-zA-Z0-9._-]+$/);
    expect(n).not.toMatch(/--/);
  });

  it('never produces a nameless file', () => {
    expect(mediaName('', '', 'abcd1234-x', 2)).toBe('contractor-document-3-abcd1234');
  });

  it('truncates a long name without letting it swallow the tile', () => {
    const n = mediaName('X'.repeat(200), 'Y'.repeat(200), 'abcd1234-x', 0);
    expect(n.length).toBeLessThanOrEqual(90);
    expect(n.endsWith('abcd1234')).toBe(true);
  });
});
