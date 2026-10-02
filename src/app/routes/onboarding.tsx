import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { trackEvent } from '@/lib/analytics';
import { useT } from '@/lib/i18n';
import { loadClientContact, saveClientPhone, syncPhoneToCrm } from '@/lib/supabase/client-contact';
import { DEFAULT_COUNTRY_CODE } from '@/lib/countries';
import { ArrowRight, Loader2 } from 'lucide-react';

// ── Welcome screen ─────────────────────────────────────────
//
// Also where a client's phone number is collected, when we do not already have one.
//
// Not everybody arrives with one: the signup form asks (102), but a Google account never
// went through that form, and every client who registered before it did has a NULL
// `profiles.phone`. Without a number the WhatsApp shortcut refuses `no_phone`, so the admin
// cannot reach them about their own build — which is the whole point of the channel.
//
// Asked here rather than on the profile page because this is the one screen every new client
// passes through, and it is the moment they are setting the account up anyway.

function WelcomeStep({
  firstName,
  loading,
  needPhone,
  phone,
  onPhone,
  problem,
  onStart,
}: {
  firstName: string;
  loading: boolean;
  needPhone: boolean;
  phone: string;
  onPhone: (v: string) => void;
  problem: string | null;
  onStart: () => void;
}) {
  const t = useT();

  return (
    <div className="w-full">
      <p className="text-brand-mid-grey text-xs font-medium tracking-widest uppercase mb-5">
        {t('onboarding.eyebrow')}
      </p>

      <h1 className="font-sans text-3xl font-bold text-brand-near-black leading-tight mb-3">
        {t('onboarding.welcome')}{' '}
        <span className="block">{firstName}.</span>
      </h1>

      <p className="text-brand-mid-grey text-sm leading-relaxed mb-8">
        {t('onboarding.body')}
      </p>

      {needPhone && (
        <div className="mb-6 space-y-1.5">
          <label htmlFor="onboarding-phone" className="text-sm font-medium text-brand-near-black">
            {t('onboarding.phone')}
          </label>
          <input
            id="onboarding-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+237 6 70 00 00 00"
            value={phone}
            onChange={e => onPhone(e.target.value)}
            className="w-full rounded-xl border border-brand-border-grey bg-white px-3.5 py-2.5 text-sm text-brand-near-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black"
          />
          <p className="text-xs text-brand-mid-grey">{t('onboarding.phoneHint')}</p>
          {problem && <p role="alert" className="text-xs text-state-alert">{problem}</p>}
        </div>
      )}

      <button
        type="button"
        onClick={onStart}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2.5 bg-brand-near-black text-white font-semibold text-sm px-7 py-3.5 rounded-xl hover:bg-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            {t('onboarding.start')}
            <ArrowRight className="size-4" />
          </>
        )}
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────

export default function OnboardingPage() {
  const { user }     = useAuth();
  const navigate     = useNavigate();
  const t            = useT();
  const [loading, setLoading] = useState(false);
  const [needPhone, setNeedPhone] = useState(false);
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const firstName =
    user?.user_metadata?.full_name?.split(' ')[0] ??
    user?.email?.split('@')[0] ??
    'there';

  useEffect(() => {
    if (user?.user_metadata?.onboarding_complete) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  // Only ask if we do not already have one. A client who gave their number at signup is not
  // asked again, and a legacy number sitting in `user_metadata` is offered as the starting
  // value rather than making them remember it.
  useEffect(() => {
    let alive = true;
    if (!user?.id) return;
    loadClientContact(user.id, user.user_metadata)
      .then(c => {
        if (!alive) return;
        setCountry(c.country);
        if (c.phone) { setNeedPhone(false); return; }
        setNeedPhone(true);
        if (c.legacyPhone) setPhone(c.legacyPhone);
      })
      // A failed read must not trap somebody on the welcome screen. Worst case they give
      // the number later, on their profile.
      .catch(() => { if (alive) setNeedPhone(false); });
    return () => { alive = false; };
  }, [user?.id, user?.user_metadata]);

  async function handleStart() {
    setProblem(null);
    if (!user?.id) return;

    if (needPhone) {
      const saved = await saveClientPhone(user.id, phone, country ?? DEFAULT_COUNTRY_CODE);
      if (!saved.ok) { setProblem(t('onboarding.phoneInvalid')); return; }
      // Mirroring to the CRM is deliberately not allowed to block onboarding — the number is
      // saved either way, and the sync is retried whenever the profile is next written.
      void syncPhoneToCrm();
    }

    setLoading(true);
    try {
      await supabase.auth.updateUser({
        data: { tier: 'self_verify', onboarding_complete: true },
      });
      trackEvent('tier_selected', { tier: 'self_verify' });
      navigate('/dashboard', { replace: true });
    } catch {
      setLoading(false);
    }
  }

  return (
    <WelcomeStep
      firstName={firstName}
      loading={loading}
      needPhone={needPhone}
      phone={phone}
      onPhone={v => { setPhone(v); setProblem(null); }}
      problem={problem}
      onStart={handleStart}
    />
  );
}
