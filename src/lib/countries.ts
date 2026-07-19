import type { CountryOption } from '@/types/project';

export const COUNTRIES: CountryOption[] = [
  // Cameroon — primary recommended market
  { code: 'CM', name: 'Cameroon',       flag: '🇨🇲', region: 'africa', rateStandard: 155, ratePremium: 270, rateLuxury: 440, recommended: true },

  // Nigeria & West Africa
  { code: 'NG', name: 'Nigeria',         flag: '🇳🇬', region: 'africa', rateStandard: 180, ratePremium: 320, rateLuxury: 520 },
  { code: 'GH', name: 'Ghana',           flag: '🇬🇭', region: 'africa', rateStandard: 200, ratePremium: 350, rateLuxury: 580 },
  { code: 'SN', name: 'Senegal',         flag: '🇸🇳', region: 'africa', rateStandard: 165, ratePremium: 285, rateLuxury: 465 },
  { code: 'CI', name: "Côte d'Ivoire",   flag: '🇨🇮', region: 'africa', rateStandard: 170, ratePremium: 295, rateLuxury: 480 },
  { code: 'BJ', name: 'Benin',           flag: '🇧🇯', region: 'africa', rateStandard: 150, ratePremium: 260, rateLuxury: 425 },
  { code: 'TG', name: 'Togo',            flag: '🇹🇬', region: 'africa', rateStandard: 145, ratePremium: 255, rateLuxury: 415 },

  // East Africa
  { code: 'KE', name: 'Kenya',           flag: '🇰🇪', region: 'africa', rateStandard: 210, ratePremium: 360, rateLuxury: 600 },
  { code: 'UG', name: 'Uganda',          flag: '🇺🇬', region: 'africa', rateStandard: 160, ratePremium: 280, rateLuxury: 450 },
  { code: 'TZ', name: 'Tanzania',        flag: '🇹🇿', region: 'africa', rateStandard: 170, ratePremium: 290, rateLuxury: 460 },
  { code: 'RW', name: 'Rwanda',          flag: '🇷🇼', region: 'africa', rateStandard: 190, ratePremium: 330, rateLuxury: 540 },
  { code: 'ET', name: 'Ethiopia',        flag: '🇪🇹', region: 'africa', rateStandard: 150, ratePremium: 260, rateLuxury: 420 },

  // Southern Africa
  { code: 'ZA', name: 'South Africa',    flag: '🇿🇦', region: 'africa', rateStandard: 350, ratePremium: 600, rateLuxury: 950 },
  { code: 'ZM', name: 'Zambia',          flag: '🇿🇲', region: 'africa', rateStandard: 155, ratePremium: 270, rateLuxury: 440 },
  { code: 'ZW', name: 'Zimbabwe',        flag: '🇿🇼', region: 'africa', rateStandard: 145, ratePremium: 255, rateLuxury: 415 },
  { code: 'MZ', name: 'Mozambique',      flag: '🇲🇿', region: 'africa', rateStandard: 145, ratePremium: 250, rateLuxury: 405 },
  { code: 'BW', name: 'Botswana',        flag: '🇧🇼', region: 'africa', rateStandard: 220, ratePremium: 380, rateLuxury: 620 },

  // Central Africa
  { code: 'CD', name: 'DR Congo',        flag: '🇨🇩', region: 'africa', rateStandard: 140, ratePremium: 245, rateLuxury: 400 },
  { code: 'CG', name: 'Congo',           flag: '🇨🇬', region: 'africa', rateStandard: 145, ratePremium: 255, rateLuxury: 415 },
  { code: 'GA', name: 'Gabon',           flag: '🇬🇦', region: 'africa', rateStandard: 200, ratePremium: 350, rateLuxury: 570 },

  // North Africa
  { code: 'MA', name: 'Morocco',         flag: '🇲🇦', region: 'africa', rateStandard: 280, ratePremium: 480, rateLuxury: 780 },
  { code: 'EG', name: 'Egypt',           flag: '🇪🇬', region: 'africa', rateStandard: 200, ratePremium: 350, rateLuxury: 570 },
  { code: 'TN', name: 'Tunisia',         flag: '🇹🇳', region: 'africa', rateStandard: 220, ratePremium: 380, rateLuxury: 620 },

  // Other Africa
  { code: 'AO', name: 'Angola',          flag: '🇦🇴', region: 'africa', rateStandard: 185, ratePremium: 320, rateLuxury: 520 },
];

// Popular picks shown in the grid on Step 1 — Cameroon first, then by region
export const POPULAR_COUNTRY_CODES = ['CM', 'NG', 'GH', 'KE', 'ZA', 'UG', 'TZ', 'ET'];

export function findCountry(code: string): CountryOption | undefined {
  return COUNTRIES.find(c => c.code === code);
}
