import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { motion } from "framer-motion";
import { Mail, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordStrength } from "@/components/ui/PasswordStrength";
import { isPasswordAcceptable } from "@/lib/auth/password-policy";
import { useT } from "@/lib/i18n";
import { normalisePhone, isE164 } from "@/lib/phone";
import { DEFAULT_COUNTRY_CODE } from "@/lib/countries";
import { rememberEmailRequest } from "@/lib/auth/last-email-request";
import { signupAccountType, signupMetadata, signupGoesToApplication, CONTRACTOR_APPLY_PATH } from "@/lib/auth/signup-account";

export default function Signup() {
  const [searchParams, setSearchParams] = useSearchParams();
  const inviteToken    = searchParams.get("invite") ?? "";
  const inviteEmail    = searchParams.get("email")  ?? "";
  const isInviteFlow   = !!inviteToken;
  const accountType = signupAccountType(searchParams);
  const isContractorSignup = accountType === 'contractor';
  // The radio does not make an account: contractors are reviewed first (100).
  const sendToApplication  = signupGoesToApplication(searchParams);
  const t              = useT();

  const [fullName,        setFullName]        = useState("");
  const [phone,           setPhone]           = useState("");
  const [email,           setEmail]           = useState(inviteEmail);
  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error,           setError]           = useState<string | null>(null);
  const [submitting,      setSubmitting]      = useState(false);
  const [submitted,       setSubmitted]       = useState(false);

  // Resend state. Confirmation mail is sent by Supabase Auth (not our Resend
  // templates), so when it goes missing the user has no other way to recover —
  // without this they are simply stuck on the "check your email" screen.
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [cooldown,  setCooldown]  = useState(0);

  // The rules live in lib/auth/password-policy.ts, shared with /auth/new-password —
  // which used to require only 8 characters, making the reset flow a way around this form.
  const passwordContext = { email, fullName };
  const passwordValid = isPasswordAcceptable(password, passwordContext);

  // Supabase rate-limits confirmation mail hard. A local cooldown makes that
  // visible up front rather than letting someone hammer the button into an
  // opaque server-side error.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function handleResend() {
    setResending(true);
    setResendMsg(null);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setResending(false);
    setResendMsg(error ? t('auth.signup.resendErr') : t('auth.signup.resentOk'));
    if (!error) setCooldown(60);
  }

  async function handleGoogleSignUp() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!passwordValid) {
      setError(t('auth.password.errRequirements'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth.password.errMismatch'));
      return;
    }

    // Normalised here, where the typed value still is. A number that cannot be placed is
    // refused now rather than stored as provider-ready data that is not — `handle_new_user`
    // would drop it silently and the person would believe we had it.
    const canonicalPhone = normalisePhone(phone, DEFAULT_COUNTRY_CODE);
    if (!isE164(canonicalPhone)) {
      setError(t('auth.signup.phoneInvalid'));
      return;
    }

    // Persist invite token across the email-confirmation tab switch
    if (inviteToken) {
      localStorage.setItem("pendingInvite", inviteToken);
    }

    setSubmitting(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: signupMetadata(fullName, canonicalPhone),
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setSubmitting(false);

    if (error) {
      setError(
        error.message && error.message !== "{}"
          ? error.message
          : t('auth.signup.errGeneric'),
      );
      return;
    }

    // Instant sign-in path (email confirmation disabled)
    if (data.session) {
      window.location.href = "/auth/callback";
      return;
    }

    // So /auth/callback can resend to this address if the link is spent, rather than
    // sending them somewhere generic.
    rememberEmailRequest('signup', email);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-light-grey">
          <Mail className="size-5 text-brand-near-black" />
        </div>
        <h1 className="font-sans text-2xl font-bold text-brand-near-black">{t('auth.signup.checkEmailTitle')}</h1>
        <p className="text-sm text-brand-mid-grey mt-2">
          {t('auth.signup.checkEmailBody', { email })}
        </p>
        {isInviteFlow && (
          <p className="text-xs text-brand-mid-grey mt-3 leading-relaxed">
            {t('auth.signup.checkEmailInvite')}
          </p>
        )}

        {/* Recovery path for a confirmation mail that never arrived */}
        <p className="text-xs text-brand-mid-grey mt-5 leading-relaxed">
          {t('auth.signup.noEmailPrompt')}{' '}
          {cooldown > 0 ? (
            <span className="text-brand-soft-grey">
              {t('auth.signup.resendWait', { s: cooldown })}
            </span>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              className="text-brand-near-black underline underline-offset-4 disabled:opacity-50"
            >
              {resending ? t('auth.signup.resending') : t('auth.signup.resendCta')}
            </button>
          )}
        </p>
        {resendMsg && (
          <p className="text-xs text-brand-mid-grey mt-2 leading-relaxed">{resendMsg}</p>
        )}

        <Link
          to="/auth/login"
          className="inline-block mt-6 text-sm text-brand-near-black underline underline-offset-4"
        >
          {t('auth.signup.backToLogin')}
        </Link>
      </motion.div>
    );
  }

  return (
    <div>
      <h1 className="font-sans text-3xl font-bold text-brand-near-black">
        {isInviteFlow ? t('auth.signup.titleInvite') : isContractorSignup ? t('auth.signup.titleContractor') : t('auth.signup.title')}
      </h1>
      <p className="text-sm text-brand-mid-grey mt-2">
        {isInviteFlow ? t('auth.signup.subtitleInvite') : isContractorSignup ? t('auth.signup.subtitleContractor') : t('auth.signup.subtitle')}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4 mt-8">
        {!isInviteFlow && (
          <fieldset disabled={submitting} className="space-y-2">
            <legend className="text-sm font-medium">{t('auth.signup.accountType')}</legend>
            <div className="flex flex-wrap gap-4">
              {(['homeowner', 'contractor'] as const).map(type => (
                <label key={type} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="accountType" value={type} checked={accountType === type}
                    onChange={() => {
                      const next = new URLSearchParams(searchParams);
                      next.set('role', type);
                      setSearchParams(next, { replace: true });
                      setError(null);
                    }} />
                  {t(type === 'contractor' ? 'auth.signup.contractor' : 'auth.signup.homeowner')}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {sendToApplication ? (
          /* Groundwork reviews contractors before they hold an account (100). Offering a
             signup form here would hand them one with no standing — which looks like
             success and is not. The application is the real next step. */
          <div className="rounded-xl border border-brand-border-grey bg-brand-off-white p-4 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <p className="text-sm text-brand-near-black dark:text-white">{t('auth.signup.contractorReviewed')}</p>
            <p className="mt-1.5 text-sm text-brand-mid-grey">{t('auth.signup.contractorReviewedBody')}</p>
            <Link
              to={CONTRACTOR_APPLY_PATH}
              className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-brand-near-black px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-brand-near-black"
            >
              {t('auth.signup.contractorApplyCta')}
            </Link>
          </div>
        ) : (
        <>
        <div className="space-y-1.5">
          <Label htmlFor="fullName">{t('auth.signup.fullName')}</Label>
          <Input
            id="fullName"
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>

        {/* How Groundwork reaches them on WhatsApp — the channel the product actually uses
            to tell a contractor, verifier or client that something needs them. Stored
            canonical or not at all (102). */}
        <div className="space-y-1.5">
          <Label htmlFor="phone">{t('auth.signup.phone')}</Label>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+237 6 70 00 00 00"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setError(null); }}
            required
          />
          <p className="text-xs text-brand-mid-grey">{t('auth.signup.phoneHint')}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">{t('auth.signup.email')}</Label>
          {isInviteFlow ? (
            <div className="relative">
              <Input
                id="email"
                type="email"
                value={email}
                readOnly
                className="pr-8 bg-brand-off-white text-brand-mid-grey cursor-default"
              />
              <Lock className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-brand-mid-grey" />
            </div>
          ) : (
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">{t('auth.signup.password')}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <PasswordStrength password={password} context={passwordContext} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">{t('auth.signup.confirmPassword')}</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
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

        </>
        )}
        {!sendToApplication && (
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? t('auth.signup.submitting') : t('auth.signup.submit')}
        </Button>
        )}
      </form>

      {!isContractorSignup && !sendToApplication && (
        <>
          <div className="flex items-center gap-3 my-6">
            <div className="h-px flex-1 bg-brand-border-grey" />
            <span className="text-xs text-brand-mid-grey">{t('common.or')}</span>
            <div className="h-px flex-1 bg-brand-border-grey" />
          </div>
          <Button variant="outline" className="w-full" onClick={handleGoogleSignUp}>
            {t('auth.signup.google')}
          </Button>
        </>
      )}

      <p className="text-center text-sm text-brand-mid-grey mt-8">
        {t('auth.signup.haveAccount')}{" "}
        <Link
          to={
            isInviteFlow
              ? `/auth/login?invite=${encodeURIComponent(inviteToken)}`
              : "/auth/login"
          }
          className="text-brand-near-black underline underline-offset-4"
        >
          {t('auth.signup.logIn')}
        </Link>
      </p>
    </div>
  );
}
