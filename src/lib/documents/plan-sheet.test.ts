import { describe, it, expect } from 'vitest';
import { classifySheet, readPlanDocument, readUpload } from './plan-sheet';

// =========================================================
// Every fixture here is text from a real file in production on 9 Nov 2026, shortened.
// Invented samples would only prove the regexes match themselves; these drawings are
// the ones the platform actually has to read, and two of them are why this module
// exists at all.
// =========================================================

/** A drawing's own signature: a scale, and dimension strings one per line. */
const DIMS = ['3.15', '2.15', '4.35', '1.20', '10.30', '21.25', '4.95', '3.40', '1.05', '2.50']
  .join('\n');
const sheet = (body: string) => `${body}\n${DIMS}\n1 : 50\n`;

describe('classifySheet — what the title block says', () => {
  it("reads Mr Nas's ground plan as a floor plan", () => {
    const out = classifySheet(sheet('Sitting Room\nKitchen\nBed Room2\nVERANDA\nGROUND PLAN'));
    expect(out.kind).toBe('floor_plan');
    expect(out.basis.join(' ')).toMatch(/GROUND PLAN/i);
  });

  it('reads "PLAN ETAGE 2 ET 3" as a floor plan', () => {
    expect(classifySheet(sheet('CHAMBRE 1\nSALON\nCUISINE\nPLAN  ETAGE 2 ET 3')).kind)
      .toBe('floor_plan');
  });

  it('reads a foundation plan as a foundation, not a floor plan', () => {
    // R15.pdf. Drawn in plan view, full of dimensions, and not what anyone means.
    expect(classifySheet(sheet('P1 P2 P3 S1 S2 S3\nPLAN  DE FONDATION')).kind)
      .toBe('foundation');
  });

  it('reads a site layout as a site plan, not a floor plan', () => {
    // The Youpwe wharf: a quay, a crane, a commercial block — drawn in plan view.
    expect(classifySheet(sheet("KLOE SHIPPING\nGrue\nZone d'accostage\nBatiment Commercial"
      + "\nPLAN D'AMENAGEMENT    E 1/500")).kind).toBe('site_plan');
  });

  it('reads an implantation as a site plan', () => {
    // HIPE PROPOSED PLAN 2.pdf — footprints of an R+5 and an R+3, nothing inside them.
    expect(classifySheet(sheet('IMMEUBLE A R+5\n429 m2\nROUE DE 8m\nIMPLANTATION 1')).kind)
      .toBe('site_plan');
  });

  it('reads formwork as structural even when the sheet is titled a plan', () => {
    // "PLAN DE COFFRAGE RADIER" — a plan of a raft, which is still a structural sheet.
    expect(classifySheet(sheet('PLAN DE COFFRAGE RADIER\nPoteau naissant')).kind)
      .toBe('structural');
  });

  it('reads reinforcement sheets as structural', () => {
    expect(classifySheet(sheet('FERRAILLAGE POUTRE\n3HA10\n1HA10')).kind).toBe('structural');
  });

  it('reads elevations as elevations', () => {
    expect(classifySheet(sheet('ELEVATION VIEWS\nEast\nNorth\nWest\nSouth')).kind)
      .toBe('elevation');
  });

  it('does not let a section"s level legend make it a foundation plan', () => {
    // Page 9 of the Kalla set: a section whose legend lists -1 FONDATION, 0 RDC, 1 ETAGE.
    expect(classifySheet(sheet('1 ETAGE\n0 RDC\n-1 FONDATION\n2 TOITURE\nCOUPE A - A')).kind)
      .toBe('section');
  });
});

describe('classifySheet — room labels, when the title block flattened', () => {
  it('reads a laid-out interior as a floor plan with no title at all', () => {
    // Page 3 of the Kalla duplex: the only title on the sheet is its scale.
    const out = classifySheet('SEJOUR\nSALON STUDIO\nCUISINE\nBIBLIOTHEQUE\nTOIL.\nGARAGE'
      + '\nBALCON\nECHELLE: 1/100è');
    expect(out.kind).toBe('floor_plan');
    expect(out.basis.length).toBeGreaterThan(1);
  });

  it('needs more than one family of room', () => {
    // A door schedule listing "CHAMBRE 1, CHAMBRE 2" names one kind of thing.
    expect(classifySheet(sheet('CHAMBRE 1\nCHAMBRE 2\nCHAMBRE 3')).kind).not.toBe('floor_plan');
  });

  it('needs at least one room somebody occupies', () => {
    // Terraces and a hall alone describe circulation, which a roof or site plan also has.
    expect(classifySheet(sheet('TERRASSE\nBALCON\nHALL')).kind).not.toBe('floor_plan');
  });
});

describe('classifySheet — a bill of quantities is not a drawing', () => {
  /*
   * The regression these two guard. Both files are filed as `boq` in production and
   * both came back as FLOOR PLANS before the drawing gate existed, because a bill names
   * every room in the building — one in prose, one in priced rows.
   */
  it('does not read a devis descriptif as a floor plan', () => {
    const devis = [
      '3-Etages 2 et 3 :',
      'Ils comportent 03 appartements :',
      'Appartement 1 :',
      "  01 Salon d'une superficie de 25,01m2",
      '  01 salle à manger de 7,95m2',
      '  01 cuisine de 6,50m2',
      '  01 chambre principale de 17,02m2',
      '  01 chambre secondaire de 9,88m2',
      'Le présent devis descriptif a pour but de définir la consistance et le mode',
      "d'exécution des travaux à réaliser pour la construction d'un R+3 à usage mixte.",
    ].join('\n');
    expect(classifySheet(devis).kind).toBe('unknown');
    expect(readPlanDocument([devis]).isFloorPlan).toBe(false);
  });

  it('does not read a priced bill"s rows as a floor plan', () => {
    const bill = [
      'DESIGNATION', 'QTE', 'P.U.', 'MONTANT',
      'Enduit interieur Kitchen', '12.50', '4 500', '56 250',
      'Carrelage WC', '6.00', '8 000', '48 000',
      'Peinture Sitting Room', '28.00', '2 500', '70 000',
      'TOTAL GENERAL', '174 250', 'FCFA',
    ].join('\n');
    expect(classifySheet(bill).kind).toBe('unknown');
  });

  it("does not read a devis chapter heading as the sheet's title", () => {
    // A written specification has chapters called IMPLANTATION and CHARPENTE. They are
    // chapters about the work, not drawings of it.
    const spec = 'CHAPITRE III - IMPLANTATION ET FOUILLES\nCHAPITRE VII - CHARPENTE ET '
      + 'COUVERTURE\nLes fouilles seront exécutées conformément aux plans '
      + "d'exécution et aux indications du bureau d'études techniques.";
    expect(classifySheet(spec).kind).toBe('unknown');
  });
});

describe('readPlanDocument — a set is one upload and many sheets', () => {
  it('finds the plan inside a ten-sheet set and says what else is in it', () => {
    const out = readPlanDocument([
      sheet('REPUBLIQUE DU CAMEROUN\nPROJET DE CONSTRUCTION'),
      sheet('IMPLANTATION\nECHELLE: 1/200è'),
      sheet('SEJOUR\nCUISINE\nTOIL.\nBALCON'),
      sheet('CHAMBRE 1\nCHAMBRE 2\nTOIL.\nBALCON'),
      sheet('PLAN DE FONDATION'),
      sheet('PLAN DE TOITURE'),
      sheet('FACADE PRINCIPALE'),
      sheet('FACADE GAUCHE\nFACADE DROITE'),
      sheet('COUPE A - A'),
      sheet('CUISINE\nSEJOUR\nSALON STUDIO\nTOIL.'),
    ]);
    expect(out.isFloorPlan).toBe(true);
    expect(out.contains).toContain('site_plan');
    expect(out.contains).toContain('elevation');
    expect(out.sheets).toHaveLength(10);
  });

  it('is not a floor plan when every sheet is structural', () => {
    // The 35-sheet Toko set: formwork and reinforcement, cover to cover.
    const out = readPlanDocument(Array.from({ length: 35 }, () => sheet('FERRAILLAGE\n3HA10')));
    expect(out.isFloorPlan).toBe(false);
    expect(out.contains).toEqual(['structural']);
  });

  it('reports an empty file as containing nothing, not as a negative', () => {
    const out = readPlanDocument(['', '']);
    expect(out.isFloorPlan).toBe(false);
    expect(out.contains).toEqual(['unknown']);
  });
});

describe('the two readers see the same sheet', () => {
  /*
   * `pdftotext` emits one dimension per line; the browser extractor groups text items by
   * their printed Y and joins each line with tabs. The SAME drawing therefore arrives in
   * two shapes, and a gate that only counted newlines would pass it on the server and
   * reject it in the wizard.
   */
  const ROOMS = 'Sitting Room\tKitchen\tBed Room2\tVERANDA';
  const CHAIN = '3.15\t2.15\t2.15\t3.15\t1.35\t1.50\t3.15\t1.35\t3.15\t10.30\t21.25\t4.95';

  it('reads it as a drawing when every dimension is on its own line', () => {
    expect(classifySheet(`${ROOMS.replace(/\t/g, '\n')}\n${CHAIN.replace(/\t/g, '\n')}`).kind)
      .toBe('floor_plan');
  });

  it('reads it as a drawing when the dimensions are tab-joined on one line', () => {
    expect(classifySheet(`${ROOMS}\n${CHAIN}`).kind).toBe('floor_plan');
  });

  it('still refuses a bill whose rows are tab-separated', () => {
    const bill = [
      'DESIGNATION\tQTE\tP.U.\tMONTANT',
      'Enduit interieur Kitchen\t12.50\t4 500\t56 250',
      'Carrelage WC\t6.00\t8 000\t48 000',
      'Peinture Sitting Room\t28.00\t2 500\t70 000',
      'Chape Chambre 1\t15.00\t3 200\t48 000',
      'TOTAL GENERAL\t222 250\tFCFA',
    ].join('\n');
    expect(classifySheet(bill).kind).toBe('unknown');
  });
});

describe('readUpload — what the whole upload amounts to', () => {
  const plan = { isFloorPlan: true, sheets: [{ kind: 'floor_plan' as const, basis: ['GROUND PLAN'] }] };
  const site = { isFloorPlan: false, sheets: [{ kind: 'site_plan' as const, basis: ['IMPLANTATION'] }] };
  const rebar = { isFloorPlan: false, sheets: [{ kind: 'structural' as const, basis: ['FERRAILLAGE'] }] };

  it('is satisfied by one floor plan among several drawings', () => {
    expect(readUpload([site, plan, rebar]).hasFloorPlan).toBe(true);
  });

  it('names what was uploaded instead when none of them is a plan', () => {
    const out = readUpload([site, rebar]);
    expect(out.hasFloorPlan).toBe(false);
    expect(out.insteadFound).toEqual(['site_plan', 'structural']);
  });

  it('calls an unreadable upload unreadable, never "not a floor plan"', () => {
    // A photographed drawing. We did not find out, which is not the same as a no.
    const out = readUpload([{}]);
    expect(out.unreadable).toBe(true);
    expect(out.insteadFound).toEqual([]);
  });

  it('says nothing at all about an empty upload', () => {
    expect(readUpload([])).toEqual({ hasFloorPlan: false, insteadFound: [], unreadable: false });
  });

  it('leaves out sheets it could not identify', () => {
    const mixed = { isFloorPlan: false, sheets: [
      { kind: 'unknown' as const, basis: [] },
      { kind: 'elevation' as const, basis: ['FACADE'] },
    ] };
    expect(readUpload([mixed]).insteadFound).toEqual(['elevation']);
  });
});
