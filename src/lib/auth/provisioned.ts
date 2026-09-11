import { supabase } from '@/lib/supabase/client';

// =========================================================
// "Must this person change their password before going any further?"
//
// True for an account an admin created and handed over with a temporary password, until
// the password is actually changed — the database clears the flag when the hash changes
// (migration 083), so the answer here is never a claim the browser made about itself.
//
// Read after sign-in and on entering the app shell, so the forced change cannot be
// skipped by typing /dashboard into the address bar.
// =========================================================

export async function mustChangePassword(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('must_change_password')
    .eq('id', userId)
    .maybeSingle();
  return data?.must_change_password === true;
}

/** Where a forced change happens. The marker tells the page to explain why. */
export const FORCED_PASSWORD_PATH = '/auth/new-password?first=1';
