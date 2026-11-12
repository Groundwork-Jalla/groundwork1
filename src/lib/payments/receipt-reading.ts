export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

/** Compare receipt amounts in integer millionths, including very small payments. */
export function canonicalReceiptAmount(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d{1,13}(?:\.\d{1,6})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (units <= 0n || units > 1_000_000_000_000_000_000n) return null;
  const tail = (units % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${units / 1_000_000n}${tail ? `.${tail}` : ''}`;
}

export type ReceiptMatch = { status: 'matched' | 'amount_mismatch' | 'currency_mismatch'; amount: string; currency: string }
  | { status: 'unreadable' | 'not_receipt' | 'payment_not_completed' };
export function matchReceiptReading(reading: unknown, entered: string, currency: string): ReceiptMatch {
  const value = reading as { amount?: unknown; currency?: unknown; confidence?: unknown; is_payment_receipt?: unknown; document_status?: unknown } | null;
  if (value?.document_status === 'not_receipt') return { status: 'not_receipt' };
  if (value?.document_status === 'payment_not_completed') return { status: 'payment_not_completed' };
  if (value?.document_status === 'unreadable') return { status: 'unreadable' };
  if (value?.is_payment_receipt === false && value.confidence === 'high') return { status: 'not_receipt' };
  const amount = canonicalReceiptAmount(value?.amount);
  if (!amount || value?.confidence !== 'high' || value.is_payment_receipt !== true
    || typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)) return { status: 'unreadable' };
  if (currency !== value.currency) return { status: 'currency_mismatch', amount, currency: value.currency };
  return { status: amount === canonicalReceiptAmount(entered) ? 'matched' : 'amount_mismatch', amount, currency: value.currency };
}

/** Inspect bytes rather than trusting the file extension or caller's MIME type. */
export function receiptMedia(bytes: Uint8Array): 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES) return null;
  const head = String.fromCharCode(...bytes.slice(0, 12));
  if (head.startsWith('%PDF-')) return 'application/pdf';
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  return head.startsWith('RIFF') && head.slice(8,12) === 'WEBP' ? 'image/webp' : null;
}
