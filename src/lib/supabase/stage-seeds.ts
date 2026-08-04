// =========================================================
// stage-seeds.ts
// Stage and substage definitions keyed by project + building type.
// getStageSeed() is called at project creation time; it returns
// the exact pipeline for that project — never a one-size-fits-all set.
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
}

// ── Residential Single ────────────────────────────────────
// Covers: single_family, townhouse, semi_detached

function residentialSingleStages(): StageSeed[] {
  return [
    {
      stage_number: 1,
      key: 'landAcquisitionAndDocumentation',
      name: 'Land Acquisition & Documentation',
      budget_pct: 5,
      substages: [
        { key: 'titleVerification', name: 'Title verification' },
        { key: 'surveyPlan', name: 'Survey plan' },
        { key: 'cOfOProcessing', name: 'C of O processing' },
        { key: 'landPurchaseAgreement', name: 'Land purchase agreement' },
      ],
    },
    {
      stage_number: 2,
      key: 'sitePreparationAndFoundation',
      name: 'Site Preparation & Foundation',
      budget_pct: 10,
      substages: [
        { key: 'siteClearing', name: 'Site clearing' },
        { key: 'settingOut', name: 'Setting out' },
        { key: 'excavation', name: 'Excavation' },
        { key: 'foundationConcretePour', name: 'Foundation concrete pour' },
        { key: 'dpcDampProofCourse', name: 'DPC (damp proof course)' },
      ],
    },
    {
      stage_number: 3,
      key: 'blockWorkAndWalls',
      name: 'Block Work & Walls',
      budget_pct: 15,
      substages: [
        { key: 'groundFloorWalls', name: 'Ground floor walls' },
        { key: 'windowDoorLintels', name: 'Window/door lintels' },
        { key: 'firstFloorWallsIfMultiStorey', name: 'First floor walls (if multi-storey)' },
        { key: 'columnsAndBeams', name: 'Columns and beams' },
      ],
    },
    {
      stage_number: 4,
      key: 'deckingAndUpperFloors',
      name: 'Decking & Upper Floors',
      budget_pct: 10,
      substages: [
        { key: 'scaffoldingErection', name: 'Scaffolding erection' },
        { key: 'deckingFormwork', name: 'Decking formwork' },
        { key: 'reinforcementBrcRebar', name: 'Reinforcement (BRC/rebar)' },
        { key: 'concretePour', name: 'Concrete pour' },
        { key: 'curing', name: 'Curing' },
      ],
    },
    {
      stage_number: 5,
      key: 'roofing',
      name: 'Roofing',
      budget_pct: 10,
      substages: [
        { key: 'roofTrussFabrication', name: 'Roof truss fabrication' },
        { key: 'trussInstallation', name: 'Truss installation' },
        { key: 'roofingSheetsTiles', name: 'Roofing sheets/tiles' },
        { key: 'fasciaAndBargeBoard', name: 'Fascia and barge board' },
        { key: 'gutterInstallation', name: 'Gutter installation' },
      ],
    },
    {
      stage_number: 6,
      key: 'plasteringAndScreeding',
      name: 'Plastering & Screeding',
      budget_pct: 10,
      substages: [
        { key: 'internalWallPlastering', name: 'Internal wall plastering' },
        { key: 'externalWallPlastering', name: 'External wall plastering' },
        { key: 'floorScreeding', name: 'Floor screeding' },
        { key: 'popCeilingIfSelected', name: 'POP ceiling (if selected)' },
      ],
    },
    {
      stage_number: 7,
      key: 'electricalAndPlumbing',
      name: 'Electrical & Plumbing',
      budget_pct: 10,
      substages: [
        { key: 'firstFixElectricalConduitsWiring', name: 'First fix electrical (conduits/wiring)' },
        { key: 'firstFixPlumbingPipes', name: 'First fix plumbing (pipes)' },
        { key: 'septicTankSoakaway', name: 'Septic tank/soakaway' },
        { key: 'waterTankInstallation', name: 'Water tank installation' },
      ],
    },
    {
      stage_number: 8,
      key: 'finishing',
      name: 'Finishing',
      budget_pct: 15,
      substages: [
        { key: 'wallTilingKitchenBath', name: 'Wall tiling (kitchen/bath)' },
        { key: 'floorTiling', name: 'Floor tiling' },
        { key: 'paintingInterior', name: 'Painting (interior)' },
        { key: 'paintingExterior', name: 'Painting (exterior)' },
        { key: 'doorInstallation', name: 'Door installation' },
        { key: 'windowInstallation', name: 'Window installation' },
        { key: 'kitchenCabinets', name: 'Kitchen cabinets' },
        { key: 'wardrobeInstallation', name: 'Wardrobe installation' },
      ],
    },
    {
      stage_number: 9,
      key: 'externalWorks',
      name: 'External Works',
      budget_pct: 10,
      substages: [
        { key: 'fenceGateConstruction', name: 'Fence/gate construction' },
        { key: 'drainageChannels', name: 'Drainage channels' },
        { key: 'drivewayParkingPaving', name: 'Driveway/parking paving' },
        { key: 'landscaping', name: 'Landscaping' },
        { key: 'externalLighting', name: 'External lighting' },
      ],
    },
    {
      stage_number: 10,
      key: 'finalInspectionAndHandover',
      name: 'Final Inspection & Handover',
      budget_pct: 5,
      substages: [
        { key: 'secondFixElectricalFixturesSwitches', name: 'Second fix electrical (fixtures/switches)' },
        { key: 'secondFixPlumbingFixturesTaps', name: 'Second fix plumbing (fixtures/taps)' },
        { key: 'generalSnagList', name: 'General snag list' },
        { key: 'finalCleaning', name: 'Final cleaning' },
        { key: 'clientWalkthrough', name: 'Client walkthrough' },
        { key: 'keyHandover', name: 'Key handover' },
      ],
    },
  ];
}

// ── Residential Multi ─────────────────────────────────────
// Covers: multi_family
// Extends residential single with shared/common-area additions
// and per-floor substages scaled to numFloors

function residentialMultiStages(numFloors: number): StageSeed[] {
  const base = residentialSingleStages();
  const floorLabels = Array.from({ length: numFloors }, (_, i) => `Floor ${i + 1} decking`);

  return base.map(stage => {
    switch (stage.stage_number) {
      case 3:
        return {
          ...stage,
          substages: [...stage.substages, 'Staircase construction', 'Common area walls'],
        };
      case 4:
        return {
          ...stage,
          substages: [...stage.substages, ...floorLabels],
        };
      case 7:
        return {
          ...stage,
          substages: [
            ...stage.substages,
            { key: 'commonAreaElectrical', name: 'Common area electrical' },
            { key: 'fireSafetyWiring', name: 'Fire safety wiring' },
            { key: 'boreholeWaterSystem', name: 'Borehole/water system' },
          ],
        };
      case 8:
        return {
          ...stage,
          substages: [...stage.substages, 'Common area finishing', 'Balcony railings'],
        };
      case 9:
        return {
          ...stage,
          substages: [...stage.substages, 'Car park marking', 'Generator house', 'Security post'],
        };
      case 10:
        return {
          ...stage,
          substages: [...stage.substages, 'Per-unit inspection', 'Common area inspection'],
        };
      default:
        return stage;
    }
  });
}

// ── Commercial / Industrial ───────────────────────────────
// Covers: office, retail, warehouse_commercial, hotel,
//         factory, warehouse_industrial, industrial_complex,
//         distribution_centre

function commercialStages(): StageSeed[] {
  return [
    {
      stage_number: 1,
      key: 'landAndPermits',
      name: 'Land & Permits',
      budget_pct: 5,
      substages: [
        { key: 'titleVerification', name: 'Title verification' },
        { key: 'survey', name: 'Survey' },
        { key: 'buildingPermit', name: 'Building permit' },
        { key: 'environmentalAssessment', name: 'Environmental assessment' },
        { key: 'commercialZoningConfirmation', name: 'Commercial zoning confirmation' },
      ],
    },
    {
      stage_number: 2,
      key: 'sitePreparationAndFoundation',
      name: 'Site Preparation & Foundation',
      budget_pct: 12,
      substages: [
        { key: 'siteClearing', name: 'Site clearing' },
        { key: 'soilTesting', name: 'Soil testing' },
        { key: 'excavation', name: 'Excavation' },
        { key: 'pileFoundationIfNeeded', name: 'Pile foundation (if needed)' },
        { key: 'foundationPour', name: 'Foundation pour' },
        { key: 'dpc', name: 'DPC' },
      ],
    },
    {
      stage_number: 3,
      key: 'structuralFrame',
      name: 'Structural Frame',
      budget_pct: 18,
      substages: [
        { key: 'columnErection', name: 'Column erection' },
        { key: 'beamInstallation', name: 'Beam installation' },
        { key: 'floorSlabsPerLevel', name: 'Floor slabs per level' },
        { key: 'structuralSteelIfWarehouse', name: 'Structural steel (if warehouse)' },
        { key: 'loadBearingWalls', name: 'Load-bearing walls' },
      ],
    },
    {
      stage_number: 4,
      key: 'roofingAndWeatherproofing',
      name: 'Roofing & Weatherproofing',
      budget_pct: 8,
      substages: [
        { key: 'roofTrussSteelFrame', name: 'Roof truss/steel frame' },
        { key: 'roofingSheets', name: 'Roofing sheets' },
        { key: 'waterproofingMembrane', name: 'Waterproofing membrane' },
        { key: 'flashingAndGutters', name: 'Flashing and gutters' },
      ],
    },
    {
      stage_number: 5,
      key: 'externalEnvelope',
      name: 'External Envelope',
      budget_pct: 10,
      substages: [
        { key: 'externalCladding', name: 'External cladding' },
        { key: 'curtainWallGlazingIfOffice', name: 'Curtain wall/glazing (if office)' },
        { key: 'rollerShuttersIfWarehouse', name: 'Roller shutters (if warehouse)' },
        { key: 'externalPlastering', name: 'External plastering' },
      ],
    },
    {
      stage_number: 6,
      key: 'mepFirstFix',
      name: 'MEP First Fix',
      budget_pct: 12,
      substages: [
        { key: 'electricalConduitsTrunking', name: 'Electrical conduits/trunking' },
        { key: 'plumbingRisers', name: 'Plumbing risers' },
        { key: 'hvacDuctingIfApplicable', name: 'HVAC ducting (if applicable)' },
        { key: 'fireSuppressionPiping', name: 'Fire suppression piping' },
        { key: 'dataCabling', name: 'Data cabling' },
      ],
    },
    {
      stage_number: 7,
      key: 'internalBuildOut',
      name: 'Internal Build-out',
      budget_pct: 12,
      substages: [
        { key: 'partitionWalls', name: 'Partition walls' },
        { key: 'suspendedCeiling', name: 'Suspended ceiling' },
        { key: 'floorTilingEpoxy', name: 'Floor tiling/epoxy' },
        { key: 'wallFinishes', name: 'Wall finishes' },
        { key: 'staircaseFinishing', name: 'Staircase finishing' },
      ],
    },
    {
      stage_number: 8,
      key: 'mepSecondFix',
      name: 'MEP Second Fix',
      budget_pct: 8,
      substages: [
        { key: 'lightFixtures', name: 'Light fixtures' },
        { key: 'powerOutlets', name: 'Power outlets' },
        { key: 'plumbingFixtures', name: 'Plumbing fixtures' },
        { key: 'hvacUnits', name: 'HVAC units' },
        { key: 'fireAlarmSuppression', name: 'Fire alarm/suppression' },
        { key: 'generatorConnection', name: 'Generator connection' },
      ],
    },
    {
      stage_number: 9,
      key: 'externalWorks',
      name: 'External Works',
      budget_pct: 10,
      substages: [
        { key: 'perimeterFenceWall', name: 'Perimeter fence/wall' },
        { key: 'accessRoad', name: 'Access road' },
        { key: 'parkingLot', name: 'Parking lot' },
        { key: 'signage', name: 'Signage' },
        { key: 'landscaping', name: 'Landscaping' },
        { key: 'securityInfrastructure', name: 'Security infrastructure' },
      ],
    },
    {
      stage_number: 10,
      key: 'complianceAndHandover',
      name: 'Compliance & Handover',
      budget_pct: 5,
      substages: [
        { key: 'fireSafetyInspection', name: 'Fire safety inspection' },
        { key: 'electricalCertification', name: 'Electrical certification' },
        { key: 'buildingInspection', name: 'Building inspection' },
        { key: 'snagListResolution', name: 'Snag list resolution' },
        { key: 'clientWalkthrough', name: 'Client walkthrough' },
        { key: 'keyHandover', name: 'Key handover' },
      ],
    },
  ];
}

// ── Mixed Use ─────────────────────────────────────────────
// Commercial template with residential additions at the
// build-out, MEP second fix, and handover stages

function mixedUseStages(): StageSeed[] {
  const base = commercialStages();
  return base.map(stage => {
    switch (stage.stage_number) {
      case 7:
        return {
          ...stage,
          substages: [...stage.substages, 'Residential unit finishing'],
        };
      case 8:
        return {
          ...stage,
          substages: [...stage.substages, 'Per-unit plumbing/electrical'],
        };
      case 10:
        return {
          ...stage,
          substages: [...stage.substages, 'Residential inspection', 'Commercial inspection'],
        };
      default:
        return stage;
    }
  });
}

// ── Public API ────────────────────────────────────────────

export function getStageSeed(
  projectType: string,
  buildingType: string,
  numFloors: number,
): StageSeed[] {
  switch (projectType) {
    case 'residential':
      return buildingType === 'multi_family'
        ? residentialMultiStages(numFloors)
        : residentialSingleStages();

    case 'commercial':
    case 'industrial':
      return commercialStages();

    case 'mixed_use':
      return mixedUseStages();

    default:
      return residentialSingleStages();
  }
}
