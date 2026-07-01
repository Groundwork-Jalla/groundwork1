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

export type RoofType = 'long_span_aluminum' | 'clay_tiles' | 'concrete_flat' | 'shingle';

export type FinishLevel = 'standard' | 'premium' | 'luxury';

export type ProjectTier = 'starter' | 'pro' | 'enterprise';

export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived';

export type StageStatus = 'locked' | 'active' | 'pending_review' | 'complete';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type SubstageStatus = 'locked' | 'pending' | 'in_progress' | 'complete' | 'pending_review';

// -------------------------------------------------------
// Wizard form data — accumulated across all 9 steps
// -------------------------------------------------------
export interface WizardFormData {
  // Step 1 — Country
  country: string;         // ISO 3166-1 alpha-2
  countryName: string;

  // Step 2 — Project type
  projectType: ProjectType | null;

  // Step 3 — Building type
  buildingType: BuildingType | null;

  // Step 4 — Floors
  floors: number;

  // Step 5 — Room composition
  bedrooms: number;
  bathrooms: number;
  livingRooms: number;
  kitchens: number;

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

  // Step 9 — Tier selection
  tier: ProjectTier;
}

export const WIZARD_DEFAULT_DATA: WizardFormData = {
  country: '',
  countryName: '',
  projectType: null,
  buildingType: null,
  floors: 1,
  bedrooms: 0,
  bathrooms: 0,
  livingRooms: 0,
  kitchens: 0,
  hasBoysQuarters: false,
  bqRooms: 1,
  roofType: null,
  projectName: '',
  city: '',
  sqm: 0,
  finishLevel: 'standard',
  targetStartDate: '',
  tier: 'starter',
};

// -------------------------------------------------------
// Budget breakdown (calculated client-side)
// -------------------------------------------------------
export interface BudgetBreakdown {
  total: number;
  materials: number;     // 45 %
  labor: number;         // 25 %
  engineering: number;   // 18 %
  permits: number;       //  2 %
  contingency: number;   // 10 %
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
  budget_usd: number | null;
  tier: ProjectTier;
  status: ProjectStatus;
  current_stage: number;
  target_start: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectStageRow {
  id: string;
  project_id: string;
  stage_number: number;
  name: string;
  status: StageStatus;
  budget_pct: number;
  payment_milestone_usd: number | null;
  payment_status: PaymentStatus;
  completed_at: string | null;
  created_at: string;
}

export interface ProjectSubstageRow {
  id: string;
  stage_id: string;
  project_id: string;
  substage_number: number;
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
export interface ProjectDocumentRow {
  id: string;
  project_id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string;
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
}
