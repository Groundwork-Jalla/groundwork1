import { useState } from 'react';
import { Loader2, Send, AlertTriangle } from 'lucide-react';
import { backfillCrm } from '@/lib/supabase/admin-applications';
import { useT } from '@/lib/i18n';

/**
 * Push a whole cohort into GoHighLevel, with their correspondence.
 *
 * ── Why the dry run is not optional ──────────────────────────────────────────────────
 * The send half delivers real email to everybody who has never been contacted. Getting
 * that wrong means telling an accepted contractor their application is "under review",
 * or a homeowner with three projects to "get started" — messages that say plainly we
 * have lost track of them. So the first press always previews, and the send button only
 * appears once you have seen the counts.
 *
 * Anyone already contacted is never re-emailed: their thread is backfilled with a record
 * of what they were sent at the time, and nothing is delivered.
 */
export function CrmBackfillPanel({ kind }: { kind: 'contractors' | 'users' }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ send: number; backfill: number } | null>(null);

  async function run(send: boolean) {
    if (send && !window.confirm(t('admin.crmSync.confirm', { n: counts?.send ?? 0 }))) return;
    setBusy(true);
    try {
      const r = await backfillCrm(kind, send) as {
        wouldSend?: number; wouldBackfill?: number; processed?: number;
      };
      setResult(JSON.stringify(r, null, 2));
      setCounts(send ? null : {
        send: r.wouldSend ?? 0,
        backfill: r.wouldBackfill ?? 0,
      });
    } catch {
      setResult(t('admin.crmSync.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-brand-border-grey p-5">
      <h2 className="text-sm font-bold text-brand-near-black">{t('admin.crmSync.title')}</h2>
      <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-brand-mid-grey">
        {t('admin.crmSync.blurb')}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button" disabled={busy} onClick={() => void run(false)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          {t('admin.crmSync.preview')}
        </button>

        {/* Only after a preview, and only when there is something to send. */}
        {counts && counts.send > 0 && (
          <button
            type="button" disabled={busy} onClick={() => void run(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {t('admin.crmSync.send', { n: counts.send })}
          </button>
        )}
        {counts && counts.send === 0 && counts.backfill > 0 && (
          <button
            type="button" disabled={busy} onClick={() => void run(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-40"
          >
            {t('admin.crmSync.backfillOnly', { n: counts.backfill })}
          </button>
        )}
      </div>

      {counts && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-brand-mid-grey">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          {t('admin.crmSync.counts', { send: counts.send, backfill: counts.backfill })}
        </p>
      )}

      {result && (
        <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-brand-off-white p-3 text-[11px] leading-relaxed text-brand-near-black">
{result}
        </pre>
      )}
    </section>
  );
}
