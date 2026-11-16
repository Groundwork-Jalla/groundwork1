import { describe, expect, it } from 'vitest';
import { currencyDigits, firstInstallmentPercent, installmentInStageCurrency, installmentSplit, installmentSplitFromPercent } from './installment-split';

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

describe('a first installment typed in another currency', () => {
  it('is expressed in the stage currency through the same two USD legs as a receipt', () => {
    // 45,000 NGN at 1,500 NGN/USD is 30 USD; at 600 XAF/USD that is 18,000 XAF.
    expect(installmentInStageCurrency('45000', 1500, '600', 'XAF')).toBe('18000');
    expect(installmentInStageCurrency('30', 1, '600', 'XAF')).toBe('18000');
    expect(installmentInStageCurrency('18000', 600, 1, 'USD')).toBe('30');
  });
  it('rounds to the stage currency\u2019s own minor unit, never to six decimals', () => {
    // The 16 November plan read 138453.873521 XAF. XAF has no minor unit.
    expect(installmentInStageCurrency('315000', 1351.93, '594.3', 'XAF')).toMatch(/^\d+$/);
    expect(installmentInStageCurrency('1000', 1500, 1, 'USD')).toBe('0.67');
    expect(currencyDigits('XAF')).toBe(0); expect(currencyDigits('USD')).toBe(2); expect(currencyDigits('NGN')).toBe(2);
    expect(currencyDigits('not-a-code')).toBe(2);
  });
  it.each([
    ['no rate yet', '45000', null, '600'], ['a zero rate', '45000', 0, '600'], ['a NaN rate', '45000', NaN, '600'],
    ['no stage rate', '45000', 1500, ''], ['a blank amount', '', 1500, '600'], ['text', 'abc', 1500, '600'],
    ['an amount that rounds to nothing', '0.01', 1500, '600'],
  ])('offers nothing to save with %s', (_label, entered, rate, stageRate) => {
    expect(installmentInStageCurrency(entered, rate as number | null, stageRate, 'XAF')).toBeNull();
  });
});
