import { supabase } from '@/lib/supabase/client';

// =========================================================
// "Must this person change their password before going any further?"
//
// True until a provisioned account replaces its temporary password or an invited
// client chooses their first password. The database clears the flag when the hash
// changes (migration 083), so this is never a claim the browser made about itself.
//
// Read after sign-in and on entering the app shell, so the forced change cannot be
// skipped by typing /dashboard into the address bar.
// =========================================================

export async function mustChangePassword(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('must_change_password')
    .eq('id', userId)
    .maybeSingle();
  // An unreadable flag is not permission to enter the app. Callers keep the person on
  // the authentication screen and offer a retry while this check is unavailable.
  if (error) throw error;
  if (typeof data?.must_change_password !== 'boolean') {
    throw new Error('Password setup status is unavailable');
  }
  return data.must_change_password;
}

/** Where a forced change happens. The marker tells the page to explain why. */
export const FORCED_PASSWORD_PATH = '/auth/new-password?first=1';
