import { DEFAULT_COUNTRY_CODE } from '@/lib/countries';

// =========================================================
// Project domain types — wizard, project records, stages
// =========================================================

export type ProjectType = 'residential' | 'commercial' | 'industrial' | 'mixed_use';

export type BuildingType =
  // residential
  | 'single_family'
  | 'multi_family'
  | 'townhouse'
  | 'semi_detached'
  // commercial
  | 'office'
  | 'retail'
  | 'warehouse_commercial'
  | 'hotel'
  // industrial
  | 'factory'
  | 'warehouse_industrial'
  | 'industrial_complex'
  | 'distribution_centre'
  // mixed use
  | 'mixed_residential_commercial'
  | 'live_work'
  | 'mixed_retail_residential'
  | 'transit_oriented';

// `aluminium_deck` added Aug 2026. 003_projects.sql declares roof_type TEXT with no
// CHECK constraint, so a new value needs no migration. See lib/budget/roof.ts.
export type RoofType =
  | 'long_span_aluminum' | 'clay_tiles' | 'shingle'   // pitched
  | 'concrete_flat' | 'aluminium_deck';               // flat

export type FinishLevel = 'standard' | 'premium' | 'luxury';

export type ProjectTier = 'self_verify' | 'jalla_verify' | 'jalla_management';

export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived';

export type StageStatus = 'locked' | 'active' | 'pending_review' | 'complete';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type SubstageStatus = 'locked' | 'pending' | 'in_progress' | 'complete' | 'pending_review';

// -------------------------------------------------------
// Per-floor room breakdown (Step 5)
// -------------------------------------------------------
export interface FloorRoom {
  floor: number;       // 0 = Ground Floor, 1 = Floor 1, …
  bedrooms: number;
  bathrooms: number;
  livingRooms: number;
  kitchens: number;
  /** Home office / study. Added Aug 2026 — absent on rows written before then. */
  offices: number;
}

// -------------------------------------------------------
// Wizard form data — accumulated across all 9 steps
// -------------------------------------------------------
export interface WizardFormData {
  // Step 1 — Country
  country: string;         // ISO 3166-1 alpha-2

  // Step 2 — Project type
  projectType: ProjectType | null;

  // Step 3 — Building type
  buildingType: BuildingType | null;

  // Step 4 — Floors
  floors: number;

  // Step 5 — Room composition (flat totals + per-floor breakdown)
  bedrooms: number;
  bathrooms: number;
  livingRooms: number;
  kitchens: number;
  offices: number;
  floorRooms: FloorRoom[];

  // Step 6 — Boys' quarters
  hasBoysQuarters: boolean;
  bqRooms: number;

  // Step 7 — Roof type
  roofType: RoofType | null;

  // Step 8 — Project details
  projectName: string;
  city: string;
  sqm: number;
  finishLevel: FinishLevel;
  targetStartDate: string;

  // Step 9 — Tier selection ('' means not yet chosen)
  tier: ProjectTier | '';

  // UI-only: which floor tab is active in Step 5 (for building preview sync)
  previewActiveFloor: number;
}

export const WIZARD_DEFAULT_DATA: WizardFormData = {
  country: DEFAULT_COUNTRY_CODE,
  projectType: null,
  buildingType: null,
  floors: 1,
  bedrooms: 0,
  bathrooms: 0,
  livingRooms: 0,
  kitchens: 0,
  offices: 0,
  floorRooms: [],
  hasBoysQuarters: false,
  bqRooms: 1,
  roofType: null,
  projectName: '',
  city: '',
  sqm: 0,
  finishLevel: 'standard',
  targetStartDate: '',
  tier: '',
  previewActiveFloor: 0,
};

// -------------------------------------------------------
// Budget breakdown (calculated client-side)
// -------------------------------------------------------
/**
 * The four lines a client is quoted, plus the material/labour view of the first.
 *
 * Two identities hold for every value this type ever takes, and both are asserted in
 * split.test.ts:
 *
 *   material + labor                                   === construction
 *   construction + permit + professional + design      === total
 *
 * They are what let a component render `b.total` beside `b.design` without the column
 * failing to add up — the bug the previous six-way split kept reintroducing.
 */
export interface BudgetBreakdown {
  /** What the client pays: construction + permit + professional + design. */
  total: number;
  /** The build itself — the take-off output. Permits and fees sit on top of it. */
  construction: number;
  /** 60% of `construction`. A view of it, not an addition to it. */
  material: number;
  /** 40% of `construction`. */
  labor: number;
  /** 1% of `construction`. */
  permit: number;
  /** Flat fee: 50,000 XAF per charged construction stage. */
  professional: number;
  /** 5,000 XAF per built m² (footprint × floors). */
  design: number;
}

// -------------------------------------------------------
// Construction rates (fetched from DB, one row per country)
// -------------------------------------------------------
export interface ConstructionRateSections {
  preliminary: number;
  foundation: number;
  ground_floor: number;
  roof: number;
  joinery: number;
  electrical: number;
  plumbing: number;
  finishing: number;
}

export interface ConstructionRate {
  country_code: string;
  base_rate_usd: number;
  upper_floor_addition_pct: number;
  sections: ConstructionRateSections;
  finish_multipliers: Record<string, number>;
  building_type_multipliers: Record<string, number>;
  roof_type_multipliers: Record<string, number>;
  currency_code: string;
  approx_fx_rate: number;
  data_source: 'real_bq' | 'estimated_index';
  notes?: string | null;
  updated_at?: string;
  /** Quantity take-off model. Null/absent = fall back to the legacy formula. */
  takeoff?: TakeoffModel | null;
  /** Count-driven fixture prices. Null/absent = engine defaults. */
  fixture_prices?: Partial<FixturePrices> | null;
}

// -------------------------------------------------------
// City rate book (migration 020) — one row per city
// -------------------------------------------------------
export interface CityRate {
  city_code: string;
  country_code: string;
  city_name: string;
  rc_350: number;
  rc_250: number;
  lean_concrete: number;
  mortar: number;
  /**
   * Multiplier on NON-CONCRETE trades only. Concrete comes from this row's own
   * rc_350/rc_250/lean_concrete columns and bypasses it entirely (engine.ts), so this
   * is not the whole-building difference — see `cost_delta_pct` for that.
   */
  index_vs_baseline: number;
  /**
   * Whole-building cost against the country's baseline city, in percent. The
   * client-facing figure, and the one Vanessa stated; `index_vs_baseline` is solved to
   * realise it. Null where we have no figure (Nigeria).
   */
  cost_delta_pct?: number | null;
  currency_code: string;
  data_source: 'real_bq' | 'estimated_index';
  notes?: string | null;
}

// -------------------------------------------------------
// Quantity take-off model (migration 020)
// -------------------------------------------------------
export interface TakeoffGeometry {
  storey_height_m: number;
  slab_thickness_m: number;
  ground_slab_thickness_m: number;
  partition_m_per_room: number;
  perimeter_factor: number;
  exc_m3_per_m2: number;
  lean_m3_per_m2: number;
  footing_m3_per_m2: number;
  footing_floor_uplift: number;
  col_m3_per_m2: number;
  beam_m3_per_m2: number;
  stair_m3: number;
  flat_roof_sheet_frac: number;
  pitched_roof_factor: number;
  railing_ml_per_floor: number;
  contingency_pct: number;
}

export interface TakeoffRates {
  excavation_m3: number;
  backfill_m3: number;
  dpm_m2: number;
  sand_bed_m2: number;
  fdn_block_m2: number;
  blockwork_m2: number;
  plaster_m2: number;
  deck_plaster_m2: number;
  floor_tiles_m2: number;
  wall_tiles_m2: number;
  ceiling_m2: number;
  paint_m2: number;
  roof_sheet_m2: number;
  roof_timber_m2: number;
  roof_accessories: number;
  parapet_ml: number;
  door_avg: number;
  window: number;
  railing_ml: number;
}

export interface TakeoffModel {
  version: string;
  geometry: TakeoffGeometry;
  rates: TakeoffRates;
  electrical: { per_floor: number; per_room: number };
}

export interface FixturePrices {
  supply: number;
  drainage: number;
  septic: number;
  accessories: number;
  wc: number;
  mirror: number;
  sink: number;
  tub: number;
  shower: number;
  kitchen_sink: number;
}

// -------------------------------------------------------
// Trade-section budget detail (shown in wizard + dashboard)
// -------------------------------------------------------
export interface TradeSection {
  key: string;
  label: string;
  pct: number;         // % of total (display only)
  amountUSD: number;
  amountLocal: number;
  color: string;
}

export interface BudgetCalcDetail {
  /** Trade sections. Their amounts sum to `total`, NOT to `budget.total`. */
  sections: TradeSection[];
  /**
   * The CONSTRUCTION fee — what the trade sections add up to.
   *
   * This is not what the client pays. Permit, professional and design sit on top of it;
   * `budget.total` is the figure to show anyone. Keeping the two apart is what lets the
   * section table sum to its own subtotal instead of silently missing the fee lines.
   */
  total: number;
  totalLocal: number;
  currencyCode: string;
  approxFxRate: number;
  dataSource: 'real_bq' | 'estimated_index';
  /** The four-line client budget built from `total`. */
  budget: BudgetBreakdown;
}

// -------------------------------------------------------
// Supabase row shapes
// -------------------------------------------------------
export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  country: string;
  city: string | null;
  project_type: ProjectType;
  building_type: BuildingType;
  num_floors: number;
  sqm: number;
  finish_level: FinishLevel;
  has_boys_quarters: boolean;
  bq_rooms: number;
  roof_type: RoofType;
  bedrooms: number;
  bathrooms: number;
  living_rooms: number;
  kitchens: number;
  /** Home offices / studies. Added in migration 038; defaults to 0 on older rows. */
  offices: number;
  floor_rooms: FloorRoom[] | null;
  budget_usd: number | null;
  tier: ProjectTier;
  status: ProjectStatus;
  current_stage: number;
  target_start: string | null;
  tracking_started_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectStageRow {
  id: string;
  project_id: string;
  stage_number: number;
  /** i18n key (migration 024). Null on rows the backfill could not match — render `name`. */
  stage_key: string | null;
  /** English name, persisted at creation. Audit trail and render fallback. */
  name: string;
  status: StageStatus;
  /** Share of the CONSTRUCTION fee, not of the client total. See migration 036. */
  budget_pct: number;
  /**
   * Absolute milestone, overriding `budget_pct` when set (migration 036).
   * Used for the design fee, which is priced per built m² rather than as a share.
   */
  fixed_amount_usd: number | null;
  payment_milestone_usd: number | null;
  payment_status: PaymentStatus;
  completed_at: string | null;
  planned_start: string | null;
  planned_end: string | null;
  notes: string | null;
  created_at: string;
}

/**
 * A payment milestone that maps to no build stage.
 *
 * Permit and professional are charged on the project, not on site work, so they are not
 * stages 11 and 12 of a 10-stage pipeline. The design fee is NOT here — it rides on the
 * `designCompleted` stage via `fixed_amount_usd`. See migration 036.
 */
export interface ProjectFeeRow {
  id: string;
  project_id: string;
  kind: 'permit' | 'professional';
  amount_usd: number;
  payment_status: PaymentStatus;
  paid_at: string | null;
  created_at: string;
}

export interface ProjectSubstageRow {
  id: string;
  stage_id: string;
  project_id: string;
  substage_number: number;
  /** i18n key (migration 024). Null falls back to `name`. */
  substage_key: string | null;
  name: string;
  status: SubstageStatus;
  evidence_urls: string[];
  approved_by: string | null;
  approved_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// -------------------------------------------------------
// Phase 3 tables
// -------------------------------------------------------
export type DocumentCategory = 'contract' | 'permit' | 'receipt' | 'invoice' | 'report' | 'site_photo' | 'other';

export interface ProjectDocumentRow {
  id: string;
  project_id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string;
  category: DocumentCategory;
  stage_id: string | null;
  created_at: string;
}

export interface ProjectMessageRow {
  id: string;
  project_id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  created_at: string;
}

export interface ContractorInviteRow {
  id: string;
  project_id: string;
  invited_by: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'rejected';
  accepted_at: string | null;
  created_at: string;
  token: string;
  contractor_user_id: string | null;
}

export interface ProjectAuditLogRow {
  id: string;
  project_id: string;
  stage_id: string | null;
  action: string;
  actor_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

// -------------------------------------------------------
// Country data
// -------------------------------------------------------
export interface CountryOption {
  code: string;
  name: string;
  flag: string;
  region: 'africa' | 'europe' | 'americas' | 'oceania' | 'asia' | 'middle_east';
  rateStandard: number;  // USD / sqm
  ratePremium: number;
  rateLuxury: number;
  recommended?: boolean;
}
