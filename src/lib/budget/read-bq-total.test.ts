import { describe, expect, it } from 'vitest';
import { parseAmount, readBqLineItems, readBqTotal, looksReadable } from './read-bq-total';

/**
 * Reading a bill of quantities.
 *
 * The figure this returns becomes the construction budget, which `decomposeBudget`
 * splits into fees and `apply_budget_milestones` splits across ten stage payments. A
 * wrong number here is the wrong amount of money at every stage — so what matters most
 * in these tests is not that it finds the right total, but that it does not confidently
 * find the WRONG one.
 */

describe('reading an amount out of a cell', () => {
  it.each([
    ['12,500,000.00', 12_500_000],
    ['12.500.000,00', 12_500_000],   // European separators
    ['XAF 12 500 000', 12_500_000],
    ['1,234,567', 1_234_567],        // no decimals: not 1.234567
    ['$1,234.56', 1234.56],
    ['  450000  ', 450_000],
  ])('%s -> %s', (cell, want) => {
    expect(parseAmount(cell)).toBe(want);
  });

  it.each(['', '   ', 'Description', 'N/A', '-', 'item no.'])('%s is not an amount', (cell) => {
    expect(parseAmount(cell)).toBeNull();
  });

  it('refuses zero and negatives, which are never a construction total', () => {
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('0.00')).toBeNull();
  });
});

describe('finding the total', () => {
  it('prefers a row that names itself the grand total', () => {
    const bq = [
      'Item,Description,Qty,Rate,Amount',
      '1,Substructure,1,4500000,4500000',
      '2,Superstructure,1,9000000,9000000',
      'GRAND TOTAL,,,,13500000',
    ].join('\n');
    const r = readBqTotal(bq)!;
    expect(r.total).toBe(13_500_000);
    expect(r.confidence).toBe('grand');
    expect(r.label).toContain('GRAND TOTAL');
  });

  it('is not fooled by a subtotal, a VAT line or a carried-forward row', () => {
    // THE ONE THAT MATTERS. Each of these can be the largest number on the page.
    const bq = [
      'Sub-total,,,,10000000',
      'VAT 19.25%,,,,1925000',
      'Carried to summary,,,,11925000',
      'Grand Total,,,,11925000',
    ].join('\n');
    const r = readBqTotal(bq)!;
    expect(r.label).toMatch(/Grand Total/);
    expect(r.confidence).toBe('grand');
  });

  it('never returns a subtotal as the answer even when there is no grand total', () => {
    const bq = ['Sub-total A,,,,8000000', 'Sub-total B,,,,2000000'].join('\n');
    expect(readBqTotal(bq)).toBeNull();
  });

  it('falls back to the largest figure, and says it is a guess', () => {
    const bq = [
      'Item,Description,Amount',
      '1,Substructure,4500000',
      '2,Superstructure,9000000',
    ].join('\n');
    const r = readBqTotal(bq)!;
    expect(r.total).toBe(9_000_000);
    expect(r.confidence, 'a guess must not be reported as certain').toBe('sum');
  });

  it('handles tabs and semicolons, which is what some exports produce', () => {
    expect(readBqTotal('Grand Total\t\t13500000')!.total).toBe(13_500_000);
    expect(readBqTotal('Grand Total;;13500000')!.total).toBe(13_500_000);
  });

  it('takes the amount column, not the quantity or the rate', () => {
    const bq = 'Grand Total,qty 2,rate 1500,13500000';
    expect(readBqTotal(bq)!.total).toBe(13_500_000);
  });

  it('uses the priced amount column when a unit rate is larger than the line total', () => {
    const bq = [
      'Item\tDescription\tUnit\tQty\tRate\tAmount',
      '1.1\tSpecialist work\titem\t0.1\t15000000\t1500000',
      '1.2\tMaterials\titem\t1\t1200000\t1200000',
    ].join('\n');
    expect(readBqTotal(bq)?.total).toBe(1_500_000);
    expect(readBqLineItems(bq)).toEqual([
      { label: 'Specialist work item', amount: 1_500_000 },
      { label: 'Materials item', amount: 1_200_000 },
    ]);
  });

  it('recognises French quantity-surveyor amount headings', () => {
    const bq = [
      'Désignation;Unité;Quantité;Prix unitaire;Montant',
      'Gros œuvre;m2;0,1;15 000 000;1 500 000',
    ].join('\n');
    expect(readBqTotal(bq)?.total).toBe(1_500_000);
  });

  it('returns nothing for a file it cannot read, rather than inventing a figure', () => {
    expect(readBqTotal('')).toBeNull();
    expect(readBqTotal('Description\nSubstructure\nSuperstructure')).toBeNull();
    expect(readBqTotal('%PDF-1.4 binary junk with no rows')).toBeNull();
  });

  it('refuses a figure too small to be a building', () => {
    // THE ONE THE PDF HEADER EXPOSED. "%PDF-1.4" read as a total of 1.4, which would
    // have become the construction budget and been split across ten stage payments.
    expect(readBqTotal('Grand Total,,,,1.4')).toBeNull();
    expect(readBqTotal('Grand Total,,,,999')).toBeNull();
    expect(readBqTotal('Grand Total,,,,1000')!.total).toBe(1000);
  });

  it('keeps the label short enough to show on one line', () => {
    const long = 'Grand Total ' + 'x'.repeat(500) + ',13500000';
    expect(readBqTotal(long)!.label.length).toBeLessThanOrEqual(120);
  });
});

describe('extracting priced BoQ rows', () => {
  it('keeps individual priced rows and excludes totals and subtotals', () => {
    const text = [
      'Description,Qty,Rate,Amount',
      'Excavation,10,2500,25000',
      'Concrete foundation,4,125000,500000',
      'Sub-total,,,,525000',
      'Grand Total,,,,525000',
    ].join('\n');

    expect(readBqLineItems(text)).toEqual([
      { label: 'Excavation', amount: 25000 },
      { label: 'Concrete foundation', amount: 500000 },
    ]);
  });
});

describe('which files it claims it can read', () => {
  it('claims only delimited text', () => {
    expect(looksReadable('boq.csv')).toBe(true);
    expect(looksReadable('BOQ.TSV')).toBe(true);
    // A native spreadsheet is a ZIP of XML and a PDF may be a scan. Pretending to
    // parse either would be a guess dressed as a reading.
    expect(looksReadable('boq.xlsx')).toBe(false);
    expect(looksReadable('boq.pdf')).toBe(false);
  });
});
