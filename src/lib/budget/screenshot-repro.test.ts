import { it } from 'vitest';
import { calculateBudgetDetail } from './index';
import { CITY_RATES, CM_RATE_FALLBACK } from './model';

it('reproduces the project summary shown in the meeting screenshot', () => {
  const estimates: Array<{ living: number; kitchen: number; office: number; total: number }> = [];
  for (let living = 0; living <= 10; living++) {
    for (let kitchen = 0; kitchen <= 5; kitchen++) {
      for (let office = 0; office <= 5; office++) {
        const detail = calculateBudgetDetail({
          country: 'CM',
          city: 'Limbe',
          projectType: 'residential',
          buildingType: 'single_family',
          floors: 2,
          sqm: 450,
          bedrooms: 8,
          bathrooms: 7,
          livingRooms: living,
          kitchens: kitchen,
          offices: office,
          roofType: 'long_span_aluminum',
          finishLevel: 'standard',
        }, CM_RATE_FALLBACK, CITY_RATES.LIMBE);
        estimates.push({ living, kitchen, office, total: detail.budget.total });
      }
    }
  }
  console.log(estimates
    .sort((a, b) => Math.abs(a.total - 200_861.96) - Math.abs(b.total - 200_861.96))
    .slice(0, 12));
});
