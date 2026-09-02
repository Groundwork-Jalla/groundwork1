import { useEffect, useState } from 'react';
import { Loader2, Check, X, RefreshCw, AlertTriangle, Search, Download, Mail } from 'lucide-react';
import {
  getCrmStatus, listCrmBacklog, retryCrmBacklog, diagnoseCrmDocuments, syncCrmFields, auditCrm,
  listSyncFailures, testCrmEmailLog, type SyncFailureRow,
  type CrmStatus, type OutboxRow, type ConfigSource,
} from '@/lib/supabase/admin-applications';
import { cn } from '@/lib/utils';
import { useT, useLanguage } from '@/lib/i18n';
import { fmtDate } from './applications';

// =========================================================
// /admin/crm
//
// Setting up GoHighLevel means pasting seven values into Vercel, and every one of them
// fails *silently* when it is wrong: the forwarder logs a warning nobody reads and
// carries on, because a CRM outage must never break a signup. Without this screen there
// is no way to tell "working" from "quietly doing nothing" — you would only find out
// when someone asked why the CRM was empty.
//
// Two questions, in the order they matter:
//   1. Is it configured, and which route are events taking right now?
//   2. What has not arrived, and can I send it?
// =========================================================

/**
 * One setting.
 *
 * `source` matters because a value can now come from two places — the `app_config` table
 * or the deployment environment — and the table wins. Without saying which, "I changed
 * it and nothing happened" has no answer on the screen.
 */
function Row({ ok, label, hint, source }: {
  ok: boolean; label: string; hint?: string; source?: ConfigSource;
}) {
  const t = useT();
  return (
    <div className="flex items-start gap-3 py-2">
      <span className={cn(
        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
        ok ? 'bg-state-complete/10 text-state-complete' : 'bg-brand-light-grey text-brand-mid-grey',
      )}>
        {ok ? <Check className="size-3" /> : <X className="size-3" />}
      </span>
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <p className={cn('text-sm', ok ? 'text-brand-near-black' : 'text-brand-mid-grey')}>{label}</p>
          {ok && source && source !== 'unset' && (
            <span className="rounded-full bg-brand-light-grey px-1.5 py-px text-[10px] font-medium text-brand-mid-grey">
              {source === 'database' ? t('admin.crm.fromDatabase') : t('admin.crm.fromEnv')}
            </span>
          )}
        </div>
        {hint && <p className="text-[11px] text-brand-mid-grey">{hint}</p>}
      </div>
    </div>
  );
}

export default function AdminCrm() {
  const t = useT();
  const { lang } = useLanguage();

  const [status, setStatus]   = useState<CrmStatus | null>(null);
  const [rows, setRows]       = useState<OutboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [corruptedCount, setCorruptedCount] = useState<number | null>(null);
  const [audit, setAudit] = useState<string | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [orphanCount, setOrphanCount] = useState<number | null>(null);
  const [failures, setFailures] = useState<SyncFailureRow[]>([]);
  const [notice, setNotice]   = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [fields, setFields] = useState<string | null>(null);
  const [fieldsBusy, setFieldsBusy] = useState(false);
  const [missingCount, setMissingCount] = useState<number | null>(null);
  const [mailTest, setMailTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [mailTesting, setMailTesting] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      // Independently: a failed status read should not hide the backlog, and vice versa.
      const [s, b, f] = await Promise.allSettled([
        getCrmStatus(), listCrmBacklog(), listSyncFailures(),
      ]);
      if (s.status === 'fulfilled') setStatus(s.value);
      if (b.status === 'fulfilled') setRows(b.value);
      if (f.status === 'fulfilled') setFailures(f.value);
      if (s.status === 'rejected' && b.status === 'rejected') setError(t('admin.crm.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function retry() {
    setRetrying(true); setNotice(null);
    try {
      const r = await retryCrmBacklog();
      setNotice(t('admin.crm.retryDone', { sent: r.sent, failed: r.failed }));
      await load();
    } catch {
      setNotice(t('admin.crm.retryFailed'));
    } finally {
      setRetrying(false);
    }
  }

  /**
   * Document uploads are the one part of this integration written against documentation
   * rather than a live token. When they fail, this asks GHL and prints the answer
   * verbatim — far quicker than reading deploy logs.
   */
  async function diagnose() {
    setDiagnosing(true); setDiagnosis(null);
    try {
      setDiagnosis(JSON.stringify(await diagnoseCrmDocuments(), null, 2));
    } catch {
      setDiagnosis(t('admin.crm.diagnoseFailed'));
    } finally {
      setDiagnosing(false);
    }
  }

  /**
   * Prove that emails are reaching the CRM timeline.
   *
   * The email log cannot report its own failure anywhere a person would see it — it is
   * built never to break a send, so a CRM that has been silently recording nothing looks
   * exactly like one that is working. This runs the real function and writes the note to
   * the admin's own contact, never to a contractor's.
   */
  async function runMailTest() {
    setMailTesting(true); setMailTest(null);
    try {
      const r = await testCrmEmailLog();
      // Green only for the Conversations thread. A note is a real record but not the
      // surface you can follow up from, so it reads as a warning rather than a pass —
      // otherwise a tick would sit above a setup step nobody knows is missing.
      setMailTest({
        ok: r.onThread === true,
        text: r.detail ?? (r.ok ? t('admin.crm.mailTestOk') : t('admin.crm.mailTestFailed')),
      });
    } catch {
      setMailTest({ ok: false, text: t('admin.crm.mailTestFailed') });
    } finally {
      setMailTesting(false);
    }
  }

  /**
   * Two presses, deliberately. The first only reports what GHL is missing; the second
   * writes a hundred-odd fields into a live CRM, which should never happen because a
   * button happened to be under the cursor.
   */
  async function runAudit() {
    setAuditing(true);
    try {
      const r = await auditCrm() as { orphanRecords?: number };
      setAudit(JSON.stringify(r, null, 2));
      setOrphanCount(typeof r.orphanRecords === 'number' ? r.orphanRecords : null);
    } catch {
      setAudit(t('admin.crm.auditFailed'));
      setOrphanCount(null);
    } finally {
      setAuditing(false);
    }
  }

  /**
   * The whole deletable set, as a file, before anything is deleted.
   *
   * GHL keeps a restore window on bulk deletes, but a window is not a record of what was
   * in there — and a 15-row sample cannot be checked afterwards against what actually
   * went. Written client-side from the response: it never touches disk on the server.
   */
  async function exportOrphans() {
    setAuditing(true);
    try {
      const r = await auditCrm(true) as {
        orphanSample?: Array<Record<string, unknown>>;
      };
      const rows = r.orphanSample ?? [];
      if (!rows.length) return;

      const cols = Object.keys(rows[0]);
      // Quote everything and double any embedded quote: names carry commas, and a CSV
      // that splits a name across two columns is worse than no export.
      const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [
        cols.join(','),
        ...rows.map(row => cols.map(c => cell(row[c])).join(',')),
      ].join('\n');

      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `ghl-orphan-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setAudit(t('admin.crm.auditFailed'));
    } finally {
      setAuditing(false);
    }
  }

  async function checkFields(mode: 'check' | 'create' | 'repair') {
    setFieldsBusy(true);
    try {
      const r = await syncCrmFields(mode) as {
        missingCount?: number; createdCount?: number; corruptedCount?: number;
      };
      setFields(JSON.stringify(r, null, 2));
      // Counts come only from a check. After a create or a repair they are stale by
      // definition, so they are cleared and the admin re-checks — which is also what
      // proves the run did what it claimed.
      const isCheck = mode === 'check';
      setMissingCount(isCheck && typeof r.missingCount === 'number' ? r.missingCount : null);
      setCorruptedCount(isCheck && typeof r.corruptedCount === 'number' ? r.corruptedCount : null);
    } catch {
      setFields(t('admin.crm.fieldsFailed'));
    } finally {
      setFieldsBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand-mid-grey" />
      </div>
    );
  }

  const modeLabel = status
    ? t(`admin.crm.mode.${status.mode}` as 'admin.crm.mode.api')
    : '—';

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.crm.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.crm.subtitle')}</p>
      </header>

      {error && (
        <p className="mb-4 rounded-xl border border-state-alert/30 px-4 py-2.5 text-sm text-state-alert">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Configuration ── */}
        <section className="rounded-2xl border border-brand-border-grey p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-brand-near-black">{t('admin.crm.config')}</h2>
            <span className={cn(
              'rounded-lg px-2.5 py-1 text-[11px] font-medium',
              status?.mode === 'api'     ? 'bg-state-complete/10 text-state-complete'
              : status?.mode === 'webhook' ? 'bg-state-held/10 text-state-held'
              : 'bg-brand-light-grey text-brand-mid-grey',
            )}>
              {modeLabel}
            </span>
          </div>

          {status ? (
            <div className="divide-y divide-brand-border-grey/60">
              <Row ok={status.contractorWebhook} label={t('admin.crm.contractorWebhook')} hint="ghl_contractor_webhook_url" source={status.sources?.contractorWebhook} />
              <Row ok={status.eventWebhook}      label={t('admin.crm.eventWebhook')}      hint="ghl_event_webhook_url"      source={status.sources?.eventWebhook} />
              <Row ok={status.apiToken}          label={t('admin.crm.apiToken')}          hint="ghl_api_token"              source={status.sources?.apiToken} />
              <Row ok={status.locationId}        label={t('admin.crm.locationId')}        hint="ghl_location_id"            source={status.sources?.locationId} />
              <Row ok={status.pipelineId}        label={t('admin.crm.pipelineId')}        hint="ghl_pipeline_id"            source={status.sources?.pipelineId} />
              <Row
                ok={status.stageMapValid && status.stageKeys.length > 0}
                label={t('admin.crm.stageMap', { n: status.stageKeys.length })}
                hint={status.stageMapValid ? status.stageKeys.join(', ') || 'ghl_stage_map' : t('admin.crm.stageMapBroken')}
                source={status.sources?.stageMap}
              />
              <Row ok={status.inboundSecret}     label={t('admin.crm.inboundSecret')}     hint="ghl_inbound_secret"         source={status.sources?.inboundSecret} />
              {/* The one setting whose absence changes nothing visible: emails are still
                  recorded, just as notes, on a tab you cannot reply from. */}
              <Row ok={status.conversationProvider} label={t('admin.crm.convProvider')} hint="ghl_conversation_provider_id" source={status.sources?.conversationProvider} />
            </div>
          ) : (
            <p className="text-sm text-brand-mid-grey">{t('admin.crm.statusUnavailable')}</p>
          )}

          {/* Gated on the API being *configured*, not on it working. These two buttons
              are how you find out why a token is being refused, so hiding them when it
              is refused is precisely backwards. */}
          {(status?.apiConfigured ?? status?.mode === 'api') && (
            <div className="mt-4 border-t border-brand-border-grey/60 pt-3">
              <button
                type="button" disabled={diagnosing} onClick={diagnose}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-40"
              >
                {diagnosing ? <Loader2 className="size-3.5 animate-spin" /> : <AlertTriangle className="size-3.5" />}
                {t('admin.crm.diagnose')}
              </button>
              <p className="mt-1.5 text-[11px] text-brand-mid-grey">{t('admin.crm.diagnoseHint')}</p>

              {/* Custom fields. The single biggest cause of "the data is not in GHL":
                  a field that does not exist there is dropped on arrival, and shows on
                  the contact as a blank rather than as an error. */}
              <div className="mt-4 border-t border-brand-border-grey/60 pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button" disabled={fieldsBusy} onClick={() => void checkFields('check')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-40"
                  >
                    {fieldsBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    {t('admin.crm.fieldsCheck')}
                  </button>
                  {missingCount !== null && missingCount > 0 && (
                    <button
                      type="button" disabled={fieldsBusy} onClick={() => void checkFields('create')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {t('admin.crm.fieldsCreate', { n: missingCount })}
                    </button>
                  )}
                  {/* Only ever appears when a previous run left unusable fields behind.
                      Destructive, so it is styled as such and never the default action. */}
                  {corruptedCount !== null && corruptedCount > 0 && (
                    <button
                      type="button" disabled={fieldsBusy} onClick={() => void checkFields('repair')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-state-blocked/40 bg-state-blocked/5 px-3 py-1.5 text-xs font-medium text-state-blocked transition-colors hover:bg-state-blocked/10 disabled:opacity-40"
                    >
                      <AlertTriangle className="size-3.5" />
                      {t('admin.crm.fieldsRepair', { n: corruptedCount })}
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] text-brand-mid-grey">{t('admin.crm.fieldsHint')}</p>
                {fields && (
                  <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-brand-off-white p-3 text-[11px] leading-relaxed text-brand-near-black">
{fields}
                  </pre>
                )}
              </div>
              {/* Whether emails are landing on contact timelines at all. Its own block
                  because it answers a different question from the field and document
                  checks: not "can we write to GHL" but "is the follow-up trail real". */}
              <div className="mt-4 border-t border-brand-border-grey/60 pt-3">
                <button
                  type="button" disabled={mailTesting} onClick={() => void runMailTest()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-40"
                >
                  {mailTesting ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
                  {t('admin.crm.mailTest')}
                </button>
                <p className="mt-1.5 text-[11px] text-brand-mid-grey">{t('admin.crm.mailTestHint')}</p>
                {mailTest && (
                  <p className={cn('mt-2 rounded-lg px-3 py-2 text-[11px] leading-relaxed',
                    mailTest.ok
                      ? 'bg-state-complete/5 text-state-complete'
                      : 'bg-state-alert/5 text-state-alert')}>
                    {mailTest.text}
                  </p>
                )}
              </div>
              {/* Read-only. Counts misrouted numbers and duplicate records before
                  anybody deletes anything — see api/_handlers/crm-audit.ts. */}
              <div className="mt-4 border-t border-brand-border-grey/60 pt-3">
                <button
                  type="button" disabled={auditing} onClick={() => void runAudit()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-40"
                >
                  {auditing ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
                  {t('admin.crm.audit')}
                </button>
                {/* Only after an audit has actually found something. Deletion is
                    irreversible and the restore window is not a record of what was in
                    there — take the file first. */}
                {orphanCount !== null && orphanCount > 0 && (
                  <button
                    type="button" disabled={auditing} onClick={() => void exportOrphans()}
                    className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-40"
                  >
                    <Download className="size-3.5" />
                    {t('admin.crm.auditExport', { n: orphanCount })}
                  </button>
                )}
                <p className="mt-1.5 text-[11px] text-brand-mid-grey">{t('admin.crm.auditHint')}</p>
                {audit && (
                  <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-brand-off-white p-3 text-[11px] leading-relaxed text-brand-near-black">
{audit}
                  </pre>
                )}
              </div>

              {diagnosis && (
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-brand-off-white p-3 text-[11px] leading-relaxed text-brand-near-black">
{diagnosis}
                </pre>
              )}
            </div>
          )}

          {/* A token can be present and still refused. That combination used to render as
              a row of green ticks over a CRM that was silently rejecting every event, so
              it gets a banner rather than a tick. */}
          {status?.tokenAccepted === false && (
            <div className="mt-3 rounded-xl border border-state-blocked/30 bg-state-blocked/5 px-3 py-2.5">
              <p className="flex items-start gap-2 text-[12px] font-semibold text-state-blocked">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {t('admin.crm.tokenRejected')}
              </p>
              <p className="mt-1 pl-5 text-[11px] leading-relaxed text-brand-mid-grey">
                {status.tokenError === 'location_not_found'
                  ? t('admin.crm.tokenLocationBad')
                  : status.tokenError === 'unreachable'
                    ? t('admin.crm.tokenUnreachable')
                    : t('admin.crm.tokenScopes')}
              </p>
            </div>
          )}

          {status?.mode === 'off' && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-brand-off-white px-3 py-2.5 text-[12px] text-state-held">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {t('admin.crm.offNote')}
            </p>
          )}
        </section>

        {/* ── Syncs that need a human ──
            Top of the page, not buried: a queue nobody sees fails exactly the way the
            log line it replaced did. Each row is a contractor whose API sync failed —
            `fell_back` true means there is a defective record in GHL to correct, false
            means nothing reached the CRM at all. See migration 065. */}
        {failures.length > 0 && (
          <section className="rounded-2xl border border-state-blocked/40 bg-state-blocked/5 p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-state-blocked">
              <AlertTriangle className="size-4" />
              {t('admin.crm.failures', { n: failures.length })}
            </h2>
            <p className="mt-1 text-[12px] text-brand-mid-grey">{t('admin.crm.failuresHint')}</p>
            <div className="mt-3 divide-y divide-brand-border-grey/60">
              {failures.slice(0, 10).map(f => (
                <div key={f.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                  <span className="text-sm font-medium text-brand-near-black">{f.email ?? '—'}</span>
                  <span className={cn(
                    'rounded-full px-1.5 py-px text-[10px] font-medium',
                    f.fell_back
                      ? 'bg-state-held/10 text-state-held'
                      : 'bg-brand-light-grey text-brand-mid-grey',
                  )}>
                    {f.fell_back ? t('admin.crm.failureInCrm') : t('admin.crm.failureNotSent')}
                  </span>
                  <span className="text-[11px] text-brand-mid-grey">{f.reason}</span>
                  <span className="ml-auto text-[11px] text-brand-mid-grey">{fmtDate(f.created_at, lang)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Backlog ── */}
        <section className="rounded-2xl border border-brand-border-grey p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-brand-near-black">
              {t('admin.crm.backlog', { n: rows.length })}
            </h2>
            {rows.length > 0 && (
              <button
                type="button" disabled={retrying} onClick={retry}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-40"
              >
                {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {t('admin.crm.retry')}
              </button>
            )}
          </div>

          {notice && <p className="mb-3 text-sm text-brand-near-black">{notice}</p>}

          {rows.length === 0 ? (
            <p className="text-sm text-brand-mid-grey">{t('admin.crm.backlogEmpty')}</p>
          ) : (
            <ul className="divide-y divide-brand-border-grey/60">
              {rows.slice(0, 25).map(r => (
                <li key={r.id} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[11px] text-brand-mid-grey">{r.event}</span>
                    <span className="text-[11px] text-brand-mid-grey tabular-nums">
                      {fmtDate(r.created_at, lang)}
                    </span>
                  </div>
                  <p className="truncate text-sm text-brand-near-black">{r.email}</p>
                  {r.last_error && (
                    <p className="text-[11px] text-state-held">
                      {r.last_error} · {t('admin.crm.attempts', { n: r.attempts })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
