import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Agreed 16 November: an account that has recorded payments as a client is not turned
 * into a contractor account by an administrator. The rule is enforced in the database
 * (20261117000100, exercised by `npm run test:account-roles-db`); these pin the parts a
 * database test cannot see.
 */
describe('a paying client is not converted to a contractor by the role tool', () => {
  const migration = readFileSync('supabase/migrations/20261117000100_client_with_payments_stays_client.sql', 'utf8');

  it('holds the rule where every route to the contractor role passes, for an administrator acting on someone else only', () => {
    expect(migration).toContain('BEFORE INSERT ON public.user_roles');
    expect(migration).toMatch(/auth\.uid\(\) IS DISTINCT FROM NEW\.user_id AND public\.is_admin\(\)/);
    // Already a contractor: nothing to refuse.
    expect(migration).toMatch(/NOT EXISTS\(SELECT 1 FROM public\.user_roles WHERE user_id=NEW\.user_id AND role='contractor'\)/);
  });

  it('counts payment actions only, so a mistaken sign-up that created or approved a project can still be corrected', () => {
    for (const source of ['stage_payment_receipts WHERE submitted_by', 'stage_payment_plans WHERE proposed_by', 'payments WHERE receipt_uploaded_by']) expect(migration).toContain(source);
    expect(migration).not.toMatch(/approved_by|projects WHERE user_id/);
  });

  it.each([
    ['src/components/admin/UserRoleEditor.tsx', 'admin.roleEdit.clientPayments'],
    ['src/components/admin/AccountTypeEditor.tsx', 'admin.accountTypeEdit.clientPayments'],
  ])('%s explains the refusal instead of a generic failure', (file, key) => {
    const source = readFileSync(file, 'utf8');
    expect(source).toContain("message.includes('client_payment_history')");
    expect(source).toContain(key);
    // Checked before the generic branches, or it would never be reached.
    expect(source.indexOf('client_payment_history')).toBeLessThan(source.indexOf(".failed'"));
  });

  it('says why, and what the person can do instead, in both languages', () => {
    for (const block of ['roleEdit', 'accountTypeEdit'] as const) {
      expect((en as any).admin[block].clientPayments).toContain('cannot be changed to a contractor account');
      expect((en as any).admin[block].clientPayments).toContain('register a contractor account themselves');
      expect((fr as any).admin[block].clientPayments).toContain('ne peut pas devenir un compte entrepreneur');
    }
  });
});
