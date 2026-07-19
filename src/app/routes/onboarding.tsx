import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { trackEvent } from '@/lib/analytics';
import { ArrowRight, Loader2 } from 'lucide-react';

// ── Welcome screen ─────────────────────────────────────────

function WelcomeStep({
  firstName,
  loading,
  onStart,
}: {
  firstName: string;
  loading: boolean;
  onStart: () => void;
}) {
  return (
    <div className="w-full">
      <p className="text-brand-mid-grey text-xs font-medium tracking-widest uppercase mb-5">
        Account setup
      </p>

      <h1 className="font-sans text-3xl font-bold text-brand-near-black leading-tight mb-3">
        Welcome,{' '}
        <span className="block">{firstName}.</span>
      </h1>

      <p className="text-brand-mid-grey text-sm leading-relaxed mb-8">
        Let's get your account ready. It takes 30 seconds.
      </p>

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
            Get started
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
  const [loading, setLoading] = useState(false);

  const firstName =
    user?.user_metadata?.full_name?.split(' ')[0] ??
    user?.email?.split('@')[0] ??
    'there';

  useEffect(() => {
    if (user?.user_metadata?.onboarding_complete) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  async function handleStart() {
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

  return <WelcomeStep firstName={firstName} loading={loading} onStart={handleStart} />;
}
