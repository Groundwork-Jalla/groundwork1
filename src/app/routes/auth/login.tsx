import { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase/client";
import { acceptInvite } from "@/lib/supabase/invites";
import { postAuthPath } from "@/lib/auth/post-auth-path";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";

export default function Login() {
  const navigate        = useNavigate();
  const [searchParams]  = useSearchParams();
  const inviteToken     = searchParams.get("invite") ?? "";
  const redirectTo      = searchParams.get("redirect");
  const t               = useT();

  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [error,      setError]      = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleGoogleSignIn() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }

    // Process any pending invite (from URL param or localStorage)
    const token = inviteToken || localStorage.getItem("pendingInvite") || "";
    if (token) {
      localStorage.removeItem("pendingInvite");
      try {
        const projectId = await acceptInvite(token);
        navigate(`/projects/${projectId}`, { replace: true });
        return;
      } catch {
        // Invite may be invalid or already used — fall through to normal routing
      }
    }

    const { data: isAdmin } = await supabase.rpc('is_admin');
    navigate(postAuthPath({
      isAdmin: isAdmin === true,
      onboardingComplete: !!data.user?.user_metadata?.onboarding_complete,
      redirect: redirectTo,
    }), { replace: true });
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
          <Input
            id="password"
            type="password"
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
        <Link to="/auth/signup" className="text-brand-near-black underline underline-offset-4">
          {t('auth.login.signUp')}
        </Link>
      </p>
    </div>
  );
}
