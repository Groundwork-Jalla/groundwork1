/** Transaction currencies used by Groundwork projects and common client payment accounts. */
export const RECEIPT_CURRENCIES = [
  'USD', 'XAF', 'XOF', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'JPY', 'SGD', 'AED',
  'NGN', 'GHS', 'KES', 'UGX', 'TZS', 'RWF', 'ETB', 'ZAR', 'ZMW', 'MZN', 'BWP', 'CDF', 'MAD', 'EGP',
] as const;
export type ReceiptCurrency = typeof RECEIPT_CURRENCIES[number];
export function isReceiptCurrency(value: unknown): value is ReceiptCurrency {
  return typeof value === 'string' && (RECEIPT_CURRENCIES as readonly string[]).includes(value);
}
export function receiptCurrencyChoices(projectCurrency: string): readonly string[] {
  return /^[A-Z]{3}$/.test(projectCurrency) ? [projectCurrency, ...RECEIPT_CURRENCIES.filter(code => code !== projectCurrency)]
    : RECEIPT_CURRENCIES;
}
