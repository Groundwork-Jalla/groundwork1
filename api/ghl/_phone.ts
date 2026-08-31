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
 * ── Deliberately not a phone-number library ──────────────────────────────────────────
 * `libphonenumber-js` is ~145 kB and knows every numbering plan on earth. What is
 * actually needed is: take a local number, know which country the person is in, and put
 * the right dial code on the front. The countries are the 24 in `src/lib/countries.ts`,
 * and the ambiguity a full library resolves — national trunk prefixes, area-code
 * validation — is handled below for the only case that matters here.
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
