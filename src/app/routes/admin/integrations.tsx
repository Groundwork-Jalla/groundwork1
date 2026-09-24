import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, MinusCircle } from 'lucide-react';
import { getCrmStatus, type CrmStatus } from '@/lib/supabase/admin-applications';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /admin/integrations — the external services under the product (01 §3 SYSTEM).
//
// ── What belongs here ────────────────────────────────────────────────────────────────
// Whether each connection is healthy and configured. Not the CRM pipeline — that is a
// view of leads and belongs under Acquisition. Not configuration itself: /admin/crm
// already owns GoHighLevel's settings, diagnostics and repair, and duplicating that
// logic here would create two places that disagree.
//
// ── Honesty ──────────────────────────────────────────────────────────────────────────
// Every state below is asked of the system, not asserted: "token set" and "token
// accepted" are different questions and are shown as different answers. SwyChr is shown
// as what it is — not configured, under contract review — because a green tick for an
// integration that does not exist is the most expensive kind of lie a dashboard tells.
// No secret is ever rendered: booleans and words only.
// =========================================================

type Health = 'ok' | 'warn' | 'off';

export default function AdminIntegrations() {
  const t = useT();
  const [crm, setCrm] = useState<CrmStatus | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setCrm(await getCrmStatus()); setError(null); }
    catch (err) { setCrm(null); setError(errorMessage(err, t('common.somethingWrong'))); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  // The one question that matters for GHL: is it carrying events, and does GHL accept us?
  const ghlHealth: Health = crm == null ? 'off'
    : crm.tokenAccepted === false ? 'warn'
    : crm.mode === 'off' ? 'off'
    : 'ok';

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold text-brand-near-black dark:text-white">{t('admin.integrations.title')}</h1>
        <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.integrations.subtitle')}</p>
      </header>

      {crm === undefined ? (
        <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* ── GoHighLevel ─────────────────────────────────────────────────────── */}
          <Card
            name={t('admin.integrations.ghl.name')}
            purpose={t('admin.integrations.ghl.purpose')}
            health={ghlHealth}
            healthLabel={t(`admin.integrations.health.${ghlHealth}` as TKey)}
          >
            {error ? (
              <p role="alert" className="px-5 py-4 text-xs text-state-alert">{error}</p>
            ) : crm === null ? (
              <p className="px-5 py-4 text-xs text-brand-mid-grey">{t('admin.integrations.ghl.unreadable')}</p>
            ) : (
              <>
                <dl className="divide-y divide-brand-border-grey text-xs dark:divide-[#2c2c2c]">
                  <Fact label={t('admin.integrations.ghl.mode')} value={t(`admin.integrations.ghl.modes.${crm.mode}` as TKey)} />
                  <Fact label={t('admin.integrations.ghl.token')}
                    value={crm.tokenAccepted === true ? t('admin.integrations.ghl.accepted')
                         : crm.tokenAccepted === false ? t('admin.integrations.ghl.rejected', { reason: crm.tokenError ?? '' })
                         : crm.apiToken ? t('admin.integrations.ghl.setNotTested') : t('admin.integrations.notConfigured')} />
                  <Fact label={t('admin.integrations.ghl.location')} value={crm.locationId ? t('admin.integrations.configured') : t('admin.integrations.notConfigured')} />
                  <Fact label={t('admin.integrations.ghl.pipeline')}
                    value={crm.pipelineId ? (crm.stageMapValid ? t('admin.integrations.configured') : t('admin.integrations.ghl.stagesInvalid')) : t('admin.integrations.notConfigured')} />
                  <Fact label={t('admin.integrations.ghl.inbound')} value={crm.inboundSecret ? t('admin.integrations.configured') : t('admin.integrations.notConfigured')} />
                  <Fact label={t('admin.integrations.ghl.conversations')} value={crm.conversationProvider ? t('admin.integrations.configured') : t('admin.integrations.notConfigured')} />
                </dl>
                <div className="border-t border-brand-border-grey px-5 py-3 dark:border-[#2c2c2c]">
                  <Link to="/admin/crm" className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-near-black underline-offset-2 hover:underline dark:text-white">
                    {t('admin.integrations.ghl.manage')}<ExternalLink className="size-3.5" />
                  </Link>
                </div>
              </>
            )}
          </Card>

          {/* ── SwyChr ──────────────────────────────────────────────────────────── */}
          <Card
            name={t('admin.integrations.swychr.name')}
            purpose={t('admin.integrations.swychr.purpose')}
            health="off"
            healthLabel={t('admin.integrations.health.off')}
          >
            <div className="px-5 py-4 text-xs text-brand-mid-grey">
              <p className="text-brand-near-black dark:text-white">{t('admin.integrations.swychr.state')}</p>
              <p className="mt-1">{t('admin.integrations.swychr.detail')}</p>
              <p className="mt-2 text-[11px]">{t('admin.integrations.swychr.meanwhile')}</p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Card({ name, purpose, health, healthLabel, children }: {
  name: string; purpose: string; health: Health; healthLabel: string; children: React.ReactNode;
}) {
  const Icon = health === 'ok' ? CheckCircle2 : health === 'warn' ? AlertTriangle : MinusCircle;
  return (
    <section className="self-start overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-brand-border-grey px-5 py-3.5 dark:border-[#2c2c2c]">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{name}</h2>
          <p className="mt-0.5 text-xs text-brand-mid-grey">{purpose}</p>
        </div>
        <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
          health === 'ok' ? 'bg-state-complete/10 text-state-complete'
          : health === 'warn' ? 'bg-state-alert/10 text-state-alert'
          : 'bg-brand-off-white text-brand-mid-grey dark:bg-[#252525]')}>
          <Icon className="size-3.5" />{healthLabel}
        </span>
      </header>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-2.5">
      <dt className="text-brand-muted-grey">{label}</dt>
      <dd className="text-right text-brand-near-black dark:text-white">{value}</dd>
    </div>
  );
}
