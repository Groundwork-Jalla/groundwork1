import { describe, expect, it } from 'vitest';
import { installmentSplit } from './installment-split';

// The client types the first installment as an amount; there are no percentage inputs
// (17 Nov stand-up: percentages were too much arithmetic for a client at checkout).
describe('custom installment splits', () => {
  it('keeps the remainder exact', () => {
    expect(installmentSplit('60000','20000')).toEqual({first:'20000',second:'40000'});
    expect(installmentSplit('141407337.524','47135778.703309')).toEqual({first:'47135778.703309',second:'94271558.820691'});
  });
  it('requires a positive amount for each installment', () => {
    expect(installmentSplit('60000','60000')).toBeNull();
    expect(installmentSplit('60000','70000')).toBeNull();
    expect(installmentSplit('60000','0')).toBeNull();
  });
});
