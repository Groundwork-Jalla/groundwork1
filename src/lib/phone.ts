import { isValidPhoneNumber as isValidInternationalPhoneNumber } from 'libphonenumber-js/min';

/**
 * Phone numbers GoHighLevel can actually message.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────
 * The application form takes a phone number as free text (`<input type="tel">`), and in
 * Cameroon people write theirs the way they say it: `670 00 00 00`. That is what we have
 * been sending to GHL, and it is unusable there — WhatsApp and SMS both address a
 * contact by an E.164 number (`+237670000000`), so a contact stored as `670000000` has a
 * phone field that looks filled in and cannot be messaged.
 *
 * This is not hypothetical for the WhatsApp work: every contractor already in the CRM
 * has an unmessageable number, and nothing about the GHL side of the setup fixes that.
 *
 * ── Normalisation and validation are separate ────────────────────────────────────────
 * Normalisation adds a selected country's dial code to familiar national formats.
 * Submission validation uses libphonenumber metadata to reject numbers whose length or
 * numbering range is not valid for the country code in the resulting E.164 number.
 *
 * ── It never invents a number ────────────────────────────────────────────────────────
 * Anything it cannot confidently normalise comes back unchanged. A wrong number in a CRM
 * is worse than an unformatted one: unformatted fails visibly when someone tries to
 * call, while wrong-but-plausible reaches a stranger.
 */

/**
 * Dial codes for every country the product offers.
 *
 * Keep in step with `src/lib/countries.ts`. A country missing here is not an error — the
 * number is passed through untouched, which is the old behaviour.
 */
const DIAL_CODES: Record<string, string> = {
  CM: '237', // Cameroon — the default market
  NG: '234', GH: '233', SN: '221', CI: '225', BJ: '229', TG: '228',
  KE: '254', UG: '256', TZ: '255', RW: '250', ET: '251',
  ZA: '27',  ZM: '260', ZW: '263', MZ: '258', BW: '267',
  CD: '243', CG: '242', GA: '241',
  MA: '212', EG: '20',  TN: '216', AO: '244',
  // Where the diaspora actually is. A Cameroonian in Paris applying to build at home has
  // a French number, and the country field on the application is the build country, not
  // theirs — so these exist for `normalisePhone(n, 'FR')` when a caller knows better.
  FR: '33',  GB: '44',  US: '1',   CA: '1',   BE: '32',  DE: '49',
  IT: '39',  ES: '34',  NL: '31',  CH: '41',
};

/**
 * Countries whose numbering plan uses a national trunk prefix — a leading `0` that is
 * dialled domestically and dropped internationally. `07911 123456` in the UK is
 * `+44 7911 123456`, not `+44 07911...`.
 *
 * Cameroon is deliberately NOT in this list. CM numbers are nine digits with no trunk
 * prefix, and a Cameroonian mobile can legitimately begin with a digit that would be
 * stripped as one. Getting this wrong turns a valid number into a broken one.
 */
const TRUNK_PREFIX_COUNTRIES = new Set([
  'FR', 'GB', 'DE', 'IT', 'ES', 'NL', 'CH', 'BE',
  'ZA', 'KE', 'UG', 'TZ', 'RW', 'ET', 'ZM', 'ZW', 'NG', 'GH',
]);

/** Plausible E.164 lengths, per the ITU: 7–15 digits including the country code. */
const MIN_DIGITS = 7;
const MAX_DIGITS = 15;

/**
 * Turn a phone number into E.164, or return it unchanged.
 *
 * @param raw     what the person typed
 * @param country ISO-3166 alpha-2 for the number's country. Falls back to Cameroon,
 *                which is where the product is, so an unknown country still produces a
 *                messageable number for the overwhelming majority of contacts.
 */
export function normalisePhone(
  raw: string | null | undefined,
  country?: string | null,
): string | null {
  const input = (raw ?? '').trim();
  if (!input) return null;

  // Already international. Keep it — the person told us the country code, and it beats
  // anything we would infer from a form field.
  if (input.startsWith('+')) {
    const digits = input.slice(1).replace(/\D/g, '');
    return digits.length >= MIN_DIGITS && digits.length <= MAX_DIGITS ? `+${digits}` : input;
  }

  let digits = input.replace(/\D/g, '');
  if (!digits) return input;

  // `00` is the other way of writing `+` in most of the world.
  if (digits.startsWith('00')) {
    const rest = digits.slice(2);
    return rest.length >= MIN_DIGITS && rest.length <= MAX_DIGITS ? `+${rest}` : input;
  }

  const iso = (country ?? 'CM').trim().toUpperCase();
  const dial = DIAL_CODES[iso];
  if (!dial) return input; // unknown country — pass through rather than guess

  // Someone wrote the dial code without the plus: `237670000000`.
  if (digits.startsWith(dial) && digits.length > dial.length + MIN_DIGITS - 2) {
    return `+${digits}`;
  }

  if (TRUNK_PREFIX_COUNTRIES.has(iso) && digits.startsWith('0')) {
    digits = digits.replace(/^0+/, '');
    if (!digits) return input;
  }

  const full = dial + digits;
  if (full.length < MIN_DIGITS || full.length > MAX_DIGITS) return input;

  return `+${full}`;
}

/**
 * Is this a number a provider could actually message?
 *
 * `normalisePhone` returns its input unchanged when it cannot place the number — an
 * unknown country, a length that is not a phone number — so "it returned something" is
 * not the same as "this is usable". Everything that stores or sends a number checks
 * this, so there is one answer to the question rather than one per caller.
 */
export function isE164(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  if (!/^\+\d+$/.test(v)) return false;
  const digits = v.length - 1;
  return digits >= MIN_DIGITS && digits <= MAX_DIGITS;
}

/** Validate an E.164 number against its country's numbering plan and valid lengths. */
export function isValidPhone(value: string | null | undefined): boolean {
  const phone = (value ?? '').trim();
  return isE164(phone) && isValidInternationalPhoneNumber(phone);
}

// =========================================================
// Dialling countries — the list a phone field offers.
//
// NOT `COUNTRIES` from countries.ts. That is the list of places you can BUILD, and it is
// Africa-only for exactly that reason. A phone number is about where a handset is: a
// contractor's next of kin may be in London, and a partner may be running their firm
// from Paris. Offering only build countries would make those numbers unenterable.
//
// Derived from DIAL_CODES above so the two cannot drift — `dialCountries()` fails loudly
// if a code here has no entry, and a test asserts the reverse.
// =========================================================

export interface DialCountry {
  code: string;   // ISO-3166 alpha-2
  name: string;
  flag: string;
  dial: string;   // without the +
}

/** Name and flag per ISO code. Every key of DIAL_CODES must appear here. */
const DIAL_NAMES: Record<string, { name: string; flag: string }> = {
  CM: { name: 'Cameroon',        flag: '\u{1F1E8}\u{1F1F2}' },
  NG: { name: 'Nigeria',         flag: '\u{1F1F3}\u{1F1EC}' },
  GH: { name: 'Ghana',           flag: '\u{1F1EC}\u{1F1ED}' },
  SN: { name: 'Senegal',         flag: '\u{1F1F8}\u{1F1F3}' },
  CI: { name: "C\u00f4te d\u2019Ivoire",  flag: '\u{1F1E8}\u{1F1EE}' },
  BJ: { name: 'Benin',           flag: '\u{1F1E7}\u{1F1EF}' },
  TG: { name: 'Togo',            flag: '\u{1F1F9}\u{1F1EC}' },
  KE: { name: 'Kenya',           flag: '\u{1F1F0}\u{1F1EA}' },
  UG: { name: 'Uganda',          flag: '\u{1F1FA}\u{1F1EC}' },
  TZ: { name: 'Tanzania',        flag: '\u{1F1F9}\u{1F1FF}' },
  RW: { name: 'Rwanda',          flag: '\u{1F1F7}\u{1F1FC}' },
  ET: { name: 'Ethiopia',        flag: '\u{1F1EA}\u{1F1F9}' },
  ZA: { name: 'South Africa',    flag: '\u{1F1FF}\u{1F1E6}' },
  ZM: { name: 'Zambia',          flag: '\u{1F1FF}\u{1F1F2}' },
  ZW: { name: 'Zimbabwe',        flag: '\u{1F1FF}\u{1F1FC}' },
  MZ: { name: 'Mozambique',      flag: '\u{1F1F2}\u{1F1FF}' },
  BW: { name: 'Botswana',        flag: '\u{1F1E7}\u{1F1FC}' },
  CD: { name: 'DR Congo',        flag: '\u{1F1E8}\u{1F1E9}' },
  CG: { name: 'Congo',           flag: '\u{1F1E8}\u{1F1EC}' },
  GA: { name: 'Gabon',           flag: '\u{1F1EC}\u{1F1E6}' },
  MA: { name: 'Morocco',         flag: '\u{1F1F2}\u{1F1E6}' },
  EG: { name: 'Egypt',           flag: '\u{1F1EA}\u{1F1EC}' },
  TN: { name: 'Tunisia',         flag: '\u{1F1F9}\u{1F1F3}' },
  AO: { name: 'Angola',          flag: '\u{1F1E6}\u{1F1F4}' },
  FR: { name: 'France',          flag: '\u{1F1EB}\u{1F1F7}' },
  GB: { name: 'United Kingdom',  flag: '\u{1F1EC}\u{1F1E7}' },
  US: { name: 'United States',   flag: '\u{1F1FA}\u{1F1F8}' },
  CA: { name: 'Canada',          flag: '\u{1F1E8}\u{1F1E6}' },
  BE: { name: 'Belgium',         flag: '\u{1F1E7}\u{1F1EA}' },
  DE: { name: 'Germany',         flag: '\u{1F1E9}\u{1F1EA}' },
  IT: { name: 'Italy',           flag: '\u{1F1EE}\u{1F1F9}' },
  ES: { name: 'Spain',           flag: '\u{1F1EA}\u{1F1F8}' },
  NL: { name: 'Netherlands',     flag: '\u{1F1F3}\u{1F1F1}' },
  CH: { name: 'Switzerland',     flag: '\u{1F1E8}\u{1F1ED}' },
};

/**
 * Every country a number may be entered for, Cameroon first and the rest alphabetical.
 *
 * Cameroon leads because it is the market and the default; after that, alphabetical beats
 * any ranking we would have to justify.
 */
export const DIAL_COUNTRIES: DialCountry[] = Object.entries(DIAL_CODES)
  .map(([code, dial]) => {
    const meta = DIAL_NAMES[code];
    if (!meta) throw new Error(`phone.ts: DIAL_CODES has ${code} but DIAL_NAMES does not`);
    return { code, dial, name: meta.name, flag: meta.flag };
  })
  .sort((a, b) =>
    a.code === 'CM' ? -1 : b.code === 'CM' ? 1 : a.name.localeCompare(b.name));

export const dialCountry = (code: string): DialCountry | undefined =>
  DIAL_COUNTRIES.find(c => c.code === code);

/**
 * Which country an E.164 number belongs to, by longest matching dialling code.
 *
 * Longest-first matters: +237 must not be read as +23. Where several countries share a
 * code (+1 is both US and CA) the first is returned, which is harmless — both normalise
 * back to the identical E.164 string.
 */
export function countryOfE164(value: string | null | undefined): string | undefined {
  const v = (value ?? '').trim();
  if (!v.startsWith('+')) return undefined;
  const digits = v.slice(1);
  let best: DialCountry | undefined;
  for (const c of DIAL_COUNTRIES) {
    if (digits.startsWith(c.dial) && (!best || c.dial.length > best.dial.length)) best = c;
  }
  return best?.code;
}

/** The number without its dialling code, for showing in a national-format input. */
export function nationalPart(value: string | null | undefined, country: string): string {
  const v = (value ?? '').trim();
  const dial = dialCountry(country)?.dial;
  if (!v.startsWith('+') || !dial) return v.replace(/^\+/, '');
  return v.slice(1).startsWith(dial) ? v.slice(1 + dial.length) : v.slice(1);
}
