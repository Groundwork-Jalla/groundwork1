/**
 * GoHighLevel API v2 — the authenticated connection.
 *
 * Phase 1 pushes events into inbound webhooks: fire, hope, forget. A webhook cannot tell
 * you the id of the contact it just created, so nothing can ever be *updated* — no tags,
 * no pipeline moves, no second event attaching to the same person. That ceiling is why
 * this exists.
 *
 * ── Auth: a Private Integration Token, not OAuth ──────────────────────────────────────
 * An OAuth marketplace app means storing a refresh token, refreshing it on a schedule,
 * and handling the refresh failing at 3am — infrastructure this codebase has no
 * precedent for and nobody to watch. A PIT is a long-lived token scoped to one location:
 * no refresh machinery, at the cost of being rotated by hand if it leaks. For a single
 * sub-account that is the right trade.
 *
 * ── EVERY REMOTE DETAIL IS IN THIS FILE, ON PURPOSE ───────────────────────────────────
 * The constants and request shapes below were written without a token to test against.
 * They follow GoHighLevel's documented v2 API, but they are *our* transcription of
 * someone else's contract and any of it can be wrong or can change. Keeping the base
 * URL, the version header and every path in one block means correcting them is a
 * five-line edit here rather than a search across the codebase.
 *
 * Verify against https://highlevel.stoplight.io before trusting the first live run, and
 * see docs/GHL-SETUP.md for what has to exist on the GHL side.
 */

// ── The remote contract. Check these first if anything 404s or 422s. ──────────────────
const API_BASE = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const PATHS = {
  upsertContact:     '/contacts/upsert',
  addTags:           (contactId: string) => `/contacts/${contactId}/tags`,
  searchOpportunity: '/opportunities/search',
  createOpportunity: '/opportunities/',
  updateOpportunity: (id: string) => `/opportunities/${id}`,
  uploadMedia:       '/medias/upload-file',
};

export interface GhlConfig {
  token: string;
  locationId: string;
}

/** Null when the API is not set up — callers fall back to the Phase 1 webhook. */
export function ghlConfig(): GhlConfig | null {
  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  return token && locationId ? { token, locationId } : null;
}

export interface GhlResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

/**
 * One request. Never throws — every caller is mirroring something already committed,
 * so a CRM problem must stay a reported result rather than an exception that could
 * fail a signup or a Stripe webhook.
 */
export async function ghlFetch<T = unknown>(
  cfg: GhlConfig,
  path: string,
  init: { method: string; body?: unknown; query?: Record<string, string> } ,
): Promise<GhlResult<T>> {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

  try {
    const r = await fetch(url.toString(), {
      method: init.method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Version: API_VERSION,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const text = await r.text();
    const data = text ? safeJson<T>(text) : undefined;

    if (!r.ok) {
      // Logged, not returned upstream: GHL error bodies can name account internals.
      console.error(`[ghl-api] ${init.method} ${path} → ${r.status}`, text.slice(0, 300));
      return { ok: false, status: r.status, error: `ghl ${r.status}` };
    }
    return { ok: true, status: r.status, data };
  } catch (err) {
    console.error(`[ghl-api] ${init.method} ${path} unreachable:`, err);
    return { ok: false, status: 0, error: 'unreachable' };
  }
}

function safeJson<T>(text: string): T | undefined {
  try { return JSON.parse(text) as T; } catch { return undefined; }
}

// ── Contacts ──────────────────────────────────────────────────────────────────────────

export interface UpsertContactInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  phone?: string | null;
  country?: string | null;
  city?: string | null;
  tags?: string[];
  /** Flat only — GHL custom fields cannot hold nested objects. */
  customFields?: Record<string, string | number | boolean | null>;
  source?: string;
}

/**
 * Create or update a contact, matched on email.
 *
 * This is what turns three separate CRM records — signed up, then applied, then
 * subscribed — into one person with a history. Returns the contact id, which is the
 * thing the whole of Phase 2 is built on: store it and every later event can address
 * the same contact instead of hoping GHL dedupes.
 */
export async function upsertContact(
  cfg: GhlConfig,
  input: UpsertContactInput,
): Promise<GhlResult<{ contactId: string }>> {
  const customFields = Object.entries(input.customFields ?? {})
    .filter(([, v]) => v !== null && v !== '')
    .map(([key, value]) => ({ key, field_value: value }));

  const r = await ghlFetch<{ contact?: { id?: string }; id?: string }>(cfg, PATHS.upsertContact, {
    method: 'POST',
    body: {
      locationId: cfg.locationId,
      email: input.email,
      firstName: input.firstName ?? undefined,
      lastName:  input.lastName  ?? undefined,
      name:      input.name      ?? undefined,
      phone:     input.phone     ?? undefined,
      country:   input.country   ?? undefined,
      city:      input.city      ?? undefined,
      tags:      input.tags?.length ? input.tags : undefined,
      source:    input.source,
      ...(customFields.length ? { customFields } : {}),
    },
  });

  if (!r.ok) return { ok: false, status: r.status, error: r.error };

  // The response has been seen shaped both ways across GHL's own docs, so accept either
  // rather than silently returning undefined and losing the id we came for.
  const contactId = r.data?.contact?.id ?? r.data?.id;
  if (!contactId) {
    console.error('[ghl-api] upsert succeeded but returned no contact id', r.data);
    return { ok: false, status: r.status, error: 'no_contact_id' };
  }
  return { ok: true, status: r.status, data: { contactId } };
}

/** Add tags to an existing contact. Tags already present are not duplicated by GHL. */
export async function addContactTags(
  cfg: GhlConfig,
  contactId: string,
  tags: string[],
): Promise<GhlResult<unknown>> {
  if (!tags.length) return { ok: true, status: 200 };
  return ghlFetch(cfg, PATHS.addTags(contactId), { method: 'POST', body: { tags } });
}

// ── Opportunities (the sales pipeline) ────────────────────────────────────────────────

export interface StageMove {
  contactId: string;
  pipelineId: string;
  stageId: string;
  /** Shown on the card in GHL. */
  name: string;
  monetaryValue?: number | null;
}

/**
 * Put a contact at a pipeline stage, creating the opportunity if they have none.
 *
 * Searches first so a person who progresses twice moves one card rather than
 * accumulating a card per event — which is what "move people through your pipeline
 * automatically" has to mean if the board is to stay readable.
 */
export async function moveToStage(
  cfg: GhlConfig,
  move: StageMove,
): Promise<GhlResult<{ opportunityId: string; created: boolean }>> {
  const found = await ghlFetch<{ opportunities?: Array<{ id?: string }> }>(
    cfg, PATHS.searchOpportunity, {
      method: 'GET',
      query: { location_id: cfg.locationId, contact_id: move.contactId, pipeline_id: move.pipelineId },
    });

  const existingId = found.ok ? found.data?.opportunities?.[0]?.id : undefined;

  if (existingId) {
    const r = await ghlFetch(cfg, PATHS.updateOpportunity(existingId), {
      method: 'PUT',
      body: { pipelineStageId: move.stageId, name: move.name },
    });
    return r.ok
      ? { ok: true, status: r.status, data: { opportunityId: existingId, created: false } }
      : { ok: false, status: r.status, error: r.error };
  }

  const r = await ghlFetch<{ opportunity?: { id?: string }; id?: string }>(
    cfg, PATHS.createOpportunity, {
      method: 'POST',
      body: {
        locationId: cfg.locationId,
        pipelineId: move.pipelineId,
        pipelineStageId: move.stageId,
        contactId: move.contactId,
        name: move.name,
        status: 'open',
        monetaryValue: move.monetaryValue ?? undefined,
      },
    });

  if (!r.ok) return { ok: false, status: r.status, error: r.error };
  const id = r.data?.opportunity?.id ?? r.data?.id;
  return id
    ? { ok: true, status: r.status, data: { opportunityId: id, created: true } }
    : { ok: false, status: r.status, error: 'no_opportunity_id' };
}

// ── Media (the applicant's documents) ─────────────────────────────────────────────────

/**
 * Hand GHL a file by URL and let it keep its own copy.
 *
 * `hosted: true` asks GHL to fetch the bytes itself rather than us streaming a multipart
 * body. That is the whole point of the short-lived signed links in `_documents.ts`: the
 * link lives just long enough for this call, GHL stores the file under its own access
 * control, and the temporary URL dies. What ends up in the CRM is a document behind
 * GHL's login, not a bearer URL that works for anyone who ever sees it.
 *
 * **Unverified, like the rest of this file.** The path and body shape come from
 * GoHighLevel's documentation, written without a token to test against. If uploads 404
 * or 422, this and the PATHS block above are the two places to look.
 */
/**
 * Which multipart shape this account accepts, remembered for the life of a warm function.
 * The first document pays for the discovery; every one after it goes straight there.
 */
let mediaVariant: number | null = null;

/**
 * Put a file into GHL's media library and return the URL it will live at.
 *
 * ── This does NOT send JSON, and that is the whole point ─────────────────────────────
 * It used to. GHL answered, plainly:
 *     400 "Unsupported content type: application/json"
 * `/medias/upload-file` wants the request a browser's file input produces —
 * multipart/form-data. Note that Content-Type is never set by hand below: `fetch` has to
 * generate the multipart boundary itself, and setting the header manually is exactly what
 * silently breaks that.
 *
 * What GHL's docs are not explicit about is where the location goes, and whether it wants
 * the bytes or a URL it can fetch. So the shapes are tried in order and the first success
 * is cached. `/admin/crm` → "Test a document upload" reports which one won; once that is
 * known for good this collapses to a single request.
 *
 * Takes a signed URL rather than bytes because that is what the caller already has, and
 * fetches it here — the link is short-lived by design (see `_documents.ts`).
 */
export async function uploadMediaFromUrl(
  cfg: GhlConfig,
  fileUrl: string,
  name: string,
): Promise<GhlResult<{ url: string; fileId?: string }>> {
  let bytes: ArrayBuffer;
  let contentType = 'application/octet-stream';
  try {
    const src = await fetch(fileUrl);
    // Our own storage failing is not a GHL failure, and must not be reported as one.
    if (!src.ok) return { ok: false, status: src.status, error: 'source_unreadable' };
    bytes = await src.arrayBuffer();
    contentType = src.headers.get('content-type') || contentType;
  } catch {
    return { ok: false, status: 0, error: 'source_unreachable' };
  }

  const ext = fileUrl.split('?')[0].match(/\.[a-zA-Z0-9]+$/)?.[0] ?? '';
  const filename = ext && !name.endsWith(ext) ? `${name}${ext}` : name;
  const file = new Blob([bytes], { type: contentType });

  const variants: Array<() => { url: string; body: FormData }> = [
    () => {
      const f = new FormData();
      f.append('file', file, filename);
      f.append('name', name);
      f.append('locationId', cfg.locationId);
      return { url: API_BASE + PATHS.uploadMedia, body: f };
    },
    () => {
      const f = new FormData();
      f.append('file', file, filename);
      f.append('name', name);
      return {
        url: `${API_BASE}${PATHS.uploadMedia}?altId=${encodeURIComponent(cfg.locationId)}&altType=location`,
        body: f,
      };
    },
    () => {
      const f = new FormData();
      f.append('hosted', 'true');
      f.append('fileUrl', fileUrl);
      f.append('name', name);
      f.append('locationId', cfg.locationId);
      return { url: API_BASE + PATHS.uploadMedia, body: f };
    },
  ];

  const all = variants.map((_, i) => i);
  const order = mediaVariant === null ? all : [mediaVariant, ...all.filter(i => i !== mediaVariant)];

  let lastStatus = 0;
  let lastError = 'media_upload_failed';

  for (const i of order) {
    const { url, body } = variants[i]();
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Version: API_VERSION,
          Accept: 'application/json',
        },
        body,
      });

      const text = await r.text();
      if (!r.ok) {
        lastStatus = r.status;
        lastError = text.slice(0, 200) || `http_${r.status}`;
        // 401/403 is the token, not the shape — trying other shapes cannot help.
        if (r.status === 401 || r.status === 403) break;
        continue;
      }

      mediaVariant = i;

      let data: { url?: string; fileUrl?: string; id?: string; fileId?: string } = {};
      try { data = text ? JSON.parse(text) : {}; } catch { /* handled below */ }

      // Shape has been seen both ways in GHL's own docs; accept either rather than
      // losing the file we just uploaded.
      const hosted = data.url ?? data.fileUrl;
      if (!hosted) {
        console.error('[ghl-api] media uploaded but returned no url', text.slice(0, 200));
        return { ok: false, status: r.status, error: 'no_media_url' };
      }
      return { ok: true, status: r.status, data: { url: hosted, fileId: data.id ?? data.fileId } };
    } catch (err) {
      lastStatus = 0;
      lastError = String(err).slice(0, 200);
    }
  }

  return { ok: false, status: lastStatus, error: lastError };
}
