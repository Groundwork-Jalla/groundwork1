/**
 * Resource library — structure only.
 *
 * Titles, descriptions and article bodies live in the dictionary under
 * `resources.articles.*` and are read through `useResources()` in
 * src/lib/resources-labels.ts. What stays here is everything that is not prose:
 * the slug (the URL), the category, the build stage an article is relevant to,
 * the highlight tag, the reading time, and how many paragraphs the body has.
 *
 * `paragraphs` is the count of `pN` keys in the dictionary. It lives beside the
 * slug so adding a paragraph is one number and one key, and so a body can never
 * be silently truncated by a component guessing how long it is.
 */

export type ResourceCategory = 'guides' | 'checklists' | 'legalFinance' | 'videos';

export type ResourceTag = 'popular' | 'essential' | 'new' | 'important' | 'startHere';

export interface ResourceMeta {
  slug: string;
  /** Dictionary sub-key under `resources.articles`. */
  key: string;
  category: ResourceCategory;
  /** Build stage this is relevant to, or null for general guidance. */
  stage: number | null;
  tag: ResourceTag | null;
  /** Minutes — rendered as "8 min read", or plain "8 min" for videos. */
  minutes: number;
  paragraphs: number;
}

export const RESOURCE_META: ResourceMeta[] = [
  { slug: 'how-to-read-a-bq',                key: 'howToReadABq',                 category: 'guides',       stage: 2,    tag: 'popular',   minutes: 8,  paragraphs: 5 },
  { slug: 'hiring-a-contractor',             key: 'hiringAContractor',            category: 'guides',       stage: 1,    tag: 'essential', minutes: 6,  paragraphs: 5 },
  { slug: 'understanding-build-stages',      key: 'understandingBuildStages',     category: 'guides',       stage: null, tag: null,        minutes: 12, paragraphs: 2 },
  { slug: 'diaspora-builders-checklist',     key: 'diasporaBuildersChecklist',    category: 'guides',       stage: null, tag: 'new',       minutes: 5,  paragraphs: 5 },
  { slug: 'site-visit-checklist',            key: 'siteVisitChecklist',           category: 'checklists',   stage: null, tag: null,        minutes: 3,  paragraphs: 2 },
  { slug: 'stage-approval-checklist',        key: 'stageApprovalChecklist',       category: 'checklists',   stage: null, tag: 'essential', minutes: 4,  paragraphs: 5 },
  { slug: 'foundation-inspection-checklist', key: 'foundationInspectionChecklist',category: 'checklists',   stage: 2,    tag: null,        minutes: 5,  paragraphs: 2 },
  { slug: 'contractor-payment-template',     key: 'contractorPaymentTemplate',    category: 'checklists',   stage: null, tag: null,        minutes: 3,  paragraphs: 2 },
  { slug: 'title-deed-verification',         key: 'titleDeedVerification',        category: 'legalFinance', stage: 1,    tag: 'important', minutes: 7,  paragraphs: 5 },
  { slug: 'building-permit-process',         key: 'buildingPermitProcess',        category: 'legalFinance', stage: 1,    tag: null,        minutes: 5,  paragraphs: 2 },
  { slug: 'currency-transfer-tips',          key: 'currencyTransferTips',         category: 'legalFinance', stage: null, tag: null,        minutes: 4,  paragraphs: 2 },
  { slug: 'groundwork-walkthrough',          key: 'groundworkWalkthrough',        category: 'videos',       stage: null, tag: 'startHere', minutes: 5,  paragraphs: 5 },
  { slug: 'reading-site-evidence',           key: 'readingSiteEvidence',          category: 'videos',       stage: null, tag: null,        minutes: 8,  paragraphs: 2 },
  { slug: 'roof-types-explained',            key: 'roofTypesExplained',           category: 'guides',       stage: 5,    tag: null,        minutes: 6,  paragraphs: 2 },
];

export const RESOURCE_CATEGORIES: ResourceCategory[] = [
  'guides', 'checklists', 'legalFinance', 'videos',
];

/**
 * Stage keys for the "Relevant: Stage N" badge.
 *
 * This used to be its own ten-name list that disagreed with the stage names actually
 * seeded onto projects — "Foundation" here versus "Site Preparation & Foundation" on
 * the project page, "Substructure" versus "Block Work & Walls", and so on. Only
 * stages 1, 2 and 5 are ever referenced by an article, but the divergence was real
 * and would have grown. These now point at the same `stages.*` keys the project
 * timeline uses, so the two pages cannot say different things about stage 4 again.
 */
export const RESOURCE_STAGE_KEYS: Record<number, string> = {
  1:  'landAcquisitionAndDocumentation',
  2:  'sitePreparationAndFoundation',
  3:  'blockWorkAndWalls',
  4:  'deckingAndUpperFloors',
  5:  'roofing',
  6:  'plasteringAndScreeding',
  7:  'electricalAndPlumbing',
  8:  'finishing',
  9:  'externalWorks',
  10: 'finalInspectionAndHandover',
};

export function findResource(slug: string | undefined): ResourceMeta | undefined {
  return RESOURCE_META.find(r => r.slug === slug);
}
