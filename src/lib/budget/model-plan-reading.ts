import type { FloorPlanFacts } from './extract-bq';
import { supabase } from '@/lib/supabase/client';

// =========================================================
// Looking at a floor plan, rather than reading its text.
//
// The extractor counts labels and multiplies the dimension chain, which is everything
// a sheet SAYS. Mr Nas's ground plan says five bedrooms, three kitchens, 21.25 x 10.30.
// What it does not say — and what the build schedule is actually made of — is that the
// layout is three separate dwellings sharing one roof. Three sitting rooms, three
// kitchens, three verandas, three front doors, and not one string on the drawing to
// tell you so.
//
// That is a judgement about a picture, so the picture goes to a model. The pages are
// rendered here, in the browser, and posted to `read-floor-plan`; the key lives there.
//
// ── The rule that makes this safe to add ────────────────────────────────────────────
// Three kinds of knowledge, ranked, and the ranking never bends:
//
//   STATED   the drawing says it      — the architect's own claim
//   COUNTED  we counted its labels    — a fact about the sheet
//   MODEL    something looked at it   — a reading, and labelled as one
//
// `mergeModelReading` fills holes and overwrites nothing. A drawing that states its
// storey count keeps it. The budget therefore cannot move because a model saw the
// drawing differently from the architect who drew it.
// =========================================================

export type SheetKind =
  | 'ground_plan' | 'upper_floor_plan' | 'roof_plan' | 'elevation'
  | 'section' | 'site_plan' | 'detail' | 'other';

export type BuildingType =
  | 'house' | 'duplex' | 'apartment_block' | 'row_housing' | 'commercial'
  | 'mixed_use' | 'institutional' | 'other';

export interface ModelPlanReading {
  sheets: SheetKind[];
  buildingType: BuildingType | null;
  dwellingUnits: number | null;
  floors: number | null;
  grossAreaSqm: number | null;
  rooms: {
    bedrooms: number | null;
    bathrooms: number | null;
    kitchens: number | null;
    livingRooms: number | null;
  };
  confidence: 'high' | 'medium' | 'low';
  basis: { dwellingUnits: string; floors: string; buildingType: string };
}

/** Pages are capped server-side too; this keeps the request from being built at all. */
const MAX_PAGES = 4;

/**
 * 150dpi. A4 lands near 1,750px on the long edge and about 2,900 image tokens, which
 * is legible for a drawing and keeps four sheets around three cents a read.
 */
const RENDER_SCALE = 150 / 72;

/** The long edge the API starts downscaling at anyway — no point paying to send more. */
const MAX_EDGE_PX = 1568;

type RenderablePage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: Record<string, unknown>) => { promise: Promise<void> };
};

/** One rendered sheet, as the handler wants it. */
export interface PlanPageImage { media_type: 'image/png'; data: string }

/**
 * Render the first pages of a plan PDF to PNG.
 *
 * Forward from page 1, unlike the OCR path which walks backwards — a bill's total is
 * at the end, and a plan set's general arrangement is at the front.
 */
export async function renderPlanPages(file: File): Promise<PlanPageImage[]> {
  if (!/\.pdf$/i.test(file.name)) {
    // An uploaded photograph or scan of a plan is already the picture we would make.
    const data = await fileToBase64(file);
    return data ? [{ media_type: 'image/png', data }] : [];
  }

  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc =
    (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out: PlanPageImage[] = [];
  try {
    const pages = Math.min(doc.numPages, MAX_PAGES);
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n) as unknown as RenderablePage;
      const nominal = page.getViewport({ scale: RENDER_SCALE });
      const longest = Math.max(nominal.width, nominal.height);
      const scale = longest > MAX_EDGE_PX
        ? RENDER_SCALE * (MAX_EDGE_PX / longest)
        : RENDER_SCALE;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      // A drawing is black line work on nothing. Without this the transparent areas
      // come out black in the PNG and the model is handed an inverted sheet.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;

      const data = canvas.toDataURL('image/png').split(',')[1];
      if (data) out.push({ media_type: 'image/png', data });
    }
  } finally {
    await (doc as unknown as { cleanup?: () => Promise<void> }).cleanup?.();
  }
  return out;
}

async function fileToBase64(file: File): Promise<string | null> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary) || null;
}

/**
 * Fold a model's reading into the extractor's, WITHOUT overruling it.
 *
 * Every field here is written only where the extractor left a hole. The one thing the
 * model contributes outright is `dwellingUnits`, because nothing counts it and nothing
 * else can: it is the difference between one large house and three flats, and between
 * one build schedule and three.
 */
export function mergeModelReading(
  facts: FloorPlanFacts,
  model: ModelPlanReading | null,
): FloorPlanFacts {
  if (!model) return facts;
  return {
    ...facts,
    // A storey count the drawing states, or a staircase we spotted, both outrank this.
    floors: facts.floors ?? model.floors,
    areaSqm: facts.areaSqm ?? model.grossAreaSqm,
    bedrooms: facts.bedrooms ?? model.rooms.bedrooms,
    bathrooms: facts.bathrooms ?? model.rooms.bathrooms,
    livingRooms: facts.livingRooms ?? model.rooms.livingRooms,
    kitchens: facts.kitchens ?? model.rooms.kitchens,
    model,
  };
}

/**
 * Ask the server to look at a plan.
 *
 * Never throws and never rejects. The extractor's reading is already on screen and is
 * what the budget is built from; this is an addition to it, and an addition that fails
 * has to be silent rather than take the upload step down.
 */
export async function readPlanWithModel(file: File): Promise<ModelPlanReading | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const pages = await renderPlanPages(file);
    if (!pages.length) return null;

    // One endpoint, many actions — Vercel's Hobby plan caps functions at 12 and every
    // file under api/ is one. See api/events.ts.
    const response = await fetch('/api/events?action=read-floor-plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ pages }),
    });
    if (!response.ok) return null;

    const body = await response.json() as { available?: boolean; reading?: unknown };
    if (!body.available || !body.reading) return null;
    return asReading(body.reading);
  } catch {
    return null;
  }
}

/**
 * Trust the shape, not the sender.
 *
 * The schema is enforced at the API, but what arrives here has crossed a network and a
 * JSON parse, and a `dwellingUnits` of "three" rendered into a sentence would be a bug
 * reported as nonsense on screen rather than as a type error.
 */
function asReading(value: unknown): ModelPlanReading | null {
  const raw = value as Partial<ModelPlanReading> & { rooms?: Record<string, unknown> };
  if (!raw || typeof raw !== 'object') return null;

  const count = (input: unknown): number | null =>
    typeof input === 'number' && Number.isInteger(input) && input >= 0 ? input : null;
  const text = (input: unknown): string =>
    typeof input === 'string' ? input.slice(0, 240) : '';

  return {
    sheets: Array.isArray(raw.sheets)
      ? raw.sheets.filter((s): s is SheetKind => typeof s === 'string') : [],
    buildingType: typeof raw.buildingType === 'string'
      ? raw.buildingType as BuildingType : null,
    dwellingUnits: count(raw.dwellingUnits),
    floors: count(raw.floors),
    grossAreaSqm: typeof raw.grossAreaSqm === 'number' && raw.grossAreaSqm > 0
      ? raw.grossAreaSqm : null,
    rooms: {
      bedrooms:    count(raw.rooms?.bedrooms),
      bathrooms:   count(raw.rooms?.bathrooms),
      kitchens:    count(raw.rooms?.kitchens),
      livingRooms: count(raw.rooms?.livingRooms),
    },
    confidence: raw.confidence === 'high' || raw.confidence === 'low'
      ? raw.confidence : 'medium',
    basis: {
      dwellingUnits: text((raw.basis as ModelPlanReading['basis'])?.dwellingUnits),
      floors:        text((raw.basis as ModelPlanReading['basis'])?.floors),
      buildingType:  text((raw.basis as ModelPlanReading['basis'])?.buildingType),
    },
  };
}
