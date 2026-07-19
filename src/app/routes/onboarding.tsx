import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { trackEvent } from '@/lib/analytics';
import { motion } from 'framer-motion';
import { GroundworkLogo } from '@/components/ui/GroundworkLogo';
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
    <div className="min-h-screen bg-brand-near-black flex flex-col relative overflow-hidden">
      {/* Faint animated city skyline */}
      <motion.svg
        viewBox="0 0 800 120"
        className="absolute bottom-0 left-0 w-full pointer-events-none select-none"
        aria-hidden="true"
        animate={{ x: [0, -30, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        style={{ opacity: 0.06 }}
      >
        <rect x="0"   y="60"  width="50"  height="60" fill="white" />
        <rect x="55"  y="40"  width="30"  height="80" fill="white" />
        <rect x="90"  y="20"  width="40"  height="100" fill="white" />
        <rect x="135" y="50"  width="25"  height="70" fill="white" />
        <rect x="165" y="30"  width="55"  height="90" fill="white" />
        <rect x="225" y="55"  width="35"  height="65" fill="white" />
        <rect x="265" y="10"  width="30"  height="110" fill="white" />
        <rect x="300" y="45"  width="50"  height="75" fill="white" />
        <rect x="355" y="25"  width="40"  height="95" fill="white" />
        <rect x="400" y="60"  width="28"  height="60" fill="white" />
        <rect x="433" y="35"  width="45"  height="85" fill="white" />
        <rect x="483" y="50"  width="30"  height="70" fill="white" />
        <rect x="518" y="15"  width="35"  height="105" fill="white" />
        <rect x="558" y="42"  width="50"  height="78" fill="white" />
        <rect x="613" y="28"  width="28"  height="92" fill="white" />
        <rect x="646" y="55"  width="40"  height="65" fill="white" />
        <rect x="691" y="18"  width="35"  height="102" fill="white" />
        <rect x="731" y="45"  width="30"  height="75" fill="white" />
        <rect x="766" y="32"  width="34"  height="88" fill="white" />
      </motion.svg>

      <header className="px-8 py-6 relative z-10">
        <GroundworkLogo variant="light" size="lg" />
      </header>

      <div className="flex-1 flex items-center justify-center px-6 relative z-10">
        <div className="max-w-lg w-full text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <p className="text-brand-mid-grey text-xs font-medium tracking-widest uppercase mb-6">
              Account setup
            </p>

            <h1 className="font-sans text-4xl sm:text-5xl font-bold text-white leading-[1.08] mb-4">
              Welcome,{' '}
              <span className="block">{firstName}</span>
            </h1>

            <p className="text-brand-mid-grey text-base sm:text-lg leading-relaxed mb-10">
              Let's get your account ready.{' '}
              <span className="text-brand-soft-grey">It takes 30 seconds.</span>
            </p>

            <button
              type="button"
              onClick={onStart}
              disabled={loading}
              className="inline-flex items-center gap-2.5 bg-white text-brand-near-black font-semibold text-sm px-7 py-3.5 rounded-xl hover:bg-brand-off-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-near-black disabled:opacity-60"
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
          </motion.div>
        </div>
      </div>

      <div className="h-16" />
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
