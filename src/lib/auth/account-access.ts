import { supabase } from '@/lib/supabase/client';
import { isAccountRole, type AccountRole } from './account-role';
export interface AccountAccess {
  userId: string; role: AccountRole; roles: string;
  isAdmin: boolean; isVerifier: boolean; isContractor: boolean;
}
export type AccountAccessRead = { ok: true; access: AccountAccess } | { ok: false; error: string };
/** All role flags come from one database snapshot, rather than mixed concurrent reads. */
export async function readAccountAccess(userId: string): Promise<AccountAccessRead> {
  try {
    const { data, error } = await supabase.rpc('my_account_access');
    if (error) return { ok: false, error: error.message };
    if (!data || data.user_id !== userId || !isAccountRole(data.role) || typeof data.roles !== 'string'
      || ['is_admin', 'is_verifier', 'is_contractor'].some(key => typeof data[key] !== 'boolean')) {
      return { ok: false, error: 'Account roles are unresolved' };
    }
    const role = data.is_admin ? 'admin' : data.is_verifier ? 'verifier' : data.is_contractor ? 'contractor' : 'client';
    if (data.role !== role) return { ok: false, error: 'Account role snapshot is inconsistent' };
    return { ok: true, access: { userId, role, roles: data.roles,
      isAdmin: data.is_admin, isVerifier: data.is_verifier, isContractor: data.is_contractor } };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'unreachable' }; }
}
