/** Canonical configured currency basis used by legacy project budgets. */
const COUNTRY_MONEY: Record<string, readonly [string, number]> = {
  CM: ['XAF', 600], CI: ['XOF', 600], SN: ['XOF', 600], TG: ['XOF', 600], BJ: ['XOF', 600],
  NG: ['NGN', 1600], GH: ['GHS', 16], KE: ['KES', 130], UG: ['UGX', 3700], TZ: ['TZS', 2500],
  RW: ['RWF', 1300], ET: ['ETB', 57], ZA: ['ZAR', 18], ZM: ['ZMW', 28], ZW: ['USD', 1],
  MZ: ['MZN', 64], BW: ['BWP', 14], CD: ['CDF', 2800], MA: ['MAD', 10], EG: ['EGP', 48],
  GB: ['GBP', 0.79], US: ['USD', 1],
};
export function countryMoney(country: string) {
  const [code, rate] = COUNTRY_MONEY[country] ?? ['USD', 1];
  return { code, rate };
}
