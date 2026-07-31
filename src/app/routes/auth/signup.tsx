import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { motion } from "framer-motion";
import { Check, X, Mail, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT, type TKey } from "@/lib/i18n";

const checks: { key: TKey; test: (pw: string) => boolean }[] = [
  { key: "auth.signup.check8",      test: (pw: string) => pw.length >= 8 },
  { key: "auth.signup.checkUpper",  test: (pw: string) => /[A-Z]/.test(pw) },
  { key: "auth.signup.checkNumber", test: (pw: string) => /[0-9]/.test(pw) },
];

export default function Signup() {
  const [searchParams] = useSearchParams();
  const inviteToken    = searchParams.get("invite") ?? "";
  const inviteEmail    = searchParams.get("email")  ?? "";
  const isInviteFlow   = !!inviteToken;
  const t              = useT();

  const [fullName,        setFullName]        = useState("");
  const [email,           setEmail]           = useState(inviteEmail);
  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error,           setError]           = useState<string | null>(null);
  const [submitting,      setSubmitting]      = useState(false);
  const [submitted,       setSubmitted]       = useState(false);

  const passwordValid = checks.every((c) => c.test(password));

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
      setError(t('auth.signup.errRequirements'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth.signup.errMismatch'));
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
        data: { full_name: fullName },
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
        {isInviteFlow ? t('auth.signup.titleInvite') : t('auth.signup.title')}
      </h1>
      <p className="text-sm text-brand-mid-grey mt-2">
        {isInviteFlow ? t('auth.signup.subtitleInvite') : t('auth.signup.subtitle')}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4 mt-8">
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
          {password.length > 0 && (
            <ul className="mt-2 space-y-1">
              {checks.map((c) => {
                const passed = c.test(password);
                return (
                  <li
                    key={c.key}
                    className={`flex items-center gap-1.5 text-xs ${
                      passed ? "text-brand-near-black" : "text-brand-mid-grey"
                    }`}
                  >
                    {passed ? <Check className="size-3" /> : <X className="size-3" />}
                    {t(c.key)}
                  </li>
                );
              })}
            </ul>
          )}
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

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? t('auth.signup.submitting') : t('auth.signup.submit')}
        </Button>
      </form>

      {!isInviteFlow && (
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
