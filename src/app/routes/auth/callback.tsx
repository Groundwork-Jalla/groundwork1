import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { acceptInvite } from "@/lib/supabase/invites";
import { postAuthPath } from "@/lib/auth/post-auth-path";
import { trackEvent } from "@/lib/analytics";
import { useT } from "@/lib/i18n";

/**
 * Wait for the session the client is establishing from the URL.
 *
 * The Supabase client is configured with `detectSessionInUrl: true`, so it
 * exchanges the `?code=` itself as soon as this page loads. This page must NOT
 * call exchangeCodeForSession as well: whichever call lands second finds the
 * PKCE verifier already consumed and deleted, and fails with "code verifier not
 * found in storage" — even though the sign-in actually succeeded and the user
 * was created. That double-exchange is what produced the spurious error page.
 *
 * So: observe, don't exchange. Resolve as soon as a session exists, and give up
 * after a timeout rather than hanging on a code that was genuinely rejected.
 */
function waitForSession(timeoutMs = 15000) {
  return new Promise<Session | null>(resolve => {
    let settled = false;
    let unsub: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (session: Session | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub?.();
      resolve(session);
    };

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish(session);
    });
    unsub = () => data.subscription.unsubscribe();

    // The exchange may already have completed before this listener attached.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) finish(session);
    });

    timer = setTimeout(() => finish(null), timeoutMs);
  });
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function run() {
      const params = new URLSearchParams(window.location.search);

      // Supabase reports provider/consent failures as query params, not as a
      // failed exchange — surface those rather than waiting for a session that
      // is never coming.
      const authError = params.get("error_description") ?? params.get("error");
      if (authError) { setError(authError); return; }

      const hasCode = !!params.get("code");

      const session = hasCode
        ? await waitForSession()
        : (await supabase.auth.getSession()).data.session;

      if (!session) {
        if (hasCode) { setError(t('auth.callback.expired')); return; }
        navigate("/auth/login", { replace: true });
        return;
      }

      // Process any pending invite (stored in localStorage before signup)
      const token = localStorage.getItem("pendingInvite");
      if (token) {
        localStorage.removeItem("pendingInvite");
        try {
          const projectId = await acceptInvite(token);
          navigate(`/projects/${projectId}`, { replace: true });
          return;
        } catch {
          // Invalid/used token — fall through to normal routing
        }
      }

      const onboardingComplete = !!session.user?.user_metadata?.onboarding_complete;
      if (!onboardingComplete) trackEvent('signup_complete');
      const { data: isAdmin } = await supabase.rpc('is_admin');
      navigate(postAuthPath({ isAdmin: isAdmin === true, onboardingComplete }), { replace: true });
    }

    run();
  }, [navigate, t]);

  if (error) {
    return (
      <div className="text-center">
        <h1 className="font-sans text-2xl font-bold text-brand-near-black">
          {t('auth.callback.errorTitle')}
        </h1>
        <p className="text-sm text-brand-mid-grey mt-2">{error}</p>
        <Link
          to="/auth/login"
          className="inline-block mt-6 text-sm text-brand-near-black underline underline-offset-4"
        >
          {t('auth.callback.backToLogin')}
        </Link>
      </div>
    );
  }

  return (
    <div className="text-center text-sm text-brand-mid-grey">{t('auth.callback.signingIn')}</div>
  );
}
