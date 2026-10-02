// =========================================================
// Banks a contractor can be paid into.
//
// WHY A SLUG AND NOT A NUMBER
//
// `payout_destinations.bank_key` (099, renamed in 101) holds GROUNDWORK's identifier for the
// bank. The provider's own routing code is a different value, and the column named for it —
// `bank_code`, which `createPayout()` passes straight to SwyChr's `create_transaction` — is
// deliberately left free until SwyChr publishes their list. There is no correct code to store
// yet, so none is stored.
//
// Two wrong answers were available. Storing a guessed numeric code would be the worse one:
// a plausible-looking wrong number is money sent nowhere, discovered days later. Storing
// the bank's display name is nearly as bad, because display names get edited and then no
// longer join to anything.
//
// So: a stable internal slug. It identifies the bank unambiguously, it never changes, and
// when the provider's code list arrives it is a single mapping in the payout handler —
// `PROVIDER_BANK_CODE[slug]` — with no migration of stored rows and no re-asking every
// contractor for details they already gave us.
//
// Cameroon first, per the launch corridor. Adding a corridor means adding its banks here.
// =========================================================

export interface BankOption {
  /** Stored in `payout_destinations.bank_code`. Stable; never rename one of these. */
  slug: string;
  name: string;
  countryCode: string;
}

export const BANKS: BankOption[] = [
  { slug: 'afriland',  name: 'Afriland First Bank',                    countryCode: 'CM' },
  { slug: 'bicec',     name: 'BICEC',                                  countryCode: 'CM' },
  { slug: 'sgc',       name: 'Société Générale Cameroun',              countryCode: 'CM' },
  { slug: 'scb',       name: 'SCB Cameroun',                           countryCode: 'CM' },
  { slug: 'uba',       name: 'UBA Cameroun',                           countryCode: 'CM' },
  { slug: 'ecobank',   name: 'Ecobank Cameroun',                       countryCode: 'CM' },
  { slug: 'cca',       name: 'CCA Bank',                               countryCode: 'CM' },
  { slug: 'bgfi',      name: 'BGFIBank Cameroun',                      countryCode: 'CM' },
  { slug: 'unionbank', name: 'Union Bank of Cameroon',                 countryCode: 'CM' },
  { slug: 'nfc',       name: 'NFC Bank',                               countryCode: 'CM' },
  { slug: 'cbc',       name: 'Commercial Bank of Cameroon',            countryCode: 'CM' },
  { slug: 'citi',      name: 'Citibank Cameroun',                      countryCode: 'CM' },
  { slug: 'standard',  name: 'Standard Chartered Cameroun',            countryCode: 'CM' },
  { slug: 'other',     name: 'Another bank',                           countryCode: 'CM' },
];

export const banksFor = (countryCode: string): BankOption[] =>
  BANKS.filter(b => b.countryCode === countryCode);

export const bankName = (slug: string | null | undefined): string =>
  BANKS.find(b => b.slug === slug)?.name ?? (slug ?? '');
