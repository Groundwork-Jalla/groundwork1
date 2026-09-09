import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A verification anybody can mint is not a verification.
 *
 * `014_certificates.sql` granted INSERT to every authenticated user with
 * `WITH CHECK (true)`, so any signed-in person could create a certificate row for any
 * project and hand out the `/verify/:id` link — which is public, and is the entire trust
 * surface of the product. Migration 079 closes that and revokes what was issued on
 * Self Verify, per Philip's decision of 4 September 2026.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const sql  = () => read('supabase/migrations/079_certificate_integrity.sql');

describe('only an admin can issue a certificate', () => {
  it('drops the policy that let anyone forge one', () => {
    expect(sql()).toMatch(/DROP POLICY IF EXISTS "authenticated_insert_certificates"/);
    expect(sql()).toMatch(/CREATE POLICY "admin_insert_certificates"[\s\S]*?WITH CHECK \(public\.is_admin\(\)\)/);
  });

  it('creates no permissive INSERT of its own, and none is added later', () => {
    // `WITH CHECK (true)` on INSERT is the exact shape of the original hole. 014 still
    // contains it as history — it is dropped by name above — so this checks every
    // certificate migration FROM 079 onwards, which is where a regression would land.
    const later = ['079_certificate_integrity.sql'];
    for (const f of later) {
      // Comments quote the original policy verbatim to explain it, so scanning the raw
      // file finds `WITH CHECK (true)` in the prose. Only code counts.
      const text = read(`supabase/migrations/${f}`)
        .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
      const inserts = [...text.matchAll(/FOR INSERT([\s\S]{0,200}?)WITH CHECK \(([^)]*)\)/g)];
      for (const m of inserts) {
        expect(m[2].trim(), `${f} creates a permissive INSERT policy`).not.toBe('true');
      }
    }
  });
});

describe('a certificate can be withdrawn, and stays withdrawable', () => {
  it('adds revoked_at and an admin-only UPDATE', () => {
    expect(sql()).toMatch(/ADD COLUMN IF NOT EXISTS revoked_at/);
    expect(sql()).toMatch(/CREATE POLICY "admin_update_certificates"[\s\S]*?USING \(public\.is_admin\(\)\)/);
  });

  it('never deletes the row', () => {
    // A certificate that disappears cannot be shown to have been revoked, and /verify
    // would 404 — which reads as our bug rather than as an answer.
    expect(sql()).not.toMatch(/DELETE FROM public\.certificates/);
    expect(sql()).not.toMatch(/FOR DELETE/);
  });

  it('does not try to delete from storage in SQL', () => {
    // Supabase refuses it — `storage.protect_delete()` raises 42501 — and is right to:
    // deleting the row unlinks the record while orphaning the object, so the statement
    // that looks like it removes a file does not. The first draft of 079 did this and
    // the whole migration rolled back.
    expect(sql()).not.toMatch(/DELETE FROM storage\./);
  });

  it('tracks whether a revoked PDF has actually been withdrawn', () => {
    // The bucket is public-read, so a revoked row alone leaves a downloadable document
    // headed "Verified Completion" for anyone holding the URL. `pdf_purged_at` is how you
    // tell "marked revoked" from "actually gone".
    expect(sql()).toMatch(/ADD COLUMN IF NOT EXISTS pdf_purged_at/);

    const purge = read('api/_handlers/certificate-purge.ts');
    expect(purge, 'the purge must go through the Storage API')
      .toMatch(/storage\.from\('certificates'\)\.remove\(/);
    // Only revoked, not-yet-purged rows — so it is safe to run repeatedly.
    expect(purge).toMatch(/\.not\('revoked_at', 'is', null\)/);
    expect(purge).toMatch(/\.is\('pdf_purged_at', null\)/);
    // Marked only AFTER the files are gone: the reverse order leaves a certificate that
    // looks withdrawn and is still downloadable.
    expect(purge.indexOf('.remove(')).toBeLessThan(purge.indexOf('pdf_purged_at: new Date()'));
  });

  it('revokes Self Verify certificates and nothing else', () => {
    expect(sql()).toMatch(/p\.tier = 'self_verify'/);
    expect(sql()).toMatch(/self_verify_not_eligible/);
  });
});

describe('the UI agrees with the database', () => {
  it('offers the print button only on the verified tiers', () => {
    const tracker = read('src/components/project/StageTracker.tsx');
    expect(tracker).toMatch(/canCertify\s*=\s*tier === 'jalla_verify' \|\| tier === 'jalla_management'/);
    expect(tracker, 'the print button must be gated on the tier, not just on completion')
      .toMatch(/stage\.status === 'complete' && canCertify/);
  });

  it('answers a revoked certificate rather than 404ing it', () => {
    const page = read('src/app/routes/verify.tsx');
    expect(page).toMatch(/cert\?\.revoked_at \? \(\s*<Revoked/);
    // The revoked branch has to be tested BEFORE the valid one, or a withdrawn
    // certificate renders as a good one.
    expect(page.indexOf('cert?.revoked_at')).toBeLessThan(page.indexOf('<CertificateCard cert={cert} />'));
  });

  it('does not print the issuance footer under a revoked certificate', () => {
    expect(read('src/app/routes/verify.tsx')).toMatch(/cert && !cert\.revoked_at &&/);
  });
});
