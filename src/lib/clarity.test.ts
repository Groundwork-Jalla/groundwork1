import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { claritySurfaceForPath, isClarityAllowedPath } from '@/lib/clarity';

const read = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8');

describe('Microsoft Clarity privacy guard & masking', () => {
  it('excludes auth, admin, invite, claim, reset, and verification routes', () => {
    expect(isClarityAllowedPath('/auth/login')).toBe(false);
    expect(isClarityAllowedPath('/auth/signup')).toBe(false);
    expect(isClarityAllowedPath('/admin')).toBe(false);
    expect(isClarityAllowedPath('/admin/inbox')).toBe(false);
    expect(isClarityAllowedPath('/invite/abc123')).toBe(false);
    expect(isClarityAllowedPath('/claim/xyz789')).toBe(false);
    expect(isClarityAllowedPath('/reset-password')).toBe(false);
    expect(isClarityAllowedPath('/verify')).toBe(false);
  });

  it('allows public, client, and contractor product routes', () => {
    expect(isClarityAllowedPath('/')).toBe(true);
    expect(isClarityAllowedPath('/projects')).toBe(true);
    expect(isClarityAllowedPath('/projects/123')).toBe(true);
    expect(isClarityAllowedPath('/work/projects/123')).toBe(true);
    expect(isClarityAllowedPath('/tools/budget')).toBe(true);
  });

  it('maps routes to non-PII surface labels', () => {
    expect(claritySurfaceForPath('/')).toBe('public');
    expect(claritySurfaceForPath('/tools/budget')).toBe('tools');
    expect(claritySurfaceForPath('/projects')).toBe('client');
    expect(claritySurfaceForPath('/work/projects')).toBe('contractor');
  });

  it('applies data-clarity-mask="true" to all sensitive financial, receipt, document, profile, and chat views', () => {
    const maskedFiles = [
      'src/components/project/MoneyValue.tsx',
      'src/components/project/StagePaymentGate.tsx',
      'src/components/project/InlineReceiptUploader.tsx',
      'src/components/contractor/ReceiptDecisionDialog.tsx',
      'src/components/chat/LiveChatWidget.tsx',
      'src/components/project/DocumentViewer.tsx',
      'src/app/routes/profile.tsx',
      'src/app/routes/work/payouts.tsx',
    ];
    for (const file of maskedFiles) {
      expect(read(file), `${file} must mask sensitive content from Clarity`).toContain('data-clarity-mask="true"');
    }
  });
});
