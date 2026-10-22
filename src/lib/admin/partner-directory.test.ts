import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * An accepted PARTNER reaches the directory intact.
 *
 * Accepting publishes to the client-facing directory (033), but that mapping was written
 * for the public form and reads fields the in-app partner application never fills. Left
 * alone it published a ten-year professional as having nought years, no trade and no
 * location — which is a "real data only" fault before it is a mapping one. A client reads
 * that card and draws a conclusion.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const sql = readFileSync(
  join(ROOT, 'supabase/migrations/147_partners_reach_the_directory_intact.sql'), 'utf8')
  .replace(/--.*$/gm, '');

describe('the partner path', () => {
  it('reads years from either vocabulary', () => {
    // The public form stores 'y5_10'; the partner form stores '5-10'.
    // `+` is a regex quantifier, so the bucket has to be escaped before it is used
    // as a pattern — unescaped, '10+' matches "one or more zeroes".
    const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const [bucket, years] of [['1-3', '1'], ['3-5', '3'], ['5-10', '5'], ['10+', '10']]) {
      expect(sql, `${bucket} unmapped — it would publish as 0`)
        .toMatch(new RegExp(`WHEN '${esc(bucket)}'\\s+THEN ${years}`));
    }
  });

  it('and still reads the public form’s buckets', () => {
    for (const bucket of ['under1', 'y1_3', 'y3_5', 'y5_10', 'y10']) {
      expect(sql).toMatch(new RegExp(`WHEN '${bucket}'`));
    }
  });

  it('takes the trade from the specialty chosen at onboarding', () => {
    // `role` on an in-app application is free text on older rows, in whichever language
    // they typed it, which the directory would render raw.
    expect(sql).toMatch(/v_trade := coalesce\(/);
    expect(sql).toMatch(/ob\.specialty/);
  });

  it('and a typed-in specialty publishes what they wrote, not "other"', () => {
    expect(sql).toMatch(/WHEN ob\.specialty = 'other' THEN NULLIF\(btrim\(coalesce\(ob\.specialty_other/);
  });

  it('uses the regions they cover as the location', () => {
    // "City you work from" was removed from the partner application in 142; regions
    // replaced it, and live rows carry an empty country.
    expect(sql).toMatch(/v_location := coalesce\([\s\S]{0,80}a\.regions/);
  });

  it('gives them a specialty, since project_types is a public-form question', () => {
    expect(sql).toMatch(/ARRAY\[ob\.specialty\]/);
  });

  it('and links the listing to their account', () => {
    expect(sql).toMatch(/application_id, user_id/);
    expect(sql).toMatch(/user_id\s+=\s+coalesce\(EXCLUDED\.user_id, public\.contractors\.user_id\)/);
  });
});

describe('what it does not change', () => {
  it('the public form keeps its own mapping', () => {
    // The statements themselves. Anchoring on a comment does not work here: this file
    // is read with `--` comments stripped, so the comment is not in the string.
    expect(sql).toMatch(/v_trade\s+:= a\.role;/);
    expect(sql).toMatch(/v_specs\s+:= coalesce\(a\.project_types, '\{\}'\);/);
    expect(sql).toMatch(/v_location := trim\(both ', ' FROM concat_ws\(', ', NULLIF\(a\.city/);
  });

  it('only an accepted application is published', () => {
    expect(sql).toMatch(/not_accepted/);
  });

  it('it is staff-only', () => {
    expect(sql).toMatch(/IF NOT public\.is_admin\(\) THEN[\s\S]{0,80}not_allowed/);
  });

  it('and a partner’s completed projects are not invented', () => {
    // The public form asked for three past projects with references; the partner
    // application does not. A number here would be the fault this migration fixes.
    expect(sql).toMatch(/coalesce\(jsonb_array_length\(a\.projects\), 0\)/);
    expect(sql).not.toMatch(/completed_projects\s*[:=]\s*[1-9]/);
  });
});
