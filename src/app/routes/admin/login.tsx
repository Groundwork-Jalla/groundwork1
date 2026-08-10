import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { ShieldCheck, ArrowLeft, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { GroundworkLogo } from '@/components/ui/GroundworkLogo';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { useT } from '@/lib/i18n';

// =========================================================
// /admin/login — the staff entrance.
//
// Deliberately NOT inside the admin layout: that layout redirects anyone without a
// session here, so putting the login behind it would loop forever. It is also not
// inside _auth-layout, because the point is that it does not look like the client
// login — an admin arriving here should be in no doubt they are in the back office.
//
// This is NOT a security boundary and must not be treated as one. Anyone can reach
// this URL and sign in with any account; what actually protects the admin area is
// `is_admin()` and the RLS policies behind it. What this page adds is an honest
// failure: sign in with a non-admin account and it says so and signs you back out,
// rather than silently dropping you on the client dashboard wondering what happened.
// =========================================================

export default function AdminLogin() {
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo     = searchParams.get('redirect');
  const t              = useT();
  const { session, isAdmin, adminChecked } = useAuth();

  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [error, setError]         = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in as an admin — skip the form entirely.
  useEffect(() => {
    if (session && adminChecked && isAdmin) {
      navigate(redirectTo && redirectTo.startsWith('/admin') ? redirectTo : '/admin', { replace: true });
    }
  }, [session, adminChecked, isAdmin, redirectTo, navigate]);

  /**
   * `is_admin()` is re-read here rather than trusted from context: the context value
   * is resolved for the *previous* session and has not refreshed yet at this point.
   */
  async function completeSignIn() {
    const { data: adminOk } = await supabase.rpc('is_admin');
    if (adminOk === true) {
      navigate(redirectTo && redirectTo.startsWith('/admin') ? redirectTo : '/admin', { replace: true });
      return;
    }
    // Signed in successfully, but not staff. Do not leave them holding a session they
    // did not ask for on a page that cannot use it.
    await supabase.auth.signOut();
    setError(t('adminAuth.notAdmin'));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setSubmitting(false);
      setError(signInError.message);
      return;
    }

    await completeSignIn();
    setSubmitting(false);
  }

  async function handleGoogle() {
    // Returns through /auth/callback, which routes admins to /admin on its own.
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?redirect=/admin` },
    });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-brand-near-black text-white">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <GroundworkLogo variant="light" size="md" linkTo="/" />
        <LanguageToggle compact />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="w-full max-w-sm"
        >
          <div className="mb-2 flex items-center gap-2 text-white/45">
            <ShieldCheck className="size-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-[0.14em]">
              {t('adminAuth.eyebrow')}
            </span>
          </div>

          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {t('adminAuth.title')}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-white/50">
            {t('adminAuth.subtitle')}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="admin-email" className="block text-xs font-medium text-white/70">
                {t('auth.login.email')}
              </label>
              <input
                id="admin-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-white/35 focus:bg-white/[0.07]"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="admin-password" className="block text-xs font-medium text-white/70">
                  {t('auth.login.password')}
                </label>
                <Link to="/auth/reset-password" className="text-xs text-white/40 transition-colors hover:text-white/70">
                  {t('auth.login.forgot')}
                </Link>
              </div>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-white/35 focus:bg-white/[0.07]"
              />
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                role="alert"
                className="rounded-xl border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white/90"
              >
                {error}
              </motion.p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-semibold text-brand-near-black transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? t('auth.login.submitting') : t('adminAuth.submit')}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/12" />
            <span className="text-[11px] text-white/35">{t('common.or')}</span>
            <div className="h-px flex-1 bg-white/12" />
          </div>

          <button
            type="button"
            onClick={handleGoogle}
            className="w-full rounded-xl border border-white/20 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.06]"
          >
            {t('auth.login.google')}
          </button>

          {/* No sign-up link, by design: staff accounts are granted in user_roles, never self-served. */}
          <p className="mt-8 text-center text-xs text-white/35">{t('adminAuth.noSelfServe')}</p>

          <Link
            to="/"
            className="mt-6 flex items-center justify-center gap-1.5 text-xs text-white/40 transition-colors hover:text-white/70"
          >
            <ArrowLeft className="size-3" /> {t('adminAuth.backToSite')}
          </Link>
        </motion.div>
      </main>
    </div>
  );
}
