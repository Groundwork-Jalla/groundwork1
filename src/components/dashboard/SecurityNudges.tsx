import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { KeyRound, ShieldAlert } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { googleWithoutPassword, secondFactorEnabled } from '@/lib/auth/account-security';
import { useT } from '@/lib/i18n';

// =========================================================
// Standing warnings at the top of the dashboard, until acted on.
//
// Not dismissible on purpose: both are about whether this person can keep their
// account, and a warning that goes away when clicked is one that gets clicked away.
// Each disappears by itself the moment the thing it asks for is done. Nothing renders
// until the checks have answered, so the page never flashes a warning it then retracts.
// =========================================================

export function SecurityNudges({ user }: { user: User | null }) {
  const t = useT();
  const [twoFactor, setTwoFactor] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    secondFactorEnabled(user.id)
      .then(v => { if (alive) setTwoFactor(v); })
      .catch(() => { if (alive) setTwoFactor(true); });   // unknown ≠ missing; stay quiet
    return () => { alive = false; };
  }, [user]);

  if (!user || twoFactor === null) return null;
  const needsPassword = googleWithoutPassword(user);
  if (twoFactor && !needsPassword) return null;

  return (
    <div className="flex flex-col gap-2">
      {needsPassword && (
        <Nudge
          icon={<KeyRound className="size-4" />}
          title={t('dashboard.security.passwordTitle')}
          body={t('dashboard.security.passwordBody')}
          to="/auth/new-password?reason=google"
          cta={t('dashboard.security.passwordCta')}
        />
      )}
      {!twoFactor && (
        <Nudge
          icon={<ShieldAlert className="size-4" />}
          title={t('dashboard.security.twoFactorTitle')}
          body={t('dashboard.security.twoFactorBody')}
          to="/profile?tab=account"
          cta={t('dashboard.security.twoFactorCta')}
        />
      )}
    </div>
  );
}

function Nudge({ icon, title, body, to, cta }: {
  icon: React.ReactNode; title: string; body: string; to: string; cta: string;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-state-held/40 bg-state-held/10 px-4 py-3 dark:bg-state-held/15">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-state-held/20 text-state-held">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-brand-near-black dark:text-white">{title}</p>
        <p className="text-xs text-brand-mid-grey">{body}</p>
      </div>
      <Link to={to} className="shrink-0 rounded-xl bg-brand-near-black px-3.5 py-2 text-xs font-semibold text-white hover:bg-black dark:bg-white dark:text-brand-near-black">
        {cta}
      </Link>
    </div>
  );
}
