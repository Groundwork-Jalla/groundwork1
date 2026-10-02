import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Clock } from 'lucide-react';
import {
  fetchPayoutDestinationsFor, verifyPayoutDestination,
} from '@/lib/supabase/payout-destinations';
import { maskDestination, type PayoutDestination } from '@/lib/payments/payout-destination';
import { bankName } from '@/lib/payments/banks';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n';

// =========================================================
// The staff check on where a contractor is paid (099, 101).
//
// This is the ONE act that turns numbers on file into permission to send money to them, and
// it is deliberately a human one: `add_payout_destination` has no path to `verified`, so no
// contractor can mark their own details checked.
//
// It lives here, on the project's Team card, because this is where the contractor's ACCOUNT
// is known. The /admin/contractors directory (033) has no key to any account — 099's header
// says so — and guessing the join from an email address is what this panel exists to avoid.
//
// Management, not execution: the admin checks and records. The contractor still owns the
// details and is the only one who can add or retire them, on their own surface.
// =========================================================

export function ContractorPayoutCheck({ contractorUserId, onNotice }: {
  contractorUserId: string;
  onNotice: (message: string) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<PayoutDestination[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // RLS may refuse the read outright if 099 is not applied; that is "unknown", not "none".
  const [available, setAvailable] = useState(true);

  async function reload() {
    try { setRows(await fetchPayoutDestinationsFor(contractorUserId)); setAvailable(true); }
    catch { setRows([]); setAvailable(false); }
  }

  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [contractorUserId]);

  async function verify(id: string) {
    setBusy(id); setError(null);
    try {
      await verifyPayoutDestination(id);
      onNotice(t('admin.workspace.team.payout.verified'));
      await reload();
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
    } finally { setBusy(null); }
  }

  if (rows === null) {
    return <p className="flex items-center gap-1.5 text-[11px] text-brand-mid-grey">
      <Loader2 className="size-3 animate-spin" aria-hidden />{t('common.loading')}
    </p>;
  }
  if (!available) {
    return <p className="text-[11px] text-brand-mid-grey">{t('admin.workspace.overview.domain.unavailable')}</p>;
  }

  const live = rows.filter(d => d.status !== 'retired');
  if (live.length === 0) {
    return <p className="text-[11px] text-brand-mid-grey">{t('admin.workspace.team.payout.none')}</p>;
  }

  return (
    <div className="space-y-1">
      {live.map(d => (
        <div key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span className="text-brand-mid-grey">
            {d.method === 'mobile_money'
              ? t('contractorPayout.mobileMoney')
              : `${t('contractorPayout.bank')} · ${bankName(d.bankKey)}`}
          </span>
          {/* Masked here too. Staff run the payout; they do not need the digits on screen. */}
          <span className="font-mono text-brand-near-black dark:text-white">{maskDestination(d)}</span>
          {d.accountName && <span className="text-brand-mid-grey">· {d.accountName}</span>}

          {d.status === 'verified' ? (
            <span className="inline-flex items-center gap-1 font-semibold text-state-success">
              <ShieldCheck className="size-3" aria-hidden />{t('contractorPayout.statusVerified')}
            </span>
          ) : (
            <>
              <span className="inline-flex items-center gap-1 text-brand-mid-grey">
                <Clock className="size-3" aria-hidden />{t('contractorPayout.statusUnverified')}
              </span>
              <button
                type="button" disabled={busy === d.id} onClick={() => void verify(d.id)}
                className="font-semibold underline underline-offset-2 disabled:opacity-40"
              >
                {busy === d.id ? t('admin.workspace.team.payout.verifying') : t('admin.workspace.team.payout.verify')}
              </button>
            </>
          )}
        </div>
      ))}
      {error && <p role="alert" className="text-[11px] text-state-alert">{error}</p>}
      <p className="text-[11px] text-brand-mid-grey">{t('admin.workspace.team.payout.hint')}</p>
    </div>
  );
}
