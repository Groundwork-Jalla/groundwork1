// =========================================================
// stage-seeds.ts
// Stage and substage definitions keyed by project + building type.
// getStageSeed() is called at project creation time; it returns
// the exact pipeline for that project — never a one-size-fits-all set.
// =========================================================

export interface StageSeed {
  stage_number: number;
  name: string;
  budget_pct: number;
  substages: string[];
}

// ── Residential Single ────────────────────────────────────
// Covers: single_family, townhouse, semi_detached

function residentialSingleStages(): StageSeed[] {
  return [
    {
      stage_number: 1,
      name: 'Land Acquisition & Documentation',
      budget_pct: 5,
      substages: [
        'Title verification',
        'Survey plan',
        'C of O processing',
        'Land purchase agreement',
      ],
    },
    {
      stage_number: 2,
      name: 'Site Preparation & Foundation',
      budget_pct: 10,
      substages: [
        'Site clearing',
        'Setting out',
        'Excavation',
        'Foundation concrete pour',
        'DPC (damp proof course)',
      ],
    },
    {
      stage_number: 3,
      name: 'Block Work & Walls',
      budget_pct: 15,
      substages: [
        'Ground floor walls',
        'Window/door lintels',
        'First floor walls (if multi-storey)',
        'Columns and beams',
      ],
    },
    {
      stage_number: 4,
      name: 'Decking & Upper Floors',
      budget_pct: 10,
      substages: [
        'Scaffolding erection',
        'Decking formwork',
        'Reinforcement (BRC/rebar)',
        'Concrete pour',
        'Curing',
      ],
    },
    {
      stage_number: 5,
      name: 'Roofing',
      budget_pct: 10,
      substages: [
        'Roof truss fabrication',
        'Truss installation',
        'Roofing sheets/tiles',
        'Fascia and barge board',
        'Gutter installation',
      ],
    },
    {
      stage_number: 6,
      name: 'Plastering & Screeding',
      budget_pct: 10,
      substages: [
        'Internal wall plastering',
        'External wall plastering',
        'Floor screeding',
        'POP ceiling (if selected)',
      ],
    },
    {
      stage_number: 7,
      name: 'Electrical & Plumbing',
      budget_pct: 10,
      substages: [
        'First fix electrical (conduits/wiring)',
        'First fix plumbing (pipes)',
        'Septic tank/soakaway',
        'Water tank installation',
      ],
    },
    {
      stage_number: 8,
      name: 'Finishing',
      budget_pct: 15,
      substages: [
        'Wall tiling (kitchen/bath)',
        'Floor tiling',
        'Painting (interior)',
        'Painting (exterior)',
        'Door installation',
        'Window installation',
        'Kitchen cabinets',
        'Wardrobe installation',
      ],
    },
    {
      stage_number: 9,
      name: 'External Works',
      budget_pct: 10,
      substages: [
        'Fence/gate construction',
        'Drainage channels',
        'Driveway/parking paving',
        'Landscaping',
        'External lighting',
      ],
    },
    {
      stage_number: 10,
      name: 'Final Inspection & Handover',
      budget_pct: 5,
      substages: [
        'Second fix electrical (fixtures/switches)',
        'Second fix plumbing (fixtures/taps)',
        'General snag list',
        'Final cleaning',
        'Client walkthrough',
        'Key handover',
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
            'Common area electrical',
            'Fire safety wiring',
            'Borehole/water system',
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
      name: 'Land & Permits',
      budget_pct: 5,
      substages: [
        'Title verification',
        'Survey',
        'Building permit',
        'Environmental assessment',
        'Commercial zoning confirmation',
      ],
    },
    {
      stage_number: 2,
      name: 'Site Preparation & Foundation',
      budget_pct: 12,
      substages: [
        'Site clearing',
        'Soil testing',
        'Excavation',
        'Pile foundation (if needed)',
        'Foundation pour',
        'DPC',
      ],
    },
    {
      stage_number: 3,
      name: 'Structural Frame',
      budget_pct: 18,
      substages: [
        'Column erection',
        'Beam installation',
        'Floor slabs per level',
        'Structural steel (if warehouse)',
        'Load-bearing walls',
      ],
    },
    {
      stage_number: 4,
      name: 'Roofing & Weatherproofing',
      budget_pct: 8,
      substages: [
        'Roof truss/steel frame',
        'Roofing sheets',
        'Waterproofing membrane',
        'Flashing and gutters',
      ],
    },
    {
      stage_number: 5,
      name: 'External Envelope',
      budget_pct: 10,
      substages: [
        'External cladding',
        'Curtain wall/glazing (if office)',
        'Roller shutters (if warehouse)',
        'External plastering',
      ],
    },
    {
      stage_number: 6,
      name: 'MEP First Fix',
      budget_pct: 12,
      substages: [
        'Electrical conduits/trunking',
        'Plumbing risers',
        'HVAC ducting (if applicable)',
        'Fire suppression piping',
        'Data cabling',
      ],
    },
    {
      stage_number: 7,
      name: 'Internal Build-out',
      budget_pct: 12,
      substages: [
        'Partition walls',
        'Suspended ceiling',
        'Floor tiling/epoxy',
        'Wall finishes',
        'Staircase finishing',
      ],
    },
    {
      stage_number: 8,
      name: 'MEP Second Fix',
      budget_pct: 8,
      substages: [
        'Light fixtures',
        'Power outlets',
        'Plumbing fixtures',
        'HVAC units',
        'Fire alarm/suppression',
        'Generator connection',
      ],
    },
    {
      stage_number: 9,
      name: 'External Works',
      budget_pct: 10,
      substages: [
        'Perimeter fence/wall',
        'Access road',
        'Parking lot',
        'Signage',
        'Landscaping',
        'Security infrastructure',
      ],
    },
    {
      stage_number: 10,
      name: 'Compliance & Handover',
      budget_pct: 5,
      substages: [
        'Fire safety inspection',
        'Electrical certification',
        'Building inspection',
        'Snag list resolution',
        'Client walkthrough',
        'Key handover',
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
