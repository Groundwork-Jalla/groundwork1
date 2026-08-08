// =========================================================
// stage-seeds.ts
//
// The 10 build stages and 60 substages, as specified and approved by Vanessa
// (construction consultant). getStageSeed() is called once at project creation
// and returns the pipeline that project will keep for its whole life.
//
// The sequence is not arbitrary — it encodes four rules from the spec:
//   · Legal before physical      — title and permits first; a defective wall can
//                                  be rebuilt, a plot you do not own cannot.
//   · Load path from the ground  — foundation, frame, then infill. A cast element
//                                  is corrected by demolition, not adjustment.
//   · Weatherproof before interiors — roofing precedes services and finishing so a
//                                  rainy season cannot destroy paid-for work.
//   · Concealed work before it is concealed — electrical and plumbing run while
//                                  walls are open; afterwards every change is a
//                                  chase cut at several times the cost.
//
// All four project types share this pipeline. The sequence is argued from build
// physics and law, which do not change for a warehouse, and maintaining divergent
// models across 60 substages x 2 languages is where drift creeps in. Multi-floor
// residential layers extra substages on top rather than forking the model.
//
// Budget shares total exactly 100%. Substages total exactly 60. Both are asserted
// by the unit test in stage-seeds.test.ts — change them there too, deliberately.
// =========================================================

export interface StageSeed {
  stage_number: number;
  /** Stable i18n key. Rendered as t(`stages.${key}`); `name` is the fallback. */
  key: string;
  /** English display name. Still persisted, as an audit trail and render fallback. */
  name: string;
  budget_pct: number;
  substages: SubstageSeed[];
}

export interface SubstageSeed {
  /** Stable i18n key — t(`substages.${key}`). */
  key: string;
  name: string;
  /** Interpolation values, for keys like `floorDecking` that carry a number. */
  params?: Record<string, string | number>;
}

// ── The canonical pipeline ────────────────────────────────

function baseStages(): StageSeed[] {
  return [
    {
      stage_number: 1,
      key: 'landSecured',
      name: 'Land Secured',
      budget_pct: 5,
      substages: [
        { key: 'engageSurveyor',        name: 'Engage surveyor' },
        { key: 'verifyLandTitle',       name: 'Verify land title' },
        { key: 'engageNotary',          name: 'Engage notary/lawyer' },
        { key: 'paymentByBankTransfer', name: 'Payment by bank transfer' },
        { key: 'landTitleTransfer',     name: 'Land title transfer' },
      ],
    },
    {
      stage_number: 2,
      key: 'designCompleted',
      name: 'Design Completed',
      budget_pct: 10,
      substages: [
        { key: 'soilTest',                 name: 'Soil test' },
        { key: 'architecturalPlans',       name: 'Architectural plans' },
        { key: 'structuralPlan',           name: 'Structural plan' },
        { key: 'planAuthorization',        name: 'Plan authorization' },
        { key: 'buildingPermitApplication', name: 'Building permit application' },
      ],
    },
    {
      stage_number: 3,
      key: 'sitePreparation',
      name: 'Site Preparation',
      budget_pct: 5,
      substages: [
        { key: 'energySupply',             name: 'Energy supply' },
        { key: 'waterSupply',              name: 'Water supply' },
        { key: 'clearingAndLeveling',      name: 'Clearing and leveling' },
        { key: 'magazineConstruction',     name: 'Magazine construction' },
        { key: 'siteMaterialsProcurement', name: 'Site materials procurement' },
      ],
    },
    {
      stage_number: 4,
      key: 'foundation',
      name: 'Foundation',
      budget_pct: 15,
      substages: [
        { key: 'excavationPitsTrenches',           name: 'Excavation of pits and trenches' },
        { key: 'backfill',                         name: 'Backfill' },
        { key: 'leanConcrete',                     name: 'Lean concrete' },
        { key: 'reinforcedConcreteFootings',       name: 'Reinforced concrete footings' },
        { key: 'foundationPillarsBeams',           name: 'Foundation pillars and beams' },
        { key: 'foundationFloorSlab',              name: 'Floor slab' },
        { key: 'foundationBlocksPolystyreneSand',  name: 'Foundation blocks + polystyrene + sand layer' },
      ],
    },
    {
      stage_number: 5,
      key: 'structureWalls',
      name: 'Structure & Walls',
      budget_pct: 20,
      substages: [
        { key: 'pillars',                     name: 'Pillars' },
        { key: 'beamsAndLintels',             name: 'Beams and lintels' },
        { key: 'staircase',                   name: 'Staircase' },
        { key: 'structureFloorSlab',          name: 'Floor slab' },
        { key: 'blockWalls',                  name: 'Block walls' },
        { key: 'internalExternalPlastering',  name: 'Internal and external plastering' },
        { key: 'mortarFlooringTiles',         name: 'Mortar flooring and tiles' },
        { key: 'wallTilesDecorativePlaster',  name: 'Wall tiles and decorative plaster' },
      ],
    },
    {
      stage_number: 6,
      key: 'roofing',
      name: 'Roofing',
      budget_pct: 10,
      substages: [
        { key: 'hardwoodTrussAssembly',   name: 'Hardwood truss assembly' },
        { key: 'purlinInstallation',      name: 'Purlin installation' },
        { key: 'roofingSheetInstallation', name: 'Roofing sheet installation' },
        { key: 'roofAccessoriesFinishing', name: 'Accessories and finishing' },
      ],
    },
    {
      stage_number: 7,
      key: 'electricalPlumbing',
      name: 'Electrical & Plumbing',
      budget_pct: 10,
      substages: [
        { key: 'electricalConduitCabling',    name: 'Electrical conduit and cabling' },
        { key: 'switchesSocketsJunctionBoxes', name: 'Switches, sockets, junction boxes' },
        { key: 'lightingFixtures',            name: 'Lighting fixtures and chandelier' },
        { key: 'meterInstallation',           name: 'Meter installation' },
        { key: 'electricalAccessories',       name: 'Electrical accessories' },
        { key: 'waterSupplySystem',           name: 'Water supply system' },
        { key: 'drainageSystem',              name: 'Drainage system' },
        { key: 'sanitaryFixtures',            name: 'Sanitary fixtures' },
        { key: 'kitchenSinkDrainage',         name: 'Kitchen sink and drainage' },
        { key: 'septicTankSoakAway',          name: 'Septic tank and soak-away pit' },
      ],
    },
    {
      stage_number: 8,
      key: 'finishing',
      name: 'Finishing',
      budget_pct: 10,
      substages: [
        { key: 'woodenDoors',                name: 'Wooden doors' },
        { key: 'aluminiumGlassWindows',      name: 'Aluminium and glass windows' },
        { key: 'ironRailings',               name: 'Iron railings' },
        { key: 'surfacePreparationPainting', name: 'Surface preparation for painting' },
        { key: 'externalPaint',              name: 'External paint' },
        { key: 'internalPaint',              name: 'Internal paint' },
        { key: 'ceilingPaintWoodVarnish',    name: 'Ceiling paint and wood varnish' },
        { key: 'decorationContingencies',    name: 'Decoration and contingencies' },
      ],
    },
    {
      stage_number: 9,
      key: 'exteriorWork',
      name: 'Exterior Work',
      budget_pct: 10,
      substages: [
        { key: 'exteriorLightingDesign', name: 'Exterior lighting design' },
        { key: 'waterFeatures',          name: 'Water features' },
        { key: 'exteriorFlooring',       name: 'Flooring' },
        { key: 'fencing',                name: 'Fencing' },
        { key: 'gardenSeating',          name: 'Garden and seating' },
      ],
    },
    {
      stage_number: 10,
      key: 'finalHandover',
      name: 'Final Handover',
      budget_pct: 5,
      substages: [
        { key: 'fullSystemInspection',       name: 'Full system inspection and verification' },
        { key: 'furnishingCoordination',     name: 'Furnishing coordination' },
        { key: 'handoverKeysDocumentation',  name: 'Handover of keys and documentation' },
      ],
    },
  ];
}

// ── Multi-floor residential ───────────────────────────────
// Layers extra substages onto the canonical pipeline rather than forking it,
// so a change to the base sequence reaches every project type.

function residentialMultiStages(numFloors: number): StageSeed[] {
  // Dynamic per-floor substage. Carries the floor number as an interpolation param so
  // the dictionary can order the words differently per language.
  const floorLabels: SubstageSeed[] = Array.from({ length: numFloors }, (_, i) => ({
    key: 'floorDecking',
    params: { n: i + 1 },
    name: `Floor ${i + 1} decking`,
  }));

  return baseStages().map(stage => {
    switch (stage.stage_number) {
      case 5: // Structure & Walls — the frame carries the extra floors
        return {
          ...stage,
          substages: [
            ...stage.substages,
            ...floorLabels,
            { key: 'commonAreaWalls', name: 'Common area walls' },
          ],
        };
      case 7: // Electrical & Plumbing
        return {
          ...stage,
          substages: [
            ...stage.substages,
            { key: 'commonAreaElectrical', name: 'Common area electrical' },
            { key: 'fireSafetyWiring',     name: 'Fire safety wiring' },
            { key: 'boreholeWaterSystem',  name: 'Borehole/water system' },
          ],
        };
      case 8: // Finishing
        return {
          ...stage,
          substages: [
            ...stage.substages,
            { key: 'commonAreaFinishing', name: 'Common area finishing' },
            { key: 'balconyRailings',     name: 'Balcony railings' },
          ],
        };
      case 9: // Exterior Work
        return {
          ...stage,
          substages: [
            ...stage.substages,
            { key: 'carParkMarking',  name: 'Car park marking' },
            { key: 'generatorHouse',  name: 'Generator house' },
            { key: 'securityPost',    name: 'Security post' },
          ],
        };
      case 10: // Final Handover
        return {
          ...stage,
          substages: [
            ...stage.substages,
            { key: 'perUnitInspection',    name: 'Per-unit inspection' },
            { key: 'commonAreaInspection', name: 'Common area inspection' },
          ],
        };
      default:
        return stage;
    }
  });
}

export function getStageSeed(
  projectType: string,
  buildingType: string,
  numFloors: number,
): StageSeed[] {
  // Commercial, industrial and mixed-use share the canonical pipeline: the
  // sequence is argued from build physics and law, which do not change by
  // building type. Only multi-floor residential adds to it.
  if (projectType === 'residential' && buildingType === 'multi_family') {
    return residentialMultiStages(numFloors);
  }
  return baseStages();
}
