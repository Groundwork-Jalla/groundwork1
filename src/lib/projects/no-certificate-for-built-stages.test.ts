import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A stage that was already built when the project joined never offers a certificate.
 *
 * Philip, 10 Nov 2026: "projects uploaded mid-build incorrectly trigger automatic
 * certificate issuance for previously completed stages" and "certificates must depend on
 * verification rather than stage completion."
 *
 * Checked against production the next day: no certificate has ever been issued, for any
 * stage, on any project — `certificates` and `stage_verifications` are both empty, and
 * 103's own invariant (no pre-existing stage holds one) is intact. What was seen was the
 * "Download certificate" control, which keyed on `status === 'complete'`: a pre-existing
 * stage is complete, so on a Jalla Verify project the button appeared beside work nobody
 * from Jalla ever saw. A button that offers a certificate is the claim, pressed or not.
 */
const code = (f: string) => readFileSync(resolve(__dirname, '..', '..', '..', f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the certificate control', () => {
  const tracker = code('src/components/project/StageTracker.tsx');

  it('is never shown for a stage completed before the project joined', () => {
    expect(tracker).toMatch(/stage\.status === 'complete' && canCertify && !stage\.pre_existing && \(/);
  });

  it('is still tier-gated, as it was', () => {
    // The display half of 079; the database half is what stops a row being written.
    expect(tracker).toMatch(/const canCertify = tier === 'jalla_verify' \|\| tier === 'jalla_management';/);
  });
});
