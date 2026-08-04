-- 024_stage_keys.sql
--
-- Gives every stage and substage a stable, language-independent key.
--
-- WHY
-- project_stages.name and project_substages.name are TEXT NOT NULL, written from
-- src/lib/supabase/stage-seeds.ts at project creation (projects.ts:75). They are display
-- strings that happen to live in the database. Translating the seed file alone would only
-- affect projects created afterwards — every existing build would keep showing English
-- stage names to a French user, on the Stages tab, Timeline, Payments, Overview,
-- certificates and the PDF export.
--
-- WHY AN EXACT-MATCH BACKFILL IS SAFE
-- Stage and substage names are write-once. There is no update path anywhere in the app or
-- the admin surface, so a stored value can only ever be one of the 117 seed strings listed
-- below. Anything that does not match keeps a NULL key and falls back to its stored name,
-- so no row can render blank.
--
-- The English `name` column is deliberately kept. It stays a human-readable audit trail
-- for anyone reading the table directly, and it is the render fallback.

ALTER TABLE public.project_stages
  ADD COLUMN IF NOT EXISTS stage_key TEXT;

ALTER TABLE public.project_substages
  ADD COLUMN IF NOT EXISTS substage_key TEXT;

COMMENT ON COLUMN public.project_stages.stage_key IS
  'Stable key into the i18n dictionary (stages.*). NULL falls back to name.';
COMMENT ON COLUMN public.project_substages.substage_key IS
  'Stable key into the i18n dictionary (substages.*). NULL falls back to name.';


-- ── Backfill: stages ──

UPDATE public.project_stages SET stage_key = m.key FROM (VALUES
  ('Land Acquisition & Documentation', 'landAcquisitionAndDocumentation'),
  ('Site Preparation & Foundation', 'sitePreparationAndFoundation'),
  ('Block Work & Walls', 'blockWorkAndWalls'),
  ('Decking & Upper Floors', 'deckingAndUpperFloors'),
  ('Roofing', 'roofing'),
  ('Plastering & Screeding', 'plasteringAndScreeding'),
  ('Electrical & Plumbing', 'electricalAndPlumbing'),
  ('Finishing', 'finishing'),
  ('External Works', 'externalWorks'),
  ('Final Inspection & Handover', 'finalInspectionAndHandover'),
  ('Land & Permits', 'landAndPermits'),
  ('Structural Frame', 'structuralFrame'),
  ('Roofing & Weatherproofing', 'roofingAndWeatherproofing'),
  ('External Envelope', 'externalEnvelope'),
  ('MEP First Fix', 'mepFirstFix'),
  ('Internal Build-out', 'internalBuildOut'),
  ('MEP Second Fix', 'mepSecondFix'),
  ('Compliance & Handover', 'complianceAndHandover')
) AS m(name, key) WHERE public.project_stages.name = m.name AND stage_key IS NULL;


-- ── Backfill: substages ──

UPDATE public.project_substages SET substage_key = m.key FROM (VALUES
  ('Title verification', 'titleVerification'),
  ('Survey plan', 'surveyPlan'),
  ('C of O processing', 'cOfOProcessing'),
  ('Land purchase agreement', 'landPurchaseAgreement'),
  ('Site clearing', 'siteClearing'),
  ('Setting out', 'settingOut'),
  ('Excavation', 'excavation'),
  ('Foundation concrete pour', 'foundationConcretePour'),
  ('DPC (damp proof course)', 'dpcDampProofCourse'),
  ('Ground floor walls', 'groundFloorWalls'),
  ('Window/door lintels', 'windowDoorLintels'),
  ('First floor walls (if multi-storey)', 'firstFloorWallsIfMultiStorey'),
  ('Columns and beams', 'columnsAndBeams'),
  ('Scaffolding erection', 'scaffoldingErection'),
  ('Decking formwork', 'deckingFormwork'),
  ('Reinforcement (BRC/rebar)', 'reinforcementBrcRebar'),
  ('Concrete pour', 'concretePour'),
  ('Curing', 'curing'),
  ('Roof truss fabrication', 'roofTrussFabrication'),
  ('Truss installation', 'trussInstallation'),
  ('Roofing sheets/tiles', 'roofingSheetsTiles'),
  ('Fascia and barge board', 'fasciaAndBargeBoard'),
  ('Gutter installation', 'gutterInstallation'),
  ('Internal wall plastering', 'internalWallPlastering'),
  ('External wall plastering', 'externalWallPlastering'),
  ('Floor screeding', 'floorScreeding'),
  ('POP ceiling (if selected)', 'popCeilingIfSelected'),
  ('First fix electrical (conduits/wiring)', 'firstFixElectricalConduitsWiring'),
  ('First fix plumbing (pipes)', 'firstFixPlumbingPipes'),
  ('Septic tank/soakaway', 'septicTankSoakaway'),
  ('Water tank installation', 'waterTankInstallation'),
  ('Wall tiling (kitchen/bath)', 'wallTilingKitchenBath'),
  ('Floor tiling', 'floorTiling'),
  ('Painting (interior)', 'paintingInterior'),
  ('Painting (exterior)', 'paintingExterior'),
  ('Door installation', 'doorInstallation'),
  ('Window installation', 'windowInstallation'),
  ('Kitchen cabinets', 'kitchenCabinets'),
  ('Wardrobe installation', 'wardrobeInstallation'),
  ('Fence/gate construction', 'fenceGateConstruction'),
  ('Drainage channels', 'drainageChannels'),
  ('Driveway/parking paving', 'drivewayParkingPaving'),
  ('Landscaping', 'landscaping'),
  ('External lighting', 'externalLighting'),
  ('Second fix electrical (fixtures/switches)', 'secondFixElectricalFixturesSwitches'),
  ('Second fix plumbing (fixtures/taps)', 'secondFixPlumbingFixturesTaps'),
  ('General snag list', 'generalSnagList'),
  ('Final cleaning', 'finalCleaning'),
  ('Client walkthrough', 'clientWalkthrough'),
  ('Key handover', 'keyHandover'),
  ('Common area electrical', 'commonAreaElectrical'),
  ('Fire safety wiring', 'fireSafetyWiring'),
  ('Borehole/water system', 'boreholeWaterSystem'),
  ('Survey', 'survey'),
  ('Building permit', 'buildingPermit'),
  ('Environmental assessment', 'environmentalAssessment'),
  ('Commercial zoning confirmation', 'commercialZoningConfirmation'),
  ('Soil testing', 'soilTesting'),
  ('Pile foundation (if needed)', 'pileFoundationIfNeeded'),
  ('Foundation pour', 'foundationPour'),
  ('DPC', 'dpc'),
  ('Column erection', 'columnErection'),
  ('Beam installation', 'beamInstallation'),
  ('Floor slabs per level', 'floorSlabsPerLevel'),
  ('Structural steel (if warehouse)', 'structuralSteelIfWarehouse'),
  ('Load-bearing walls', 'loadBearingWalls'),
  ('Roof truss/steel frame', 'roofTrussSteelFrame'),
  ('Roofing sheets', 'roofingSheets'),
  ('Waterproofing membrane', 'waterproofingMembrane'),
  ('Flashing and gutters', 'flashingAndGutters'),
  ('External cladding', 'externalCladding'),
  ('Curtain wall/glazing (if office)', 'curtainWallGlazingIfOffice'),
  ('Roller shutters (if warehouse)', 'rollerShuttersIfWarehouse'),
  ('External plastering', 'externalPlastering'),
  ('Electrical conduits/trunking', 'electricalConduitsTrunking'),
  ('Plumbing risers', 'plumbingRisers'),
  ('HVAC ducting (if applicable)', 'hvacDuctingIfApplicable'),
  ('Fire suppression piping', 'fireSuppressionPiping'),
  ('Data cabling', 'dataCabling'),
  ('Partition walls', 'partitionWalls'),
  ('Suspended ceiling', 'suspendedCeiling'),
  ('Floor tiling/epoxy', 'floorTilingEpoxy'),
  ('Wall finishes', 'wallFinishes'),
  ('Staircase finishing', 'staircaseFinishing'),
  ('Light fixtures', 'lightFixtures'),
  ('Power outlets', 'powerOutlets'),
  ('Plumbing fixtures', 'plumbingFixtures'),
  ('HVAC units', 'hvacUnits'),
  ('Fire alarm/suppression', 'fireAlarmSuppression'),
  ('Generator connection', 'generatorConnection'),
  ('Perimeter fence/wall', 'perimeterFenceWall'),
  ('Access road', 'accessRoad'),
  ('Parking lot', 'parkingLot'),
  ('Signage', 'signage'),
  ('Security infrastructure', 'securityInfrastructure'),
  ('Fire safety inspection', 'fireSafetyInspection'),
  ('Electrical certification', 'electricalCertification'),
  ('Building inspection', 'buildingInspection'),
  ('Snag list resolution', 'snagListResolution')
) AS m(name, key) WHERE public.project_substages.name = m.name AND substage_key IS NULL;


-- ── Report anything the backfill could not match ──
-- Expected to be zero. A non-zero count means a name was edited after creation, or a seed
-- string changed without this migration being regenerated — those rows keep NULL keys and
-- still render via their stored English name, so nothing breaks, but they will not
-- translate until the key is set.
DO $$
DECLARE
  v_stages INT;
  v_subs   INT;
BEGIN
  SELECT count(*) INTO v_stages FROM public.project_stages     WHERE stage_key    IS NULL;
  SELECT count(*) INTO v_subs   FROM public.project_substages  WHERE substage_key IS NULL;
  IF v_stages > 0 OR v_subs > 0 THEN
    RAISE NOTICE 'unmatched after backfill: % stage(s), % substage(s) — these keep their English name', v_stages, v_subs;
  ELSE
    RAISE NOTICE 'backfill complete: every stage and substage keyed';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS project_stages_key_idx    ON public.project_stages (stage_key);
CREATE INDEX IF NOT EXISTS project_substages_key_idx ON public.project_substages (substage_key);
