import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { postAuthPath } from "@/lib/auth/post-auth-path";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordStrength } from "@/components/ui/PasswordStrength";
import { isPasswordAcceptable } from "@/lib/auth/password-policy";
import { useT } from "@/lib/i18n";

/**
 * Set a new password, reached from a reset email.
 *
 * This screen did not exist. `/auth/reset-password` only ever *requested* a link, and the
 * link itself landed on /auth/callback, which signs the person in and drops them on the
 * dashboard — with the old password still in place and nothing saying so. The reset was
 * therefore a login, and anyone who had genuinely forgotten their password was no better
 * off than before.
 *
 * Supabase's recovery link is what authorises this: verifying it establishes a session,
 * and updateUser() then changes the password for whoever that session belongs to. So the
 * page's only precondition is a live session — without one there is nothing to update,
 * and asking for a new password would be theatre.
 */
export default function NewPassword() {
  const t = useT();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ready, setReady] = useState(false);
  const [noSession, setNoSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The reset ends on an explicit confirmation, not a redirect. See handleSubmit.
  const [done, setDone] = useState(false);
  const [othersSignedOut, setOthersSignedOut] = useState(false);

  // The policy needs to know who this is, so it can refuse a password made of their own
  // name or address. The recovery session already carries both.
  const [identity, setIdentity] = useState<{ email?: string | null; fullName?: string | null }>({});

  // Resolved while they type, so the confirmation screen's button goes somewhere the
  // instant it is pressed rather than pausing on an RPC after the work is already done.
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return;
      setNoSession(!session);
      setIdentity({
        email:    session?.user?.email ?? null,
        fullName: (session?.user?.user_metadata?.full_name as string | undefined) ?? null,
      });
      setOnboardingComplete(!!session?.user?.user_metadata?.onboarding_complete);
      setReady(true);
      if (session) {
        const { data } = await supabase.rpc('is_admin');
        if (!cancelled) setIsAdminUser(data === true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // The same policy the signup form applies. This page used to check `length < 8` and
    // nothing else, which made a password reset the way around every rule on /auth/signup:
    // register with a compliant password, reset it, choose anything.
    if (!isPasswordAcceptable(password, identity)) {
      setError(t('auth.newPassword.tooShort'));
      return;
    }
    if (password !== confirm) { setError(t('auth.newPassword.mismatch')); return; }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) { setSubmitting(false); setError(updateError.message); return; }

    // Kill every OTHER session for this account.
    //
    // A password reset is what someone does when they think an account is compromised,
    // and Supabase leaves existing sessions signed in when the password changes — so
    // whoever was already in stayed in, on the old refresh token, indefinitely. Resetting
    // the password looked like it locked them out and did not.
    //
    // `scope: 'others'` deliberately: this browser has to survive, or the person who just
    // reset their password is thrown back to the login screen for their trouble. Failure
    // is non-fatal — the password IS changed by this point, and blocking on the cleanup
    // would leave them staring at an error for something that succeeded.
    try {
      await supabase.auth.signOut({ scope: 'others' });
      setOthersSignedOut(true);
    } catch {
      /* Best-effort. The new password already holds — we just do not claim otherwise. */
    }

    // ── Stop here. Do not redirect. ───────────────────────────────────────────────────
    //
    // Philip, on why adoption is stalling: the reset "is perceived as an automated login
    // rather than a reset tool". The mechanism was fixed weeks ago — this page exists,
    // and the password really does change — but the ENDING was still a silent redirect
    // onto the dashboard. Set a password, land signed in, told nothing. From the user's
    // side that is indistinguishable from the bug it replaced.
    //
    // A trust product cannot perform its most security-sensitive action invisibly. So the
    // flow ends on an explicit confirmation that names what happened, including the other
    // devices being signed out — which is the part that makes it read as a security
    // action rather than a convenience, and which nobody would otherwise know occurred.
    setSubmitting(false);
    setDone(true);
  }

  function handleContinue() {
    navigate(postAuthPath({
      isAdmin: isAdminUser,
      onboardingComplete: !!onboardingComplete,
    }), { replace: true });
  }

  if (!ready) {
    return <div className="text-center text-sm text-brand-mid-grey">{t('auth.newPassword.checking')}</div>;
  }

  if (done) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-light-grey">
          <ShieldCheck className="size-5 text-brand-near-black" />
        </div>
        <h1 className="font-sans text-2xl font-bold text-brand-near-black">
          {t('auth.newPassword.doneTitle')}
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey">{t('auth.newPassword.doneBody')}</p>

        {/* Only claimed when it actually happened — see the catch in handleSubmit. */}
        {othersSignedOut && (
          <p className="mx-auto mt-4 max-w-sm rounded-md bg-brand-light-grey px-3 py-2 text-xs leading-relaxed text-brand-near-black">
            {t('auth.newPassword.doneSessions')}
          </p>
        )}

        <Button onClick={handleContinue} className="mt-6 w-full">
          {t('auth.newPassword.doneCta')}
        </Button>
      </motion.div>
    );
  }

  if (noSession) {
    return (
      <div className="text-center">
        <h1 className="font-sans text-2xl font-bold text-brand-near-black">
          {t('auth.newPassword.expiredTitle')}
        </h1>
        <p className="text-sm text-brand-mid-grey mt-2">{t('auth.newPassword.expiredBody')}</p>
        <Link
          to="/auth/reset-password"
          className="inline-block mt-6 text-sm text-brand-near-black underline underline-offset-4"
        >
          {t('auth.newPassword.requestNew')}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-sans text-3xl font-bold text-brand-near-black">{t('auth.newPassword.title')}</h1>
      <p className="text-sm text-brand-mid-grey mt-2">{t('auth.newPassword.subtitle')}</p>

      <form onSubmit={handleSubmit} className="space-y-4 mt-8">
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('auth.newPassword.password')}</Label>
          <Input
            id="password" type="password" autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required
          />
          <PasswordStrength password={password} context={identity} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm">{t('auth.newPassword.confirm')}</Label>
          <Input
            id="confirm" type="password" autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)} required
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

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? t('auth.newPassword.submitting') : t('auth.newPassword.submit')}
        </Button>
      </form>
    </div>
  );
}
