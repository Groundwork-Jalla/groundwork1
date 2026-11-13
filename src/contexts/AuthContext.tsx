import { createContext, useContext, useEffect, useState } from "react";
import { rememberThisDevice } from '@/lib/supabase/user-devices';
import type { Session, User } from "@supabase/supabase-js";
import { useAccountAccess } from '@/hooks/useAccountAccess';
import type { AccountRole } from '@/lib/auth/account-role';
import { supabase } from "@/lib/supabase/client";
import { rememberAccount } from "@/lib/auth/returning-user";
import { recordSignupCountry } from "@/lib/auth/record-signup-country";
import { recordCrmContact } from "@/lib/auth/record-crm-contact";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** True when the signed-in user is a platform admin (canonical: user_roles via is_admin RPC). */
  isAdmin: boolean;
  /** False until the admin check has resolved for the current session. */
  adminChecked: boolean;
  /** True when the signed-in user holds the `verifier` role (user_roles, RLS-trusted). */
  isVerifier: boolean;
  /** Contractor account role; accepted legacy assignments are a fallback only without an explicit role. */
  isContractor: boolean;
  /** False until the role check has resolved for the current session. */
  rolesChecked: boolean;
  accountRole: AccountRole | null;
  refreshRoles: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const { access, checked, refresh: refreshRoles } = useAccountAccess(session?.user?.id, loading, session?.access_token);
  const isAdmin = access?.isAdmin ?? false;
  const isVerifier = access?.isVerifier ?? false;
  const isContractor = access?.isContractor ?? false;
  const adminChecked = checked; const rolesChecked = checked;
  const accountRole = access?.role ?? null;

  useEffect(() => {
    let live = true; let authEventSeen = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!live || authEventSeen) return;
      setSession(session);
      if (session) { rememberAccount(); void recordSignupCountry(); void recordCrmContact(); }
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!live) return;
      authEventSeen = true; setSession(session);
      // One place for every route in: email, Google, magic link, session restore. Marks
      // this browser as one that has an account, which is what the landing page's join
      // button reads to decide between sign-up and log-in. Never cleared on sign-out —
      // signing out does not delete the account.
      // Same hook records the country the account was created from, from the request
      // IP server-side — signup never asks for one. Fire-and-forget, once per browser.
      // And it puts the person in the CRM: GoHighLevel knew only about contractors, so
      // every homeowner was invisible to whoever answers the phone. Also fire-and-forget,
      // also once per browser — a CRM outage must never affect signing in.
      if (session) { rememberAccount(); void recordSignupCountry(); void recordCrmContact(); }
      setLoading(false);
    });

    return () => { live = false; subscription.subscription.unsubscribe(); };
  }, []);

  // Note the device this account is signed in from (168), so Profile can show
  // "signed in on N devices" from something real. Fire-and-forget: a failure here
  // must never stand between somebody and their dashboard.
  useEffect(() => {
    const id = session?.user?.id;
    if (!id) return;
    void rememberThisDevice(id).catch(() => {});
  }, [session?.user?.id]);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, isAdmin, adminChecked, isVerifier, isContractor, rolesChecked, accountRole, refreshRoles, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
