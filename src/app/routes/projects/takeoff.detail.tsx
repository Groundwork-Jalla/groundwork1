import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Loader2, Lock, Save, Send, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchProject } from '@/lib/supabase/projects';
import { getConstructionRate } from '@/lib/supabase/construction-rates';
import {
  fetchTakeoff, priceTakeoff, saveDraft, submitTakeoff, type ProjectTakeoffRow,
} from '@/lib/supabase/takeoffs';
import {
  buildLegacyRate, formatLocalCurrency, formatUSDFull, projectBudget, runTakeoff,
} from '@/lib/budget';
import { LineGrid } from '@/components/takeoff/LineGrid';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import type { OverrideMap } from '@/lib/budget';
import type { ConstructionRate, ProjectRow } from '@/types/project';

// =========================================================
// The take-off editor.
//
// Authored in LOCAL currency, with USD derived and labelled indicative. That is the
// reverse of the client wizard, deliberately: contractors quote in XAF, and
// `approx_fx_rate` is a rounded constant. A franc figure that moved because a stored FX
// rate changed would destroy trust in the whole document.
// =========================================================

function Field({
  label, value, onChange, suffix, disabled,
}: {
  label: string; value: number | undefined;
  onChange: (v: number | undefined) => void;
  suffix?: string; disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">{label}</span>
      <span className="relative">
        <input
          inputMode="decimal"
          disabled={disabled}
          value={value ?? ''}
          onChange={e => {
            const raw = e.target.value.replace(/[^0-9.]/g, '');
            const n = Number(raw);
            onChange(raw === '' || !Number.isFinite(n) ? undefined : n);
          }}
          className="w-full rounded-xl border border-brand-border-grey bg-white px-3 py-2 text-sm tabular-nums text-brand-near-black focus:border-brand-near-black focus:outline-none disabled:opacity-60 dark:border-[#2c2c2c] dark:bg-[#171717] dark:text-white"
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-brand-mid-grey">{suffix}</span>
        )}
      </span>
    </label>
  );
}

export default function TakeoffDetail() {
  const { id, takeoffId } = useParams<{ id: string; takeoffId: string }>();
  const { user } = useAuth();
  const t = useT();

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [rate, setRate]       = useState<ConstructionRate | null>(null);
  const [row, setRow]         = useState<ProjectTakeoffRow | null>(null);
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [dims, setDims] = useState<{ lengthM?: number; widthM?: number }>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState<'save' | 'submit' | null>(null);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id || !takeoffId) return;
    setLoading(true);
    try {
      const [p, r] = await Promise.all([fetchProject(id), fetchTakeoff(takeoffId)]);
      setProject(p);
      setRow(r);
      if (r) {
        setOverrides(r.overrides ?? {});
        setDims({ lengthM: r.inputs.lengthM, widthM: r.inputs.widthM });
      }
      if (p) setRate(await getConstructionRate(p.country).catch(() => null));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('takeoff.errLoad'));
    } finally {
      setLoading(false);
    }
  }, [id, takeoffId, t]);

  useEffect(() => { void load(); }, [load]);

  const effectiveRate = rate ?? (project ? buildLegacyRate({ country: project.country }) : null);
  const readOnly = !row || row.status !== 'draft' || row.created_by !== user?.id;

  // Live pricing. A draft recomputes on every keystroke; a submitted row renders from its
  // frozen snapshot via priceTakeoff.
  const priced = useMemo(() => {
    if (!row || !effectiveRate) return null;
    if (row.status !== 'draft') return priceTakeoff(row, effectiveRate);
    const t2 = runTakeoff({ ...row.inputs, ...dims }, effectiveRate, null, overrides);
    return t2 && { lines: t2.lines, totalLocal: t2.totalLocal, cityRate: t2.cityRate, frozen: false };
  }, [row, effectiveRate, overrides, dims]);

  // The same build with no overrides — what "reset to model" restores, and the baseline
  // the variance below is measured against.
  const modelPriced = useMemo(() => {
    if (!row || !effectiveRate) return null;
    return runTakeoff({ ...row.inputs, ...dims }, effectiveRate, null, null);
  }, [row, effectiveRate, dims]);

  async function handleSave() {
    if (!row) return;
    setBusy('save'); setError(null);
    try {
      await saveDraft(row.id, { inputs: { ...row.inputs, ...dims }, overrides });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('takeoff.errSave'));
    } finally { setBusy(null); }
  }

  async function handleSubmit() {
    if (!row || !priced || !effectiveRate) return;
    setBusy('submit'); setError(null);
    try {
      await saveDraft(row.id, { inputs: { ...row.inputs, ...dims }, overrides });
      await submitTakeoff(row.id, priced, effectiveRate.approx_fx_rate);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('takeoff.errSubmit'));
    } finally { setBusy(null); }
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="size-5 animate-spin text-brand-mid-grey" /></div>;
  }
  if (!project || !row || !priced || !effectiveRate) {
    return <p className="py-20 text-center text-sm text-brand-mid-grey">{t('takeoff.notFound')}</p>;
  }

  const fx       = row.fx_rate ?? effectiveRate.approx_fx_rate;
  const usd      = priced.totalLocal / fx;
  const budget   = projectBudget(project);
  const variance = budget.construction > 0 ? (usd / budget.construction - 1) * 100 : 0;
  const modelTotal = modelPriced?.totalLocal ?? priced.totalLocal;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mx-auto flex max-w-5xl flex-col gap-5"
    >
      <Link to={`/projects/${project.id}/takeoff`} className="inline-flex w-fit items-center gap-1.5 text-xs text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white">
        <ArrowLeft className="size-3.5" /> {t('takeoff.title')}
      </Link>

      {/* Totals */}
      <div className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">{t('takeoff.yourTotal')}</p>
            <p className="mt-0.5 text-3xl font-black tabular-nums text-brand-near-black dark:text-white">
              {formatLocalCurrency(Math.round(priced.totalLocal), priced.cityRate.currency_code)}
            </p>
            {/* USD is derived and labelled indicative — the FX rate is a rounded constant. */}
            <p className="mt-0.5 text-xs text-brand-mid-grey tabular-nums">
              ≈ {formatUSDFull(usd)} · {t('takeoff.indicativeUsd')}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">{t('takeoff.vsClientBudget')}</p>
            <p className={cn(
              'mt-0.5 text-lg font-bold tabular-nums',
              Math.abs(variance) < 1 ? 'text-brand-mid-grey'
                : variance > 0 ? 'text-state-held' : 'text-state-complete',
            )}>
              {variance > 0 ? '+' : ''}{variance.toFixed(1)}%
            </p>
            <p className="text-[11px] text-brand-mid-grey tabular-nums">{formatUSDFull(budget.construction)}</p>
          </div>
        </div>

        {priced.frozen && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-brand-off-white px-3.5 py-2.5 text-[11px] leading-relaxed text-brand-mid-grey dark:bg-[#252525]">
            <Lock className="mt-0.5 size-3 shrink-0" />
            {t('takeoff.frozenNote')}
          </p>
        )}
      </div>

      {/* Geometry */}
      <div className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        <p className="text-sm font-semibold text-brand-near-black dark:text-white">{t('takeoff.geometry')}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-brand-mid-grey">{t('takeoff.geometryNote')}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={t('takeoff.length')} suffix="m" value={dims.lengthM} disabled={readOnly}
                 onChange={v => setDims(d => ({ ...d, lengthM: v }))} />
          <Field label={t('takeoff.width')} suffix="m" value={dims.widthM} disabled={readOnly}
                 onChange={v => setDims(d => ({ ...d, widthM: v }))} />
        </div>
        {/* Where the stated area and L x W disagree, surface both rather than silently
            reconciling — the contractor is the one who knows which is right. */}
        {dims.lengthM && dims.widthM && Math.abs(dims.lengthM * dims.widthM - Number(project.sqm)) > 1 && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-state-held/30 px-3.5 py-2.5 text-[11px] leading-relaxed text-state-held">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" />
            {t('takeoff.areaMismatch', {
              stated: String(project.sqm),
              derived: String(Math.round(dims.lengthM * dims.widthM)),
            })}
          </p>
        )}
      </div>

      {/* Lines */}
      <LineGrid
        lines={priced.lines}
        modelLines={modelPriced?.lines ?? priced.lines}
        overrides={overrides}
        currencyCode={priced.cityRate.currency_code}
        readOnly={readOnly}
        onChange={setOverrides}
      />

      {modelTotal !== priced.totalLocal && (
        <p className="text-[11px] text-brand-mid-grey">
          {t('takeoff.modelBaseline')}{' '}
          <span className="tabular-nums">{formatLocalCurrency(Math.round(modelTotal), priced.cityRate.currency_code)}</span>
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-state-alert/30 px-4 py-2.5 text-sm text-state-alert">{error}</p>
      )}

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button" onClick={handleSave} disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-xl border border-brand-border-grey px-4 py-2.5 text-sm font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white dark:hover:bg-[#252525]"
          >
            {busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : <Save className="size-4" />}
            {saved ? t('takeoff.saved') : t('takeoff.saveDraft')}
          </button>
          <button
            type="button" onClick={handleSubmit} disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-brand-near-black"
          >
            {busy === 'submit' ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {t('takeoff.submit')}
          </button>
        </div>
      )}
      {!readOnly && <p className="-mt-2 text-[11px] text-brand-mid-grey">{t('takeoff.submitNote')}</p>}
    </motion.div>
  );
}
