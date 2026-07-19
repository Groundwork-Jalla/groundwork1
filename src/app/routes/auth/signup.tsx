import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { motion } from "framer-motion";
import { Check, X, Mail, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const checks = [
  { label: "At least 8 characters", test: (pw: string) => pw.length >= 8 },
  { label: "One uppercase letter",  test: (pw: string) => /[A-Z]/.test(pw) },
  { label: "One number",            test: (pw: string) => /[0-9]/.test(pw) },
];

export default function Signup() {
  const [searchParams] = useSearchParams();
  const inviteToken    = searchParams.get("invite") ?? "";
  const inviteEmail    = searchParams.get("email")  ?? "";
  const isInviteFlow   = !!inviteToken;

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
      setError("Password doesn't meet the requirements below.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
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
          : "Sign up failed. Please try again or contact support.",
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
        <h1 className="font-sans text-2xl font-bold text-brand-near-black">Check your email</h1>
        <p className="text-sm text-brand-mid-grey mt-2">
          We sent a confirmation link to{" "}
          <span className="text-brand-near-black">{email}</span>. Click it to activate your account.
        </p>
        {isInviteFlow && (
          <p className="text-xs text-brand-mid-grey mt-3 leading-relaxed">
            After confirming, you'll be taken directly to your assigned project.
          </p>
        )}
        <Link
          to="/auth/login"
          className="inline-block mt-6 text-sm text-brand-near-black underline underline-offset-4"
        >
          Back to login
        </Link>
      </motion.div>
    );
  }

  return (
    <div>
      <h1 className="font-sans text-3xl font-bold text-brand-near-black">
        {isInviteFlow ? "Create your account" : "Sign up"}
      </h1>
      <p className="text-sm text-brand-mid-grey mt-2">
        {isInviteFlow
          ? "Set a password to accept your project invite."
          : "Join the diaspora builders who never lost track of their money."}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4 mt-8">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Full name</Label>
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
          <Label htmlFor="email">Email</Label>
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
          <Label htmlFor="password">Password</Label>
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
                    key={c.label}
                    className={`flex items-center gap-1.5 text-xs ${
                      passed ? "text-brand-near-black" : "text-brand-mid-grey"
                    }`}
                  >
                    {passed ? <Check className="size-3" /> : <X className="size-3" />}
                    {c.label}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm password</Label>
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
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      {!isInviteFlow && (
        <>
          <div className="flex items-center gap-3 my-6">
            <div className="h-px flex-1 bg-brand-border-grey" />
            <span className="text-xs text-brand-mid-grey">OR</span>
            <div className="h-px flex-1 bg-brand-border-grey" />
          </div>
          <Button variant="outline" className="w-full" onClick={handleGoogleSignUp}>
            Continue with Google
          </Button>
        </>
      )}

      <p className="text-center text-sm text-brand-mid-grey mt-8">
        Already have an account?{" "}
        <Link
          to={
            isInviteFlow
              ? `/auth/login?invite=${encodeURIComponent(inviteToken)}`
              : "/auth/login"
          }
          className="text-brand-near-black underline underline-offset-4"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}
