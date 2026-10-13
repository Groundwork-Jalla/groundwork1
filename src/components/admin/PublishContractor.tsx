import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Store } from 'lucide-react';
import {
  listUnlistedContractors, publishContractor,
  type UnlistedContractor, type ContractorOrigin,
} from '@/lib/supabase/admin-applications';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT, type TKey } from '@/lib/i18n';

// =========================================================
// Contractors with an account that the directory does not show (111).
//
// The directory had exactly one writer — `admin_promote_application` — so only an
// accepted APPLICANT could ever appear in it. A contractor created at /admin/users/new,
// or one who signed themselves up as a partner, had a real account, the role, and no way
// into the list clients browse. That is why the directory reads empty.
//
// `origin` is shown because it is the thing staff actually need to decide on: an accepted
// applicant has been through a review, a self-registration has not. Publishing is a
// judgement, so the screen shows what the judgement rests on rather than hiding it.
// =========================================================

const ORIGIN_KEY: Record<ContractorOrigin, TKey> = {
  applied:            'admin.publishContractor.originApplied',
  onboarded_by_admin: 'admin.publishContractor.originOnboarded',
  self_registered:    'admin.publishContractor.originSelf',
};

export function PublishContractor() {
  const t = useT();
  const [rows, setRows]     = useState<UnlistedContractor[] | null>(null);
  const [chosen, setChosen] = useState<UnlistedContractor | null>(null);
  const [trade, setTrade]       = useState('');
  const [location, setLocation] = useState('');
  const [years, setYears]       = useState('');
  const [busy, setBusy]   = useState(false);
  const [done, setDone]   = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listUnlistedContractors()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function publish() {
    if (!chosen) return;
    setError(null);
    if (trade.trim().length < 2)    { setError(t('admin.publishContractor.errTrade')); return; }
    if (location.trim().length < 2) { setError(t('admin.publishContractor.errLocation')); return; }

    setBusy(true);
    try {
      await publishContractor({
        userId: chosen.userId,
        trade: trade.trim(),
        location: location.trim(),
        yearsExp: Number.parseInt(years, 10) || 0,
      });
      setDone(chosen.fullName);
      setChosen(null); setTrade(''); setLocation(''); setYears('');
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg.includes('not_contractor') ? t('admin.publishContractor.errNotContractor')
             : t('admin.publishContractor.errFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Nothing to publish is the healthy state, not an empty panel worth showing.
  if (rows !== null && rows.length === 0 && !done) return null;

  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white">
        <Store className="size-4 shrink-0" aria-hidden />{t('admin.publishContractor.title')}
      </h2>
      <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.publishContractor.body')}</p>

      {done && (
        <p className="mt-3 flex items-center gap-2 text-xs text-state-complete">
          <Check className="size-3.5" />{t('admin.publishContractor.published', { name: done })}
        </p>
      )}

      {rows === null ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-brand-mid-grey">
          <Loader2 className="size-3.5 animate-spin" />
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map(r => (
            <li key={r.userId} className="rounded-xl border border-brand-border-grey px-4 py-3 dark:border-[#2c2c2c]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-brand-near-black dark:text-white">{r.fullName}</p>
                  <p className="truncate text-xs text-brand-mid-grey">
                    {r.email} · {t(ORIGIN_KEY[r.origin])}
                  </p>
                </div>
                {chosen?.userId !== r.userId && (
                  <Button onClick={() => { setChosen(r); setDone(null); setError(null); }}
                    className="h-8 shrink-0 text-xs">
                    {t('admin.publishContractor.choose')}
                  </Button>
                )}
              </div>

              {chosen?.userId === r.userId && (
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_6rem_auto] sm:items-end">
                  <div className="space-y-1.5">
                    <Label htmlFor="pcTrade" className="text-xs">{t('admin.publishContractor.trade')}</Label>
                    <Input id="pcTrade" value={trade} onChange={e => setTrade(e.target.value)} autoComplete="off" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pcLoc" className="text-xs">{t('admin.publishContractor.location')}</Label>
                    <Input id="pcLoc" value={location} onChange={e => setLocation(e.target.value)} autoComplete="off" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pcYears" className="text-xs">{t('admin.publishContractor.years')}</Label>
                    <Input id="pcYears" type="number" min={0} value={years}
                      onChange={e => setYears(e.target.value)} autoComplete="off" />
                  </div>
                  <Button onClick={publish} disabled={busy} className="h-9 text-xs">
                    {busy ? <Loader2 className="size-4 animate-spin" /> : t('admin.publishContractor.publish')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="mt-3 text-xs text-state-alert">{error}</p>}
    </section>
  );
}
