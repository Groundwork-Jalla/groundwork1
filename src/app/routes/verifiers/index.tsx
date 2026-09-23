import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { listMyVerifications, type VerifierWorkItem } from '@/lib/supabase/verifier-work';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /verifiers — what this verifier has been asked to verify (06 §22).
//
// Only rows whose `verifier_id` is the signed-in user, and only projects they are an
// active member of (086). A Self-Verify project with no verification assigned to them
// does not appear: an explicit `stage_verifications` row is the authority here, never
// the project's verification mode.
// =========================================================

const DOT: Record<VerifierWorkItem['decision'], string> = {
  pending:             'bg-state-held',
  verified:            'bg-state-complete',
  rejected:            'bg-state-alert',
  needs_more_evidence: 'bg-state-active',
};

export default function VerifierWork() {
  const t = useT();
  const { user } = useAuth();
  const [rows, setRows] = useState<VerifierWorkItem[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const r = await listMyVerifications(user.id);
      setRows(r.rows); setAvailable(r.available); setError(null);
    } catch (err) {
      setRows([]); setError(errorMessage(err, t('common.somethingWrong')));
    }
  }, [user, t]);
  useEffect(() => { load(); }, [load]);

  const pending = (rows ?? []).filter(r => r.decision === 'pending');
  const done    = (rows ?? []).filter(r => r.decision !== 'pending');

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold text-brand-near-black dark:text-white">{t('verifier.work.title')}</h1>
        <p className="mt-0.5 text-xs text-brand-mid-grey">{t('verifier.work.subtitle')}</p>
      </header>

      {rows === null ? (
        <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>
      ) : error ? (
        <p role="alert" className="rounded-2xl border border-brand-border-grey bg-[#ffffff] px-5 py-4 text-xs text-state-alert dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          {t('verifier.work.error', { reason: error })}
        </p>
      ) : !available ? (
        <p className="rounded-2xl border border-brand-border-grey bg-[#ffffff] px-5 py-4 text-xs text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          {t('verifier.work.unavailable')}
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-brand-border-grey bg-[#ffffff] dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <EmptyState icon={<ShieldCheck className="size-8" />} title={t('verifier.work.empty')} description={t('verifier.work.emptyBody')} />
        </div>
      ) : (
        <>
          <Section title={t('verifier.work.pending')} rows={pending} emptyText={t('verifier.work.nonePending')} />
          {done.length > 0 && <Section title={t('verifier.work.history')} rows={done} emptyText="" />}
        </>
      )}
    </div>
  );
}

function Section({ title, rows, emptyText }: { title: string; rows: VerifierWorkItem[]; emptyText: string }) {
  const t = useT();
  return (
    <section className="overflow-hidden rounded-2xl border border-brand-border-grey bg-[#ffffff] dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <header className="border-b border-brand-border-grey px-5 py-3 dark:border-[#2c2c2c]">
        <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{title}</h2>
      </header>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-brand-mid-grey">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
          {rows.map(r => (
            <li key={r.id}>
              <Link to={`/verifiers/${r.id}`} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-brand-off-white dark:hover:bg-[#252525]">
                <span className={cn('size-2 shrink-0 rounded-full', DOT[r.decision])} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-brand-near-black dark:text-white">{r.projectName}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-brand-mid-grey">
                    {t('verifier.work.stage', { n: r.stageNumber })} · {r.stageName}
                    {(r.projectCity || r.projectCountry) && ` · ${[r.projectCity, r.projectCountry].filter(Boolean).join(', ')}`}
                    {' · '}{t(`verifier.decision.${r.decision}` as TKey)}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-brand-mid-grey">{formatRelative(r.decidedAt ?? r.requestedAt)}</span>
                <ChevronRight className="size-4 shrink-0 text-brand-muted-grey" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
