import { it } from 'vitest';
import { runTakeoff } from './engine';
import { CM_TAKEOFF, DEFAULT_FIXTURE_PRICES } from './model';
import { CAMEROON_BQS } from './__fixtures__/cameroon-bqs';
import type { ConstructionRate } from '@/types/project';

const R: ConstructionRate = {
  country_code: 'CM', base_rate_usd: 640, upper_floor_addition_pct: 23,
  sections: { preliminary: 1.1, foundation: 9.6, ground_floor: 29.4, roof: 12.5,
              joinery: 8.7, electrical: 4.8, plumbing: 13.4, finishing: 20.5 },
  finish_multipliers: { standard: 1.0, premium: 1.45, luxury: 1.70 },
  building_type_multipliers: { single_family: 1.0, multi_family: 1.15 },
  roof_type_multipliers: { long_span_aluminum: 1.0, concrete_flat: 1.08 },
  currency_code: 'XAF', approx_fx_rate: 600, data_source: 'real_bq',
  takeoff: CM_TAKEOFF, fixture_prices: DEFAULT_FIXTURE_PRICES,
};

const pad = (s: string, n: number) => s.padEnd(n);

it('report', () => {
  const lines: string[] = [];
  lines.push(pad('project', 26) + pad('model XAF', 15) + pad('actual XAF', 15) + pad('NEW', 9) + 'old');
  for (const bq of CAMEROON_BQS) {
    const t = runTakeoff(bq.input, R)!;
    const old = bq.input.sqm! * 640 * (1 + (bq.input.floors! - 1) * 0.243) * 600;
    lines.push(
      pad(bq.name.slice(0, 25), 26) +
      pad(Math.round(t.totalLocal).toLocaleString('en-US'), 15) +
      pad(bq.actualTotal.toLocaleString('en-US'), 15) +
      pad(((t.totalLocal / bq.actualTotal - 1) * 100).toFixed(1) + '%', 9) +
      ((old / bq.actualTotal - 1) * 100).toFixed(0) + '%');
  }
  lines.push('');
  lines.push('per-section error:');
  for (const bq of CAMEROON_BQS) {
    const t = runTakeoff(bq.input, R)!;
    const parts = Object.entries(t.sectionsLocal).map(([k, v]) => {
      const a = (bq.actual as Record<string, number>)[k];
      return k.slice(0, 5) + ' ' + (a ? (((v as number) / a - 1) * 100).toFixed(0) + '%' : '-');
    });
    lines.push(pad(bq.name.split(' —')[0], 18) + parts.join('  '));
  }
  console.log(lines.join('\n'));
});
