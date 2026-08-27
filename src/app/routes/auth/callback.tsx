import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { EmailOtpType, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { acceptInvite } from "@/lib/supabase/invites";
import { postAuthPath } from "@/lib/auth/post-auth-path";
import { trackEvent } from "@/lib/analytics";
import { useT } from "@/lib/i18n";
import { forgetEmailRequest, readEmailRequest, type AuthEmailFlow } from "@/lib/auth/last-email-request";

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

/**
 * A `token_hash` link is device-independent, and that is the whole point of it.
 *
 * The client runs the PKCE flow, which stores a code verifier in the localStorage of
 * whichever browser called signUp(). A `?code=` link can therefore only be completed in
 * that same browser. Signing up on a laptop and confirming from the phone — an ordinary
 * thing to do, since that is where email is — leaves the phone with no verifier, the
 * exchange fails, and the page says the link expired when it is perfectly good.
 *
 * verifyOtp needs no verifier, so it works wherever the mail is opened. It only runs if
 * the Supabase email template has been switched to send `token_hash`; see the note in
 * docs/. Until then these links keep arriving as `?code=` and fall through below.
 */
const OTP_TYPES: EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change'];

function otpType(raw: string | null): EmailOtpType | null {
  return OTP_TYPES.includes(raw as EmailOtpType) ? (raw as EmailOtpType) : null;
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  // What this browser last asked for. A `?code=` link carries no `type`, so without this
  // a spent reset and a spent signup are indistinguishable — which is how a password
  // reset came to offer "confirm your email" and land on the signup page.
  const [pending] = useState(() => readEmailRequest());
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  async function resendLink(flow: AuthEmailFlow, email: string) {
    setResend('sending');
    const origin = window.location.origin;
    const { error: sendError } = flow === 'recovery'
      ? await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback` })
      : await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${origin}/auth/callback` } });
    setResend(sendError ? 'failed' : 'sent');
  }


  useEffect(() => {
    async function run() {
      const params = new URLSearchParams(window.location.search);

      // Supabase reports a rejected token or a provider refusal by redirecting here with
      // the reason attached, rather than by failing an exchange — surface it rather than
      // waiting for a session that is never coming. It arrives in the query on the PKCE
      // flow and in the fragment on the implicit one, and only the query was being read,
      // so an implicit-flow failure silently became a redirect to the login page.
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const authError = params.get("error_description") ?? params.get("error")
        ?? hash.get("error_description") ?? hash.get("error");
      if (authError) {
        setError(authError);
        // otp_expired is the one we can actually act on: the link was single-use and is
        // now spent, so the way out is a fresh email, not a login they cannot complete.
        setExpired((params.get("error_code") ?? hash.get("error_code")) === "otp_expired");
        return;
      }

      const tokenHash = params.get("token_hash");
      const type = otpType(params.get("type"));
      const hasCode = !!params.get("code");

      // Is this a password reset? Three sources, because only the first is reliable and
      // it is the one Supabase does NOT send on the PKCE path.
      //
      //   type=recovery      the token_hash path, present only on the OTP-style link
      //   flow=recovery      our own marker on redirectTo, added in reset-password.tsx
      //   readEmailRequest   what this browser last asked for, as a final fallback
      //
      // Beta testing, 25 Aug 2026: a reset link arrived as `?code=` with no `type`, so
      // the check below never fired and the user was signed in and sent to onboarding
      // with their old password intact.
      const isRecovery =
        type === 'recovery'
        || params.get("flow") === 'recovery'
        || readEmailRequest()?.flow === 'recovery';

      let session: Session | null = null;

      if (tokenHash && type) {
        // Supabase's own message is accurate here — it distinguishes a genuinely
        // expired or already-used token from a malformed one — so surface it rather
        // than replacing it with a guess.
        const { data, error: otpError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash, type,
        });
        if (otpError) { setError(otpError.message); return; }
        session = data.session;
      } else if (hasCode) {
        session = await waitForSession();
      } else {
        session = (await supabase.auth.getSession()).data.session;
      }

      if (!session) {
        // Reached only on the `?code=` path. The two ways to get here are a link that
        // really has expired and a link opened in a different browser from the one that
        // started sign-up, and the client cannot tell them apart — the verifier is
        // simply absent either way. So say what is true of both and give them the move
        // that works: go back and sign in.
        if (hasCode) { setError(t('auth.callback.wrongDevice')); return; }
        navigate("/auth/login", { replace: true });
        return;
      }

      // A recovery link proves control of the mailbox, not knowledge of the password —
      // so it must end at "set a new one", never at the dashboard. Routing it like a
      // normal sign-in is what made "Forgot password?" silently a no-op.
      //
      // Cleared here rather than in new-password.tsx: the remembered request is now one
      // of the signals above, so leaving it set would send this browser's NEXT sign-up
      // confirmation to the password form too.
      if (isRecovery) {
        forgetEmailRequest();
        navigate("/auth/new-password", { replace: true });
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
        <div className="mt-6 flex flex-col items-center gap-3">
          {/* A spent link used to leave only "Back to login", which is a dead end: they
              cannot log in until the link's job is done. Resend for real where we know
              the address, and send them to the right form where we do not — never to
              signup for someone who was resetting a password. */}
          {pending && resend !== 'sent' && (
            <button
              type="button"
              disabled={resend === 'sending'}
              onClick={() => resendLink(pending.flow, pending.email)}
              className="text-sm font-medium text-brand-near-black underline underline-offset-4 disabled:opacity-50"
            >
              {resend === 'sending'
                ? t('auth.callback.resending')
                : t(pending.flow === 'recovery' ? 'auth.callback.resendReset' : 'auth.callback.resendConfirm',
                    { email: pending.email })}
            </button>
          )}
          {resend === 'sent' && (
            <p className="text-sm text-brand-near-black">
              {t('auth.callback.resent', { email: pending?.email ?? '' })}
            </p>
          )}
          {resend === 'failed' && (
            <p className="text-sm text-state-alert">{t('auth.callback.resendFailed')}</p>
          )}
          <Link
            to="/auth/login"
            className="text-sm text-brand-mid-grey underline underline-offset-4"
          >
            {t('auth.callback.backToLogin')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center text-sm text-brand-mid-grey">{t('auth.callback.signingIn')}</div>
  );
}
