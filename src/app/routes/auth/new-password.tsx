import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase/client";
import { postAuthPath } from "@/lib/auth/post-auth-path";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      setNoSession(!session);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) { setError(t('auth.newPassword.tooShort')); return; }
    if (password !== confirm) { setError(t('auth.newPassword.mismatch')); return; }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) { setSubmitting(false); setError(updateError.message); return; }

    // Already signed in as this user — send them where a fresh login would have.
    const { data: { session } } = await supabase.auth.getSession();
    const { data: isAdmin } = await supabase.rpc('is_admin');
    navigate(postAuthPath({
      isAdmin: isAdmin === true,
      onboardingComplete: !!session?.user?.user_metadata?.onboarding_complete,
    }), { replace: true });
  }

  if (!ready) {
    return <div className="text-center text-sm text-brand-mid-grey">{t('auth.newPassword.checking')}</div>;
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
          <p className="text-[11px] text-brand-mid-grey">{t('auth.newPassword.hint')}</p>
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
