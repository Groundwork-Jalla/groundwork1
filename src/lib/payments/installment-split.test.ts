import { describe, expect, it } from 'vitest';
import { currencyDigits, firstInstallmentPercent, installmentSplit, installmentSplitFromPercent } from './installment-split';

describe('custom installment splits', () => {
  it.each([['30','18000','42000'],['70','42000','18000'],['25','15000','45000']])('uses %s percent instead of assuming equal halves', (percent, first, second) => {
    expect(installmentSplitFromPercent('60000',percent)).toEqual({first,second});
  });
  it('keeps the remainder exact after rounding the first payment to supported precision', () => {
    expect(installmentSplitFromPercent('141407337.524','33.333333')).toEqual({first:'47135778.703309',second:'94271558.820691'});
    expect(installmentSplitFromPercent('0.000003','50')).toEqual({first:'0.000002',second:'0.000001'});
    expect(installmentSplit('60000','20000')).toEqual({first:'20000',second:'40000'});
    expect(firstInstallmentPercent('60000','20000')).toBe('33.333333');
  });
  it.each(['0','100','101','-1','NaN','Infinity','30%','0.0000001'])('refuses an invalid percentage %s', percent => {
    expect(installmentSplitFromPercent('60000',percent)).toBeNull();
  });
  it('requires a positive amount for each installment without inventing money on tiny stages', () => {
    expect(installmentSplitFromPercent('0.000001','50')).toBeNull();
    expect(installmentSplitFromPercent('0','30')).toBeNull();
    expect(installmentSplit('60000','60000')).toBeNull();
    expect(installmentSplit('60000','0')).toBeNull();
  });
});

describe('rounding a split to the stage currency', () => {
  it('knows each currency\u2019s own minor unit', () => {
    expect(currencyDigits('XAF')).toBe(0); expect(currencyDigits('USD')).toBe(2); expect(currencyDigits('NGN')).toBe(2);
    expect(currencyDigits('not-a-code')).toBe(2);
  });
});
