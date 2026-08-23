import { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
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
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) { rememberAccount(); void recordSignupCountry(); void recordCrmContact(); }
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
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

    return () => subscription.subscription.unsubscribe();
  }, []);

  // Resolve admin status against user_roles (canonical, RLS-trusted source),
  // not JWT metadata — so adding an admin is just a user_roles insert.
  //
  // `loading` gates this, and that guard is load-bearing. Without it, the first pass on a
  // hard refresh sees no session yet — it has not been restored from storage — and used to
  // announce `adminChecked = true, isAdmin = false`. That is not an answer, it is the
  // absence of a question, and the admin layout believed it: React runs a child's effects
  // before its parent's, so the moment the session arrived AdminLayout read that stale
  // pair and redirected to /dashboard before this effect could re-run for the real user.
  // Refreshing any admin page bounced you out of the admin area.
  //
  // So: while the session is unknown, say nothing. `adminChecked` stays false, the layout
  // keeps showing its spinner, and the redirect cannot fire on a guess.
  useEffect(() => {
    let cancelled = false;
    if (loading) return;

    const uid = session?.user?.id;
    if (!uid) { setIsAdmin(false); setAdminChecked(true); return; }

    setAdminChecked(false);
    (async () => {
      const { data, error } = await supabase.rpc('is_admin');
      if (cancelled) return;
      setIsAdmin(!error && data === true);
      setAdminChecked(true);
    })();

    return () => { cancelled = true; };
  }, [loading, session?.user?.id]);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, isAdmin, adminChecked, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
