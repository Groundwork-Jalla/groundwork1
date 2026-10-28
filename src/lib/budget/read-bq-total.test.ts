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
    ['880000.0000000001', 880_000],  // spreadsheet formula floating-point residue
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

  it('uses a plain TOTAL summary row instead of a large section subtotal', () => {
    const bq = [
      'Art. No\tDescription\tUnit\tQuantity\tUnit Price\tTotal',
      '1\tPRELIMINARY WORKS\t\t\t\t',
      '101\tSite Installation\tFF\t1\t250000\t250000',
      '2\tFOUNDATION\t\t\t\t',
      '201\tExcavation\tm3\t49.7\t3000\t149100',
      'TOTAL PREPARATORY WORKS\t\t\t\t\t550000',
      'TOTAL FOUNDATION\t\t\t\t\t4619200',
      'TOTAL GROUND FLOOR ELEVATION\t\t\t\t\t14119650',
      'TOTAL FIRST FLOOR ELEVATION\t\t\t\t\t11674380',
      'TOTAL ROOF STRUSS AND COVERING\t\t\t\t\t6006200',
      'TOTAL WOOD AND METAL WORKS\t\t\t\t\t4187130',
      'TOTAL ELECTRICITY\t\t\t\t\t2326600',
      'TOTAL PLUMBING AND SANITARY FIXTURES\t\t\t\t\t6450000',
      'TOTAL PAINTING\t\t\t\t\t9742120',
      '\tTOTAL\t\t59675280',
    ].join('\n');

    const reading = readBqTotal(bq)!;
    expect(reading.total).toBe(59_675_280);
    expect(reading.confidence).toBe('grand');
    expect(reading.label).toContain('TOTAL');
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

describe('a bill that separates materials from what is payable', () => {
  /**
   * Mr Nas, G+1, Limbe — a real estimate, read on 28 October.
   *
   * Its summary totals the trade sections and calls that "TOTAL". Labour and
   * transport are added BELOW it, and the contract sum is "NET PAYABLE", spelled out
   * in words underneath so a reader cannot mistake it. Reading the first of those
   * understated the bill by 7,650,000 — 28.7% — at `grand` confidence, which is the
   * confidence that carries a figure into the budget without anyone retyping it.
   */
  const MR_NAS = [
    'SUMMARY',
    '100: PRELIMINARY WORKS\t62,500',
    '200: EARTH WORKS\t170,000',
    '300: FOUNDATION\t2,966,628',
    '400: WALL MASONARY\t3,569,300',
    '500: DECKING OF UPPER FLOOR\t1,013,000',
    '550: WALL MASONARY OF UPPER FLOOR\t3,155,600',
    '600: ROOF\t681,200',
    '700: METAL WORKS\t4,995,000',
    '800: ELECTRICAL INSTALLATIONS\t418,600',
    '850: SANITARY INSTALLATIONS\t1,012,000',
    '900: PAINTING\t190,900',
    '1000: EXTERNAL WORKS\t803,000',
    'TOTAL\t19,037,728',
    'LABOUR COST\t7,500,000',
    'TRANSPORTATION\t150,000',
    'NET PAYABLE\t26,687,728',
  ].join('\n');

  it('reads what the contractor is owed, not the materials subtotal', () => {
    const reading = readBqTotal(MR_NAS);
    expect(reading?.total).toBe(26687728);
    expect(reading?.label).toMatch(/NET PAYABLE/i);
  });

  it('and is confident about it, because the document names the row', () => {
    expect(readBqTotal(MR_NAS)?.confidence).toBe('grand');
  });

  it('the materials line alone is still the total when nothing follows it', () => {
    // The bare-"total" rule is not being removed — a bill whose last word really is
    // TOTAL still reads it. The payable line only wins where one exists.
    const materialsOnly = MR_NAS.split('\nLABOUR COST')[0];
    expect(readBqTotal(materialsOnly)?.total).toBe(19037728);
  });

  it.each([
    ['NET PAYABLE\t26,687,728', 26687728],
    ['TOTAL PAYABLE\t26,687,728', 26687728],
    ['AMOUNT PAYABLE\t26,687,728', 26687728],
    ['NET A PAYER\t26,687,728', 26687728],
    ['MONTANT NET\t26,687,728', 26687728],
  ])('%s wins over a bare TOTAL above it', (line, expected) => {
    expect(readBqTotal(`TOTAL\t19,037,728\n${line}`)?.total).toBe(expected);
  });
});
