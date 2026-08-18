import { useEffect, useState } from 'react';
import UpgradeScreen from '@/components/payments/UpgradeScreen';
import { useAuth } from '@/contexts/AuthContext';
import { getSubscription } from '@/lib/payments/subscription';
import type { ProjectTier } from '@/types/project';

/**
 * UpgradeScreen has always known how to mark the plan you are on — it disables that
 * card's button and labels it "Current plan" — but this route never told it which one,
 * so every visitor saw three equally live options and no indication of where they
 * already stood. On a page whose whole job is "should I move?", that is the one fact
 * it has to state.
 *
 * Left undefined until the read returns, rather than guessed at `self_verify`: marking
 * the free plan current and then correcting it a moment later is worse than a brief
 * moment with nothing marked.
 */
export default function UpgradePage() {
  const { user } = useAuth();
  const [currentTier, setCurrentTier] = useState<ProjectTier | undefined>(undefined);

  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    let cancelled = false;
    void getSubscription(uid).then(sub => {
      if (!cancelled) setCurrentTier(sub.tier);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <UpgradeScreen currentTier={currentTier} />
    </div>
  );
}
