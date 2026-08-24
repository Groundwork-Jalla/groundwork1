import type { GhlEvent } from './_forward.js';

/**
 * Which tag and which pipeline stage each event means.
 *
 * The stage ids are configuration, not code, because they are Philip's — they exist in
 * his GHL account and nobody here can know them. `GHL_STAGE_MAP` is one JSON env var
 * rather than six separate ones so adding a stage is an edit in Vercel, not a deploy.
 *
 *   GHL_PIPELINE_ID=abc123
 *   GHL_STAGE_MAP={"user_signup":"stg_1","application_decision:accepted":"stg_4"}
 *
 * Keys are the event name, optionally suffixed `:variant` for events whose meaning
 * splits — an accepted application and a rejected one are the same event and opposite
 * ends of a pipeline. Unmapped keys simply do not move anyone, which is the right
 * default: a half-configured pipeline should leave the board alone rather than pile
 * every contact into whichever stage happened to be listed first.
 */

/**
 * Tags every contact carries, so the CRM can be worked rather than just filled.
 *
 * Three layers, and each answers a different question:
 *
 *   `groundwork`          — came from the product at all. One tag that selects every
 *                           contact we created, which is what makes the rest safe to
 *                           filter on: without it you cannot tell our contacts from
 *                           anything imported by hand or captured by another form.
 *   `groundwork:<source>` — how they arrived. A contractor who applied and a homeowner
 *                           who signed up want different conversations.
 *   `groundwork:<state>`  — what has happened since. Accepted, rejected, paying, building.
 *
 * Plus a language tag. The product is bilingual and Cameroon-first, so "everyone I can
 * write to in French" is a real audience, and GHL has no other way to know.
 *
 * Chosen here rather than in the environment on purpose: a tag renamed in Vercel would
 * silently split an audience in two, with the old name still attached to everyone who
 * arrived before the change.
 */
const BASE_TAG = 'groundwork';

const SOURCE: Record<GhlEvent, string> = {
  user_signup:          'groundwork:signup',
  application_decision: 'groundwork:contractor',
  subscription_changed: 'groundwork:subscriber',
  project_created:      'groundwork:building',
};

/** `lang` is optional: a contact with no known language should not be tagged as English. */
export function tagsFor(event: GhlEvent, variant?: string, lang?: string | null): string[] {
  const tags = [BASE_TAG];

  const source = SOURCE[event];
  if (source) tags.push(source);

  // A decision is worth its own tag — "contractor" and "contractor we turned down" are
  // not the same audience for anything the team might later send. Same for a subscriber
  // who has cancelled.
  if ((event === 'application_decision' || event === 'subscription_changed') && variant) {
    tags.push(`groundwork:${variant}`);
  }

  if (lang === 'fr' || lang === 'en') tags.push(`groundwork:${lang}`);

  return tags;
}

/**
 * The contractor application has its own webhook and its own workflow, predating the
 * rest — but a lead is a lead, so it carries the same base and language tags.
 */
export function contractorTags(status?: string | null, lang?: string | null): string[] {
  const tags = [BASE_TAG, 'groundwork:contractor', 'groundwork:applied'];
  if (status === 'disqualified') tags.push('groundwork:screened-out');
  if (lang === 'fr' || lang === 'en') tags.push(`groundwork:${lang}`);
  return tags;
}

export interface StageTarget {
  pipelineId: string;
  stageId: string;
}

let warned = false;

/** Null when this event has no stage configured — the common, harmless case. */
export function stageFor(event: GhlEvent, variant?: string): StageTarget | null {
  const pipelineId = process.env.GHL_PIPELINE_ID;
  const raw = process.env.GHL_STAGE_MAP;
  if (!pipelineId || !raw) return null;

  let map: Record<string, string>;
  try {
    map = JSON.parse(raw) as Record<string, string>;
  } catch {
    // Once per cold start: a malformed map is a config typo that would otherwise be
    // invisible, and silently never moving anyone looks identical to "not set up yet".
    if (!warned) { console.error('[ghl] GHL_STAGE_MAP is not valid JSON — no stage moves'); warned = true; }
    return null;
  }

  const stageId = (variant && map[`${event}:${variant}`]) || map[event];
  return stageId ? { pipelineId, stageId } : null;
}
