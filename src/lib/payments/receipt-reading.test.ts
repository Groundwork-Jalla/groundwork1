import { describe, expect, it } from 'vitest';
import { canonicalReceiptAmount, matchReceiptReading, MAX_RECEIPT_BYTES, receiptMedia } from './receipt-reading';

const reading = { is_payment_receipt: true, amount: '141407337.524', currency: 'XAF', confidence: 'high' };
describe('receipt matching uses the amount on the document', () => {
  it.each([['00001.000001', '1.000001'], ['0.000001', '0.000001'], ['1000000000000', '1000000000000']])('accepts %s exactly', (input, expected) => {
    expect(canonicalReceiptAmount(input)).toBe(expected);
  });
  it.each(['0', '-1', 'NaN', '1e6', '1,000', '1000000000000.000001', '1.1234567', '', ' '])('rejects ambiguous or unsupported input %s', input => {
    expect(canonicalReceiptAmount(input)).toBeNull();
  });
  it('normalises equal decimals while detecting a one-millionth difference', () => {
    expect(matchReceiptReading(reading, '141407337.524000', 'XAF').status).toBe('matched');
    expect(matchReceiptReading(reading, '141407337.524001', 'XAF')).toEqual({ status: 'amount_mismatch', amount: reading.amount, currency: 'XAF' });
  });
  it('requires a receipt, clear completed-payment amount and explicit matching currency', () => {
    for (const change of [{ is_payment_receipt: false }, { confidence: 'medium' }, { amount: null }, { currency: 'FCFA' }]) {
      expect(matchReceiptReading({ ...reading, ...change }, reading.amount, 'XAF').status).toBe('unreadable');
    }
    expect(matchReceiptReading(reading, reading.amount, 'USD').status).toBe('currency_mismatch');
    expect(matchReceiptReading(null, '1', 'USD').status).toBe('unreadable');
  });
  it('checks file signatures and bounds rather than trusting an extension', () => {
    expect(receiptMedia(Uint8Array.from([137,80,78,71,13,10,26,10]))).toBe('image/png');
    expect(receiptMedia(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf');
    expect(receiptMedia(new TextEncoder().encode('<script>receipt.png</script>'))).toBeNull();
    expect(receiptMedia(new Uint8Array(MAX_RECEIPT_BYTES + 1))).toBeNull();
  });
});
