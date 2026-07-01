import type { CountryOption } from '@/types/project';

export const COUNTRIES: CountryOption[] = [
  // Africa — primary markets
  { code: 'NG', name: 'Nigeria',          flag: '🇳🇬', region: 'africa',      rateStandard: 180, ratePremium: 320, rateLuxury: 520 },
  { code: 'GH', name: 'Ghana',            flag: '🇬🇭', region: 'africa',      rateStandard: 200, ratePremium: 350, rateLuxury: 580 },
  { code: 'KE', name: 'Kenya',            flag: '🇰🇪', region: 'africa',      rateStandard: 210, ratePremium: 360, rateLuxury: 600 },
  { code: 'ZA', name: 'South Africa',     flag: '🇿🇦', region: 'africa',      rateStandard: 350, ratePremium: 600, rateLuxury: 950 },
  { code: 'UG', name: 'Uganda',           flag: '🇺🇬', region: 'africa',      rateStandard: 160, ratePremium: 280, rateLuxury: 450 },
  { code: 'TZ', name: 'Tanzania',         flag: '🇹🇿', region: 'africa',      rateStandard: 170, ratePremium: 290, rateLuxury: 460 },
  { code: 'CM', name: 'Cameroon',         flag: '🇨🇲', region: 'africa',      rateStandard: 155, ratePremium: 270, rateLuxury: 440 },
  { code: 'RW', name: 'Rwanda',           flag: '🇷🇼', region: 'africa',      rateStandard: 190, ratePremium: 330, rateLuxury: 540 },
  { code: 'ET', name: 'Ethiopia',         flag: '🇪🇹', region: 'africa',      rateStandard: 150, ratePremium: 260, rateLuxury: 420 },
  { code: 'SN', name: 'Senegal',          flag: '🇸🇳', region: 'africa',      rateStandard: 165, ratePremium: 285, rateLuxury: 465 },
  { code: 'CI', name: "Côte d'Ivoire",    flag: '🇨🇮', region: 'africa',      rateStandard: 170, ratePremium: 295, rateLuxury: 480 },
  { code: 'ZM', name: 'Zambia',           flag: '🇿🇲', region: 'africa',      rateStandard: 155, ratePremium: 270, rateLuxury: 440 },
  { code: 'ZW', name: 'Zimbabwe',         flag: '🇿🇼', region: 'africa',      rateStandard: 145, ratePremium: 255, rateLuxury: 415 },
  { code: 'MA', name: 'Morocco',          flag: '🇲🇦', region: 'africa',      rateStandard: 280, ratePremium: 480, rateLuxury: 780 },
  { code: 'EG', name: 'Egypt',            flag: '🇪🇬', region: 'africa',      rateStandard: 200, ratePremium: 350, rateLuxury: 570 },
  { code: 'AO', name: 'Angola',           flag: '🇦🇴', region: 'africa',      rateStandard: 185, ratePremium: 320, rateLuxury: 520 },
  { code: 'MZ', name: 'Mozambique',       flag: '🇲🇿', region: 'africa',      rateStandard: 145, ratePremium: 250, rateLuxury: 405 },
  { code: 'BJ', name: 'Benin',            flag: '🇧🇯', region: 'africa',      rateStandard: 150, ratePremium: 260, rateLuxury: 425 },

  // Diaspora — Europe
  { code: 'GB', name: 'United Kingdom',   flag: '🇬🇧', region: 'europe',      rateStandard: 2000, ratePremium: 3500, rateLuxury: 5500 },
  { code: 'DE', name: 'Germany',          flag: '🇩🇪', region: 'europe',      rateStandard: 1800, ratePremium: 3000, rateLuxury: 4800 },
  { code: 'FR', name: 'France',           flag: '🇫🇷', region: 'europe',      rateStandard: 1900, ratePremium: 3200, rateLuxury: 5100 },
  { code: 'NL', name: 'Netherlands',      flag: '🇳🇱', region: 'europe',      rateStandard: 1850, ratePremium: 3100, rateLuxury: 4900 },
  { code: 'IE', name: 'Ireland',          flag: '🇮🇪', region: 'europe',      rateStandard: 2100, ratePremium: 3600, rateLuxury: 5700 },
  { code: 'IT', name: 'Italy',            flag: '🇮🇹', region: 'europe',      rateStandard: 1600, ratePremium: 2800, rateLuxury: 4500 },
  { code: 'ES', name: 'Spain',            flag: '🇪🇸', region: 'europe',      rateStandard: 1500, ratePremium: 2600, rateLuxury: 4200 },
  { code: 'PT', name: 'Portugal',         flag: '🇵🇹', region: 'europe',      rateStandard: 1400, ratePremium: 2400, rateLuxury: 3900 },

  // Diaspora — Americas
  { code: 'US', name: 'United States',    flag: '🇺🇸', region: 'americas',    rateStandard: 1500, ratePremium: 2500, rateLuxury: 4000 },
  { code: 'CA', name: 'Canada',           flag: '🇨🇦', region: 'americas',    rateStandard: 1400, ratePremium: 2300, rateLuxury: 3800 },
  { code: 'BR', name: 'Brazil',           flag: '🇧🇷', region: 'americas',    rateStandard: 400,  ratePremium: 700,  rateLuxury: 1200 },

  // Diaspora — Oceania
  { code: 'AU', name: 'Australia',        flag: '🇦🇺', region: 'oceania',     rateStandard: 1800, ratePremium: 3000, rateLuxury: 4800 },
  { code: 'NZ', name: 'New Zealand',      flag: '🇳🇿', region: 'oceania',     rateStandard: 1700, ratePremium: 2900, rateLuxury: 4600 },

  // Middle East
  { code: 'AE', name: 'UAE',              flag: '🇦🇪', region: 'middle_east', rateStandard: 1200, ratePremium: 2200, rateLuxury: 3800 },
  { code: 'QA', name: 'Qatar',            flag: '🇶🇦', region: 'middle_east', rateStandard: 1300, ratePremium: 2300, rateLuxury: 3900 },
  { code: 'SA', name: 'Saudi Arabia',     flag: '🇸🇦', region: 'middle_east', rateStandard: 1100, ratePremium: 2000, rateLuxury: 3400 },
];

export const POPULAR_COUNTRY_CODES = ['NG', 'GH', 'KE', 'ZA', 'GB', 'US', 'CA', 'AU'];

export function findCountry(code: string): CountryOption | undefined {
  return COUNTRIES.find(c => c.code === code);
}
