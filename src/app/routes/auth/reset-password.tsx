import { useState } from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
import { Mail } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";
import { rememberEmailRequest } from "@/lib/auth/last-email-request";

export default function ResetPassword() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    // `?flow=recovery` is load-bearing, not decoration. Supabase's PKCE reply carries a
    // `?code=` and NO `type` parameter, so /auth/callback had nothing to distinguish a
    // password reset from an ordinary sign-in: it established the session and routed to
    // onboarding, leaving the old password in place. "Forgot password?" silently did
    // nothing. Found in beta testing, 25 Aug 2026.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?flow=recovery`,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    // So /auth/callback can offer a real resend if this link is spent or opened on
    // another device, instead of guessing the flow and sending them to signup.
    rememberEmailRequest('recovery', email);
    setSent(true);
  }

  if (sent) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-light-grey">
          <Mail className="size-5 text-brand-near-black" />
        </div>
        <h1 className="font-sans text-2xl font-bold text-brand-near-black">{t('auth.reset.sentTitle')}</h1>
        <p className="text-sm text-brand-mid-grey mt-2">
          {t('auth.reset.sentBody', { email })}
        </p>
        <Link to="/auth/login" className="inline-block mt-6 text-sm text-brand-near-black underline underline-offset-4">
          {t('auth.reset.backToLogin')}
        </Link>
      </motion.div>
    );
  }

  return (
    <div>
      <h1 className="font-sans text-3xl font-bold text-brand-near-black">{t('auth.reset.title')}</h1>
      <p className="text-sm text-brand-mid-grey mt-2">{t('auth.reset.subtitle')}</p>

      <form onSubmit={handleSubmit} className="space-y-4 mt-8">
        <div className="space-y-1.5">
          <Label htmlFor="email">{t('auth.reset.email')}</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
          {submitting ? t('auth.reset.submitting') : t('auth.reset.submit')}
        </Button>
      </form>

      <p className="text-center text-sm text-brand-mid-grey mt-8">
        <Link to="/auth/login" className="text-brand-near-black underline underline-offset-4">
          {t('auth.reset.backToLogin')}
        </Link>
      </p>
    </div>
  );
}
