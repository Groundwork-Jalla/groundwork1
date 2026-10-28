import Anthropic from '@anthropic-ai/sdk';
import { requireUser } from '../_lib/stripe.js';

/**
 * Look at a floor plan and say what kind of building it is.
 *
 * ── Why a model, when the extractor already reads the sheet ─────────────────────────
 * `extract-bq` counts what a drawing LABELS: five bedrooms, three kitchens, an overall
 * 21.25 x 10.30. That is all genuinely there in the text layer and it is all counting
 * can ever give.
 *
 * What it cannot give is the thing a schedule is actually built from. Mr Nas's ground
 * plan is THREE SEPARATE DWELLINGS in one block — three sitting rooms, three kitchens,
 * three verandas, three front doors. No string on the sheet says so. You know it by
 * looking at the layout, and looking is what this is for.
 *
 * ── Why it is server-side ───────────────────────────────────────────────────────────
 * An API key cannot live in a browser. The reading itself could run anywhere; the key
 * is the whole reason this is a request.
 *
 * ── Why it is an action and not its own file ────────────────────────────────────────
 * Vercel counts every file under `api/` and the Hobby plan allows twelve. Eleven are in
 * use. See the header of `api/events.ts` for what happened the last time that was
 * forgotten: every deployment failed silently for a day.
 *
 * ── What this must never do ─────────────────────────────────────────────────────────
 * Overwrite something the drawing states. A stated figure is the architect's claim; a
 * counted label is a fact about the sheet; this is a reading of a picture. It fills
 * gaps and is labelled as what it is, and the caller enforces that — see
 * `mergeModelReading` in `src/lib/budget/model-plan-reading.ts`.
 */

/** The only model that reads these. Pinned, so a plan's reading cannot change silently. */
const MODEL = 'claude-opus-5-5';

/** A4 at 150dpi is about 2,900 image tokens. Four sheets keeps one read near 3 cents. */
const MAX_PAGES = 4;

/** Image bytes the API will take, per image. Ours are ~400KB; this is the guard rail. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SYSTEM = `You are reading architectural floor plans for a construction project-management platform in Cameroon.

Report only what the drawing shows. The platform already extracts labels and dimensions from the sheet's text layer by itself, so what it needs from you is the judgement that counting cannot provide: how many separate dwelling units the layout contains, how many storeys the set describes, and what kind of building this is.

Rules:
- A unit is a self-contained dwelling: its own entrance, its own living room and kitchen. A block of three identical flats is 3 units, not 1 house.
- Count storeys from the SET of sheets you are given. A ground plan with a staircase proves an upper floor exists but not how many; say what you were shown and set floors to null if the set does not settle it.
- Use null wherever the drawing does not tell you. A null is a useful answer; a guess is not.
- "basis" must quote or name what on the drawing made you say it, in a few words.
- Measurements are metres and square metres.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'sheets', 'buildingType', 'dwellingUnits', 'floors', 'grossAreaSqm',
    'rooms', 'confidence', 'basis',
  ],
  properties: {
    sheets: {
      type: 'array',
      description: 'What each sheet you were given actually is, in order.',
      items: {
        type: 'string',
        enum: ['ground_plan', 'upper_floor_plan', 'roof_plan', 'elevation',
               'section', 'site_plan', 'detail', 'other'],
      },
    },
    buildingType: {
      type: ['string', 'null'],
      enum: ['house', 'duplex', 'apartment_block', 'row_housing', 'commercial',
             'mixed_use', 'institutional', 'other', null],
    },
    dwellingUnits: { type: ['integer', 'null'], minimum: 1 },
    floors: {
      type: ['integer', 'null'], minimum: 1,
      description: 'Storeys including the ground floor. Null if the sheets do not settle it.',
    },
    grossAreaSqm: { type: ['number', 'null'], minimum: 1 },
    rooms: {
      type: 'object',
      additionalProperties: false,
      required: ['bedrooms', 'bathrooms', 'kitchens', 'livingRooms'],
      properties: {
        bedrooms:    { type: ['integer', 'null'], minimum: 0 },
        bathrooms:   { type: ['integer', 'null'], minimum: 0 },
        kitchens:    { type: ['integer', 'null'], minimum: 0 },
        livingRooms: { type: ['integer', 'null'], minimum: 0 },
      },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    basis: {
      type: 'object',
      additionalProperties: false,
      required: ['dwellingUnits', 'floors', 'buildingType'],
      properties: {
        dwellingUnits: { type: 'string', maxLength: 240 },
        floors:        { type: 'string', maxLength: 240 },
        buildingType:  { type: 'string', maxLength: 240 },
      },
    },
  },
} as const;

type Page = { media_type: string; data: string };

const ALLOWED_MEDIA = ['image/png', 'image/jpeg', 'image/webp'];

/** The pages the caller sent, once they are known to be images we can forward. */
function readPages(body: unknown): Page[] | null {
  const pages = (body as { pages?: unknown })?.pages;
  if (!Array.isArray(pages) || !pages.length) return null;

  const out: Page[] = [];
  for (const page of pages.slice(0, MAX_PAGES)) {
    const media = (page as Page)?.media_type;
    const data = (page as Page)?.data;
    if (typeof media !== 'string' || !ALLOWED_MEDIA.includes(media)) return null;
    if (typeof data !== 'string' || !data) return null;
    // Base64 is 4 characters per 3 bytes. Checked before the API call so an oversized
    // page is a 400 from us rather than a billed round trip that fails.
    if (data.length * 0.75 > MAX_IMAGE_BYTES) return null;
    out.push({ media_type: media, data });
  }
  return out;
}

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Signed in or nothing. Without this the endpoint is a button a stranger can press
  // that spends money on our API key, as many times as they like.
  const user = await requireUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  // Not configured is not an error. The plan reading is an enhancement on top of the
  // extractor, and the wizard has to keep working on a deployment without a key — most
  // of all a local one.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(200).json({ available: false, reason: 'not-configured' });
    return;
  }

  const pages = readPages(req.body);
  if (!pages) {
    res.status(400).json({ error: 'Send pages: [{ media_type, data }] as base64 images' });
    return;
  }

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      // Reading a drawing is exactly the kind of work higher effort pays for, and one
      // call per uploaded plan is not a budget worth shaving.
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      // A policy decline on an architect's drawing would be a surprise, but a refusal
      // with no fallback is a dead end for the person uploading, and this costs nothing
      // until it fires.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{
        role: 'user',
        content: [
          ...pages.map(page => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: page.media_type as never, data: page.data },
          })),
          { type: 'text' as const, text: 'Read these sheets and fill the schema.' },
        ],
      }],
    });

    if (message.stop_reason === 'refusal') {
      res.status(200).json({ available: false, reason: 'refused' });
      return;
    }

    const text = message.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('');

    // Parsed, never string-matched: the models vary their JSON escaping.
    let reading: unknown;
    try {
      reading = JSON.parse(text);
    } catch {
      res.status(200).json({ available: false, reason: 'unparseable' });
      return;
    }

    res.status(200).json({
      available: true,
      reading,
      model: message.model,
      pagesRead: pages.length,
    });
  } catch (error) {
    // A failure here must not take the upload step down with it. The extractor's own
    // reading is already on screen and is the part the budget depends on.
    const status = error instanceof Anthropic.APIError ? error.status : undefined;
    console.error('[read-floor-plan]', status ?? '', error instanceof Error ? error.message : error);
    res.status(200).json({ available: false, reason: 'error' });
  }
}
