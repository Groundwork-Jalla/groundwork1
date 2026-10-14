import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Store, Trash2, UserMinus } from 'lucide-react';
import {
  listAllContractors, publishContractor,
  checkContractorRemoval, removeContractor, deleteContractorAccount, RemoveContractorFailed,
  type AnyContractor, type ContractorRemovalCheck,
} from '@/lib/supabase/admin-applications';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT, type TKey } from '@/lib/i18n';

// =========================================================
// The contractor roster (111 publish, 113 remove).
//
// One list of everybody who is a contractor at all — the role or an accepted assignment —
// rather than only the ones missing from the directory. Two things an admin needs to do
// from here, and both have to reach people in either state:
//
//   · PUBLISH, for anybody the directory does not show. Until 111 that was impossible
//     for an admin-onboarded contractor, because the only writer took an application id.
//   · REMOVE, for anybody at all. Deleting a directory entry only hid them from clients;
//     they kept the role, their projects and /work. 113 ends the standing itself.
//
// `origin` is shown because it is what the judgement rests on: an accepted applicant has
// been reviewed, a self-registration has not.
// =========================================================

const ORIGIN_KEY: Record<AnyContractor['origin'], TKey> = {
  applied:            'admin.publishContractor.originApplied',
  onboarded_by_admin: 'admin.publishContractor.originOnboarded',
  self_registered:    'admin.publishContractor.originSelf',
  invited_to_project: 'admin.publishContractor.originInvited',
};

export function PublishContractor() {
  const t = useT();
  const [rows, setRows] = useState<AnyContractor[] | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [removing, setRemoving]     = useState<string | null>(null);
  const [check, setCheck]   = useState<ContractorRemovalCheck | null>(null);
  const [trade, setTrade]       = useState('');
  const [location, setLocation] = useState('');
  const [reason, setReason]     = useState('');
  const [busy, setBusy]   = useState(false);
  /** Which button is being confirmed: end their access, or delete the account. */
  const [mode, setMode]   = useState<'remove' | 'delete'>('remove');
  const [done, setDone]   = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listAllContractors().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  function reset() {
    setPublishing(null); setRemoving(null); setCheck(null);
    setTrade(''); setLocation(''); setReason(''); setError(null);
  }

  async function doPublish(r: AnyContractor) {
    setError(null);
    if (trade.trim().length < 2)    { setError(t('admin.publishContractor.errTrade')); return; }
    if (location.trim().length < 2) { setError(t('admin.publishContractor.errLocation')); return; }
    setBusy(true);
    try {
      await publishContractor({ userId: r.userId, trade: trade.trim(), location: location.trim() });
      setDone(t('admin.publishContractor.published', { name: r.fullName }));
      reset(); load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg.includes('not_contractor') ? t('admin.publishContractor.errNotContractor')
             : t('admin.publishContractor.errFailed'));
    } finally { setBusy(false); }
  }

  // The confirmation says what will happen in numbers before it happens: "remove this
  // contractor" means something very different for somebody on four live sites.
  async function startRemove(r: AnyContractor, which: 'remove' | 'delete') {
    reset(); setDone(null); setRemoving(r.userId); setMode(which);
    setCheck(await checkContractorRemoval(r.userId).catch(() => null));
  }

  // Deleting the ACCOUNT, not just their standing. Irreversible, and the database
  // refuses it for anybody whose work is referenced by somebody else's project — so the
  // common outcome is either "gone" or a clear reason why not.
  async function doDelete(r: AnyContractor) {
    setBusy(true); setError(null);
    try {
      await deleteContractorAccount(r.userId, reason.trim() || undefined);
      setDone(t('admin.removeContractor.deleted', { name: r.fullName }));
      reset(); load();
    } catch (err) {
      const code = err instanceof RemoveContractorFailed ? err.code : '';
      setError(code === 'has_history'      ? t('admin.removeContractor.errHistory')
             : code === 'money_in_flight'  ? t('admin.removeContractor.errMoney')
             : code === 'is_admin_account' ? t('admin.removeContractor.errStaff')
             : code === 'self_removal'     ? t('admin.removeContractor.errSelf')
             : t('admin.removeContractor.errFailed'));
    } finally { setBusy(false); }
  }

  async function doRemove(r: AnyContractor) {
    setBusy(true); setError(null);
    try {
      await removeContractor(r.userId, reason.trim() || undefined);
      setDone(t('admin.removeContractor.removed', { name: r.fullName }));
      reset(); load();
    } catch (err) {
      const code = err instanceof RemoveContractorFailed ? err.code : '';
      setError(code === 'money_in_flight' ? t('admin.removeContractor.errMoney')
             : code === 'self_removal'    ? t('admin.removeContractor.errSelf')
             : t('admin.removeContractor.errFailed'));
    } finally { setBusy(false); }
  }

  if (rows !== null && rows.length === 0 && !done) return null;

  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white">
        <Store className="size-4 shrink-0" aria-hidden />{t('admin.publishContractor.title')}
      </h2>
      <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.publishContractor.body')}</p>

      {done && <p className="mt-3 flex items-center gap-2 text-xs text-state-complete"><Check className="size-3.5" />{done}</p>}

      {rows === null ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" /></p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map(r => (
            <li key={r.userId} className="rounded-xl border border-brand-border-grey px-4 py-3 dark:border-[#2c2c2c]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-brand-near-black dark:text-white">{r.fullName}</p>
                  <p className="truncate text-xs text-brand-mid-grey">
                    {r.email} · {t(ORIGIN_KEY[r.origin])}
                    {r.listed
                      ? ` · ${t(r.listingActive ? 'admin.publishContractor.inDirectory' : 'admin.publishContractor.takenDown')}`
                      : ` · ${t('admin.publishContractor.notListed')}`}
                  </p>
                </div>

                {publishing !== r.userId && removing !== r.userId && (
                  <div className="flex shrink-0 items-center gap-2">
                    {!r.listingActive && (
                      <Button onClick={() => { reset(); setDone(null); setPublishing(r.userId); }} className="h-8 text-xs">
                        {t('admin.publishContractor.choose')}
                      </Button>
                    )}
                    {/* Reaches everybody, listed or not — which is the whole point. */}
                    <Button variant="outline" onClick={() => startRemove(r, 'remove')} className="h-8 gap-1.5 text-xs">
                      <UserMinus className="size-3.5" aria-hidden />{t('admin.removeContractor.confirm')}
                    </Button>
                    {/* Beside it, the harder one. Separate because they are different
                        acts: one ends access, the other ends the account. */}
                    <Button variant="outline" onClick={() => startRemove(r, 'delete')}
                      className="h-8 gap-1.5 text-xs text-state-alert">
                      <Trash2 className="size-3.5" aria-hidden />{t('admin.removeContractor.deleteCta')}
                    </Button>
                  </div>
                )}
              </div>

              {publishing === r.userId && (
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <div className="space-y-1.5">
                    <Label htmlFor="pcTrade" className="text-xs">{t('admin.publishContractor.trade')}</Label>
                    <Input id="pcTrade" value={trade} onChange={e => setTrade(e.target.value)} autoComplete="off" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pcLoc" className="text-xs">{t('admin.publishContractor.location')}</Label>
                    <Input id="pcLoc" value={location} onChange={e => setLocation(e.target.value)} autoComplete="off" />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => doPublish(r)} disabled={busy} className="h-9 text-xs">
                      {busy ? <Loader2 className="size-4 animate-spin" /> : t('admin.publishContractor.publish')}
                    </Button>
                    <button type="button" onClick={reset} className="text-xs text-brand-mid-grey underline underline-offset-4">
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}

              {removing === r.userId && (
                <div className="mt-3 space-y-2">
                  {check && (
                    <ul className="space-y-1 text-xs text-brand-mid-grey">
                      <li>{t('admin.removeContractor.willProjects', { n: check.activeProjects })}</li>
                      {check.primaryOn > 0 && <li>{t('admin.removeContractor.willPrimary', { n: check.primaryOn })}</li>}
                      {check.hasListing && <li>{t('admin.removeContractor.willListing')}</li>}
                      {/* The two acts promise opposite things, so they say so. */}
                      <li className={mode === 'delete' ? 'text-state-alert' : undefined}>
                        {t(mode === 'delete' ? 'admin.removeContractor.willDelete' : 'admin.removeContractor.willKeep')}
                      </li>
                    </ul>
                  )}

                  {check && check.moneyInFlight > 0 ? (
                    <p className="rounded-lg bg-brand-off-white px-3 py-2 text-xs text-brand-near-black dark:bg-[#111] dark:text-white">
                      {t('admin.removeContractor.blocked', { n: check.moneyInFlight })}
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                      <div className="space-y-1.5">
                        <Label htmlFor="rcReason" className="text-xs">{t('admin.removeContractor.reason')}</Label>
                        <Input id="rcReason" value={reason} onChange={e => setReason(e.target.value)} autoComplete="off" />
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" disabled={busy} className="h-9 text-xs"
                          onClick={() => (mode === 'delete' ? doDelete(r) : doRemove(r))}>
                          {busy ? <Loader2 className="size-4 animate-spin" />
                            : t(mode === 'delete' ? 'admin.removeContractor.deleteConfirm' : 'admin.removeContractor.confirm')}
                        </Button>
                        <button type="button" onClick={reset} className="text-xs text-brand-mid-grey underline underline-offset-4">
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
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
