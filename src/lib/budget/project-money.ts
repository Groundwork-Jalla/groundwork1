import type { ProjectRow } from '@/types/project';
import { getApproxFx, getCurrencyCode } from './legacy';
import { moneyPair, type MoneyPair } from './money-pair';

export type ProjectMoneySource = string | null | undefined | Pick<ProjectRow,
  'country' | 'budget_source' | 'budget_amount' | 'budget_currency' | 'budget_fx_rate' | 'budget_precision' | 'budget_usd' | 'pricing_revision'>;

/** A confirmed contract uses one conversion snapshot for all of its participants. */
export function projectMoneyBasis(source: ProjectMoneySource, liveRate?: number | null) {
  const project = typeof source === 'object' && source !== null ? source : null;
  const country = typeof source === 'string' ? source : project?.country;
  const locked = (project?.budget_source === 'boq' || (project?.pricing_revision ?? 0) > 0) && !!project?.budget_currency
    && project.budget_fx_rate != null && project.budget_fx_rate > 0;
  const code = locked ? project!.budget_currency! : getCurrencyCode((country ?? '').toUpperCase());
  const fallback = locked ? Number(project!.budget_fx_rate) : getApproxFx((country ?? '').toUpperCase());
  const rate = locked || project?.budget_source === 'boq' ? fallback : liveRate ?? fallback;
  const precision = locked ? Math.max(0, Math.min(6, project!.budget_precision ?? 0)) : 0;
  return { project, code, rate, fallback, precision, locked };
}

export function projectMoneyPair(source: ProjectMoneySource, usd: number | null | undefined, liveRate?: number | null, sourceAmount?: number | null): MoneyPair | null {
  if (usd == null || !Number.isFinite(usd)) return null;
  const { project, code, rate, precision, locked } = projectMoneyBasis(source, liveRate);
  if (!locked) {
    const result = moneyPair(Math.round(usd * rate), code, rate);
    return usd === 0 ? { ...result, usd: null, rate: null } : result;
  }
  const scale = 10 ** precision;
  const amount = sourceAmount != null ? sourceAmount
    : project?.budget_amount != null && usd === project.budget_usd
      ? Number(project.budget_amount) : Math.round(usd * rate * scale) / scale;
  const grouped = amount.toLocaleString('en-US', { maximumFractionDigits: precision });
  return {
    local: code === 'USD' ? `$${grouped}` : `${grouped} ${code}`,
    usd: code === 'USD' || usd === 0 ? null : `$${usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    rate: code === 'USD' || usd === 0 ? null : `${rate.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${code} = $1`,
  };
}
