import type { GhlEvent } from './_forward.js';
import { ghlSettings } from './_config.js';

/**
 * Which tag and which pipeline stage each event means.
 *
 * The stage ids are configuration, not code, because they are Philip's — they exist in
 * his GHL account and nobody here can know them. The map is one JSON value rather than
 * six separate settings so adding a stage is a single edit.
 *
 *   ghl_pipeline_id = abc123
 *   ghl_stage_map   = {"contractor_application":"stg_1","user_signup":"stg_2",
 *                      "application_decision:accepted":"stg_4"}
 *
 * Read from `app_config` first, then the environment — see `_config.ts`.
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

/**
 * Events that mean "this person is building, not building for someone else".
 *
 * They all carry a flat `groundwork:homeowner` as well as their own tag. Without it,
 * "everyone who is not a contractor" is a three-way OR over signup/building/subscriber —
 * which reads as lifecycle rather than identity, and silently drops anybody the day a
 * fourth stage is added. One flat tag makes the smart list one condition.
 */
const HOMEOWNER_EVENTS: ReadonlySet<GhlEvent> = new Set([
  'user_signup', 'project_created', 'subscription_changed',
]);

/**
 * Contractor or homeowner, as a word a person can read.
 *
 * GoHighLevel's native "Contact type" cannot carry this: it is a fixed two-value field,
 * Lead and Customer, describing sales stage rather than who somebody is. It is not
 * extensible, and a custom field literally named "Contact Type" would sit beside the
 * native one in every filter and workflow picker — two fields, same name, different
 * meanings. Hence a distinct name.
 *
 * `Contact source` already encodes this (`groundwork_contractor_application` vs
 * `groundwork_project_created`) and stays the machine-readable version. This is the
 * human-readable one, for the column you actually scan down.
 */
export function partyFor(event: GhlEvent): 'Contractor' | 'Homeowner' {
  return HOMEOWNER_EVENTS.has(event) ? 'Homeowner' : 'Contractor';
}

/** `lang` is optional: a contact with no known language should not be tagged as English. */
export function tagsFor(event: GhlEvent, variant?: string, lang?: string | null): string[] {
  const tags = [BASE_TAG];

  if (HOMEOWNER_EVENTS.has(event)) tags.push('groundwork:homeowner');

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
export async function stageFor(event: GhlEvent, variant?: string): Promise<StageTarget | null> {
  return stageForKey(variant ? `${event}:${variant}` : event, event);
}

/**
 * The same lookup, for keys that are not lifecycle events.
 *
 * `contractor_application` is the one that matters: a contractor who applies used to
 * reach GHL as a contact and nothing else, so there was no card to move from "Applied"
 * to "Interview scheduled" — the only mapped stages fired on the *decision*, which comes
 * after the interview it was supposed to help you schedule.
 */
export async function stageForKey(key: string, fallbackKey?: string): Promise<StageTarget | null> {
  const cfg = await ghlSettings();
  const pipelineId = cfg.GHL_PIPELINE_ID.value;
  const raw = cfg.GHL_STAGE_MAP.value;
  if (!pipelineId || !raw) return null;

  let map: Record<string, string>;
  try {
    map = JSON.parse(raw) as Record<string, string>;
  } catch {
    // Once per cold start: a malformed map is a config typo that would otherwise be
    // invisible, and silently never moving anyone looks identical to "not set up yet".
    if (!warned) { console.error('[ghl] the stage map is not valid JSON — no stage moves'); warned = true; }
    return null;
  }

  // The specific key first, then the unsuffixed event: a map with only `user_signup`
  // still moves a `user_signup` however it is called.
  const stageId = map[key] || (fallbackKey ? map[fallbackKey] : undefined);
  return stageId ? { pipelineId, stageId } : null;
}
