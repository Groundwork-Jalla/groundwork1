import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, UserMinus } from 'lucide-react';
import {
  checkContractorRemoval, removeContractor, RemoveContractorFailed,
  type ContractorRemovalCheck,
} from '@/lib/supabase/admin-applications';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n';

// =========================================================
// Ending a contractor's standing (113).
//
// Deliberately not called Delete. The account survives — their approvals, site updates
// and audit rows all reference it, and the record of who built a house is the point. What
// ends is the role, their place on projects, and their directory entry.
//
// The confirmation says what will happen in numbers before it happens, because "remove
// this contractor" means something different for somebody on four live sites than for
// somebody who signed up last week and has done nothing.
// =========================================================

export function RemoveContractor({ userId, onRemoved }: { userId: string; onRemoved: () => void }) {
  const t = useT();
  const [check, setCheck] = useState<ContractorRemovalCheck | null | undefined>(undefined);
  const [reason, setReason] = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    checkContractorRemoval(userId)
      .then(c => { if (alive) setCheck(c); })
      .catch(() => { if (alive) setCheck(null); });
    return () => { alive = false; };
  }, [userId]);

  async function remove() {
    setBusy(true); setError(null);
    try {
      await removeContractor(userId, reason.trim() || undefined);
      onRemoved();
    } catch (err) {
      const code = err instanceof RemoveContractorFailed ? err.code : '';
      setError(
        code === 'money_in_flight' ? t('admin.removeContractor.errMoney')
        : code === 'self_removal'  ? t('admin.removeContractor.errSelf')
        : t('admin.removeContractor.errFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (check === undefined) {
    return <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" /></p>;
  }
  // 113 not applied, or not an admin — offering a button that cannot work is worse.
  if (check === null) return null;

  const blocked = check.moneyInFlight > 0;

  return (
    <div className="rounded-xl border border-brand-border-grey p-4 dark:border-[#2c2c2c]">
      <p className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white">
        <UserMinus className="size-4 shrink-0" aria-hidden />{t('admin.removeContractor.title')}
      </p>

      <ul className="mt-2 space-y-1 text-xs text-brand-mid-grey">
        <li>{t('admin.removeContractor.willProjects', { n: check.activeProjects })}</li>
        {check.primaryOn > 0 && <li>{t('admin.removeContractor.willPrimary', { n: check.primaryOn })}</li>}
        {check.hasListing && <li>{t('admin.removeContractor.willListing')}</li>}
        <li>{t('admin.removeContractor.willKeep')}</li>
      </ul>

      {blocked ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-brand-off-white px-3 py-2 text-xs text-brand-near-black dark:bg-[#111] dark:text-white">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('admin.removeContractor.blocked', { n: check.moneyInFlight })}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor="rcReason" className="text-xs">{t('admin.removeContractor.reason')}</Label>
            <Input id="rcReason" autoComplete="off" value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <Button onClick={remove} disabled={busy} variant="outline" className="h-8 text-xs">
            {busy ? <Loader2 className="size-4 animate-spin" /> : t('admin.removeContractor.confirm')}
          </Button>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-xs text-state-alert">{error}</p>}
    </div>
  );
}
