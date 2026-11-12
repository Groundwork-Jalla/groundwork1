import { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase/client";
import { holdsVerifierRole, holdsContractorAccess } from '@/lib/auth/roles';
import { postAuthPath } from "@/lib/auth/post-auth-path";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MfaChallenge } from "@/components/auth/MfaChallenge";
import { requiredFactor, type RequiredFactor } from "@/lib/auth/mfa";
import { mustChangePassword, FORCED_PASSWORD_PATH } from "@/lib/auth/provisioned";
import { useT } from "@/lib/i18n";
import { signupHref } from "@/lib/auth/post-auth-path";
import { PasswordField } from '@/components/ui/PasswordField';
import { completeProjectInvitation } from '@/lib/auth/complete-project-invitation';
import {
  projectAuthCallbackUrl, projectInvitationError, projectInvitationPath, readProjectInvitation, withProjectInvitation,
} from '@/lib/auth/project-invitation';

export default function Login() {
  const navigate        = useNavigate();
  const [searchParams]  = useSearchParams();
  const inviteToken     = searchParams.get("invite") ?? "";
  const redirectTo      = searchParams.get("redirect");

  // Carry the destination, and the invite, into sign-up.
  const invitation = readProjectInvitation(searchParams.toString());
  const toSignup = withProjectInvitation(signupHref({ redirect: redirectTo, invite: inviteToken }), invitation);
  const t               = useT();

  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [unavailableInvitation, setUnavailableInvitation] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A correct password is not a completed sign-in when the account has a second factor.
  // Which factor, not merely whether. A user with only the email factor has no
  // Supabase factor at all, so asking "is a challenge required?" answered no and
  // routed them straight in — 2FA that looked on and did nothing.
  const [mfaFactor, setMfaFactor] = useState<RequiredFactor>('none');

  async function handleGoogleSignIn() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: projectAuthCallbackUrl(window.location.origin, searchParams.toString()) },
    });
  }

  /**
   * Everything after the credentials are accepted.
   *
   * Split out because it now has two entry points — straight through for an account with
   * no second factor, and after the code for one that has. Nothing here may run before
   * the factor is cleared: accepting an invite or reading is_admin() on a half-session
   * would act on an identity that is not yet fully proven.
   */
  async function finishLogin() {
    // A provisioned account signs in with a password an admin knows. Nothing else —
    // not an invite, not the dashboard — happens until that password is replaced.
    const { data: { session: current } } = await supabase.auth.getSession();
    if (current) {
      try {
        if (await mustChangePassword(current.user.id)) {
          navigate(withProjectInvitation(FORCED_PASSWORD_PATH, invitation), { replace: true });
          return;
        }
      } catch {
        setError(t('errors.generic'));
        return;
      }
    }

    // Shared and contractor invitations finish after password/MFA authentication.
    if (invitation) {
      try {
        const path = await completeProjectInvitation(invitation);
        // Re-read roles and membership after the write, before either project shell.
        window.location.href = path;
        return;
      } catch (err) {
        setUnavailableInvitation(projectInvitationError(err) === 'projectLinks.unavailable');
        setError(t(projectInvitationError(err)));
        return;
      }
    }

    const { data: { session } } = await supabase.auth.getSession();
    const { data: isAdmin } = await supabase.rpc('is_admin');
    // Resolved together: two independent awaits would serialise the sign-in for no reason.
    const [isVerifier, isContractor] = await Promise.all([
      holdsVerifierRole(session?.user?.id),
      holdsContractorAccess(session?.user?.id),
    ]);
    navigate(postAuthPath({
      isAdmin: isAdmin === true,
      isVerifier,
      isContractor,
      onboardingComplete: !!session?.user?.user_metadata?.onboarding_complete,
      redirect: redirectTo,
    }), { replace: true });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setSubmitting(false);
      setError(error.message);
      return;
    }

    // The password created a session, but at aal1. Stop here and ask for the code —
    // routing now would put a half-authenticated session inside the app.
    const factor = await requiredFactor();
    if (factor !== 'none') {
      setSubmitting(false);
      setMfaFactor(factor);
      return;
    }

    setSubmitting(false);
    await finishLogin();
  }

  if (mfaFactor !== 'none') {
    return (
      <MfaChallenge
        factor={mfaFactor}
        onVerified={finishLogin}
        onCancel={() => { setMfaFactor('none'); setPassword(""); }}
      />
    );
  }

  return (
    <div>
      <h1 className="font-sans text-3xl font-bold text-brand-near-black">{t('auth.login.title')}</h1>
      <p className="text-sm text-brand-mid-grey mt-2">{t('auth.login.subtitle')}</p>

      <form onSubmit={handleSubmit} className="space-y-4 mt-8">
        <div className="space-y-1.5">
          <Label htmlFor="email">{t('auth.login.email')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t('auth.login.password')}</Label>
            <Link
              to="/auth/reset-password"
              className="text-xs text-brand-mid-grey hover:text-brand-near-black transition-colors"
            >
              {t('auth.login.forgot')}
            </Link>
          </div>
          <PasswordField
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-sm text-brand-near-black bg-brand-light-grey rounded-md px-3 py-2"
          >
            {error}
          </motion.p>
        )}
        {unavailableInvitation && <Link to="/" className="block text-sm underline underline-offset-4">{t('invite.goToGroundwork')}</Link>}
        {error && invitation && !unavailableInvitation && (
          <Link to={projectInvitationPath(invitation)} className="block text-sm underline underline-offset-4">
            {t(invitation.kind === 'viewer' ? 'share.accept' : 'invite.accept')}
          </Link>
        )}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
        </Button>
      </form>

      <div className="flex items-center gap-3 my-6">
        <div className="h-px flex-1 bg-brand-border-grey" />
        <span className="text-xs text-brand-mid-grey">{t('common.or')}</span>
        <div className="h-px flex-1 bg-brand-border-grey" />
      </div>

      <Button variant="outline" className="w-full" onClick={handleGoogleSignIn}>
        {t('auth.login.google')}
      </Button>

      <p className="text-center text-sm text-brand-mid-grey mt-8">
        {t('auth.login.noAccount')}{" "}
        <Link to={toSignup} className="text-brand-near-black underline underline-offset-4">
          {t('auth.login.signUp')}
        </Link>
      </p>
    </div>
  );
}
