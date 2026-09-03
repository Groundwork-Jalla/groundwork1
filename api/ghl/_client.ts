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

import { ghlSettings, type GhlKey } from './_config.js';

// ── The remote contract. Check these first if anything 404s or 422s. ──────────────────
const API_BASE = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const PATHS = {
  upsertContact:     '/contacts/upsert',
  addTags:           (contactId: string) => `/contacts/${contactId}/tags`,
  contactNotes:      (contactId: string) => `/contacts/${contactId}/notes`,
  searchOpportunity: '/opportunities/search',
  createOpportunity: '/opportunities/',
  updateOpportunity: (id: string) => `/opportunities/${id}`,
  uploadMedia:       '/medias/upload-file',
  listMedia:         '/medias/files',
  searchContacts:    '/contacts/search',
  pipelines:         '/opportunities/pipelines',
  // Puts a message on the contact's Conversations thread. `/inbound` is not a typo: it
  // is the endpoint for messages that happened *outside* GHL, and it takes a `direction`
  // — `/outbound` is call logs only. See `addConversationEmail`.
  inboundMessage:    '/conversations/messages/inbound',
  customFields:      (locationId: string) => `/locations/${locationId}/customFields`,
  // Folder creation is not part of GHL's published v2 media surface the way uploading is.
  // These are the plausible routes; `ensureFolder` tries them in order and remembers the
  // one that answers, and /admin/crm reports which. If all of them fail the upload still
  // happens, flat.
  createFolder:      ['/medias/create-folder', '/medias/folder', '/medias/folders'],
};

export interface GhlConfig {
  token: string;
  locationId: string;
}

/**
 * Null when the API is not set up — callers fall back to the Phase 1 webhook.
 *
 * Async because the token and location id now come from `app_config` before the
 * environment (see `_config.ts`), so they can be changed or rotated without a redeploy.
 * The lookup is cached for a minute, so this is a table read per warm container, not
 * per call.
 */
export async function ghlConfig(): Promise<GhlConfig | null> {
  const cfg = await ghlSettings();
  const token = cfg.GHL_API_TOKEN.value;
  const locationId = cfg.GHL_LOCATION_ID.value;
  return token && locationId ? { token, locationId } : null;
}

/**
 * One resolved setting, for the callers that need a value rather than a whole config.
 *
 * Same resolution as everything else — `app_config` first, environment second — so a
 * provider id can be pasted into the table and take effect within the minute, without a
 * redeploy. See `_config.ts`.
 */
export async function ghlSettingValue(key: GhlKey): Promise<string | undefined> {
  return (await ghlSettings())[key].value;
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
  init: {
    method: string;
    body?: unknown;
    query?: Record<string, string>;
    /** Overrides the Private Integration Token. Only the conversations call needs this. */
    bearer?: string;
  },
): Promise<GhlResult<T>> {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

  try {
    const r = await fetch(url.toString(), {
      method: init.method,
      headers: {
        Authorization: `Bearer ${init.bearer ?? cfg.token}`,
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
  /**
   * GHL's *native* company field, which is what the Contacts list "Business name" column
   * reads. Distinct from the `business_name` custom field: setting one does not fill the
   * other, and for a contractor the trading name is how you recognise them in a list.
   */
  companyName?: string | null;
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
      name:        input.name        ?? undefined,
      companyName: input.companyName ?? undefined,
      phone:       input.phone       ?? undefined,
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

// ── Conversations (the follow-up surface people actually use) ─────────────────────────

export interface ConversationEmail {
  contactId: string;
  subject: string;
  html: string;
  /** The address the email went to. */
  to: string;
  /** The address it came from. Our Resend sender, not a GHL mailbox. */
  from: string;
  sentAt?: Date;
}

/**
 * Put an email we sent onto the contact's Conversations thread.
 *
 * ── Why `/inbound` sends an outbound message ─────────────────────────────────────────
 * The naming is GoHighLevel's, and it reads backwards. `/conversations/messages/inbound`
 * means "a message that happened outside GHL, tell GHL about it" — it takes a `direction`
 * field, which is what decides how the thread renders it. `/conversations/messages`
 * would actually *send* the mail through GHL, and `/conversations/messages/outbound`
 * only accepts `type: "Call"`. So this is the one endpoint of the three that records an
 * email we already sent through Resend.
 *
 * ── `conversationProviderId` is required and cannot be invented ──────────────────────
 * GHL will not accept a message on a thread without naming the provider it came through,
 * and provider ids come from a Marketplace app of type Email — they cannot be created
 * from sub-account settings. So this is configuration, not code: `GHL_CONVERSATION_PROVIDER_ID`.
 * Without it, callers fall back to a note. See docs/GHL-SETUP.md, step 8.
 *
 * **Unverified against a live account.** Written from GoHighLevel's documentation, like
 * the media upload before it — which needed three attempts and a diagnostic button to
 * get right. `/admin/crm` → "Test the email log" is what answers this one; it reports the
 * status verbatim.
 */
export async function addConversationEmail(
  cfg: GhlConfig,
  providerId: string,
  email: ConversationEmail,
  /**
   * The Marketplace app's OAuth access token.
   *
   * This is the only call in the file that does not use the Private Integration Token,
   * and the reason is worth stating: the message is posted *as a conversation provider*,
   * a provider belongs to the app, so GHL requires the caller to be that app. A PIT is
   * scoped to the location and is not the app — which is why granting it
   * `conversations/message.write` and reissuing it both changed nothing, and the call
   * kept returning 401 on 3 Sep 2026. See `_oauth.ts`.
   *
   * Omitted falls back to the PIT, which preserves the old behaviour for anyone who has
   * not run the install flow — it will fail, but it fails the same way it used to.
   */
  bearer?: string,
): Promise<GhlResult<{ messageId?: string }>> {
  const r = await ghlFetch<Record<string, unknown>>(cfg, PATHS.inboundMessage, {
    method: 'POST',
    bearer,
    body: {
      type: 'Email',
      // GHL's default here is already 'outbound', but stated rather than assumed: a
      // default that flips would show every email we sent as one the contractor sent us.
      direction: 'outbound',
      conversationProviderId: providerId,
      // The conversation is resolved or created from the contact, so no thread has to be
      // looked up first and a person with no history still gets one.
      contactId: email.contactId,
      subject: email.subject,
      html: email.html,
      emailFrom: email.from,
      emailTo: email.to,
      date: (email.sentAt ?? new Date()).toISOString(),
    },
  });
  if (!r.ok) return { ok: false, status: r.status, error: r.error };

  const d = (r.data ?? {}) as Record<string, unknown>;
  const id = d.messageId ?? d.id ?? d._id;
  return { ok: true, status: r.status, data: { messageId: id ? String(id) : undefined } };
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

// ── Notes (the follow-up trail) ───────────────────────────────────────────────────────

/**
 * Write a note onto a contact's timeline in GHL.
 *
 * ── Why every outgoing email becomes one ─────────────────────────────────────────────
 * Transactional mail goes out through Resend, which GHL knows nothing about. So whoever
 * picks up the phone sees a contact with tags and custom fields and no idea that the
 * person was told two days ago their application was accepted — and either repeats it or
 * contradicts it. Asking "what have we already said to this person?" is most of what
 * follow-up is, and until now the CRM could not answer it.
 *
 * A note rather than a logged email: GHL's conversation surface expects mail sent through
 * GHL's own sending domain, which would mean moving transactional mail off Resend and
 * re-verifying deliverability for password resets and invites. A note appears on the same
 * timeline, is searchable, and costs nothing to keep in step.
 */
export async function addContactNote(
  cfg: GhlConfig,
  contactId: string,
  body: string,
): Promise<GhlResult<{ noteId?: string }>> {
  const r = await ghlFetch<Record<string, unknown>>(cfg, PATHS.contactNotes(contactId), {
    method: 'POST',
    body: { body },
  });
  if (!r.ok) return { ok: false, status: r.status, error: r.error };

  const d = (r.data ?? {}) as Record<string, unknown>;
  const nested = (d.note ?? {}) as Record<string, unknown>;
  const id = d.id ?? d._id ?? nested.id ?? nested._id;
  return { ok: true, status: r.status, data: { noteId: id ? String(id) : undefined } };
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

// ── Reading the contact book ──────────────────────────────────────────────────────────

export interface GhlContactRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  tags: string[];
  source: string;
  createdAt: string;
}

/**
 * Every contact in the location, a page at a time.
 *
 * Read-only, and used only by the audit. Pagination is the whole difficulty: an
 * unpaginated read looked fine against 10 custom fields and was wrong against 111, and
 * there is no reason to repeat that lesson against 600-odd contacts.
 *
 * `POST /contacts/search` is the documented v2 route for this. Like everything else in
 * this file it is our transcription of someone else's contract, so the response is read
 * tolerantly and a page that returns nothing recognisable ends the walk rather than
 * looping.
 */
export async function listContacts(
  cfg: GhlConfig,
  opts: { max?: number } = {},
): Promise<GhlResult<GhlContactRow[]>> {
  const max = opts.max ?? 2000;
  const out: GhlContactRow[] = [];
  let searchAfter: unknown[] | undefined;
  let lastStatus = 200;

  // Hard cap on iterations as well as on rows: a misread response shape must not become
  // an endless loop against someone's API quota.
  for (let page = 0; page < 40 && out.length < max; page++) {
    const r = await ghlFetch<Record<string, unknown>>(cfg, PATHS.searchContacts, {
      method: 'POST',
      body: {
        locationId: cfg.locationId,
        pageLimit: 100,
        ...(searchAfter ? { searchAfter } : {}),
      },
    });
    lastStatus = r.status;
    if (!r.ok) return out.length
      ? { ok: true, status: r.status, data: out }   // partial beats nothing
      : { ok: false, status: r.status, error: r.error };

    const d = (r.data ?? {}) as Record<string, unknown>;
    const rows = [d.contacts, d.data, r.data].find(Array.isArray) as
      | Array<Record<string, unknown>>
      | undefined;
    if (!rows?.length) break;

    for (const row of rows) {
      out.push({
        id:    String(row.id ?? row._id ?? ''),
        name:  String(row.contactName ?? row.name ?? '').trim(),
        email: String(row.email ?? '').trim().toLowerCase(),
        phone: String(row.phone ?? '').trim(),
        tags:  Array.isArray(row.tags) ? row.tags.map(String) : [],
        source: String(row.source ?? ''),
        createdAt: String(row.dateAdded ?? row.createdAt ?? ''),
      });
    }

    // GHL pages by echoing back the sort cursor of the last row.
    const last = rows[rows.length - 1] as Record<string, unknown>;
    const cursor = last.searchAfter;
    if (!Array.isArray(cursor) || cursor.length === 0) break;
    searchAfter = cursor;
  }

  return { ok: true, status: lastStatus, data: out };
}

// ── Pipelines ─────────────────────────────────────────────────────────────────────────

export interface GhlPipeline {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string }>;
}

/**
 * The pipelines and their stage ids.
 *
 * Exists because GoHighLevel puts the pipeline id in the URL and the stage ids nowhere a
 * person can reach — the usual advice is to open devtools and read them off the DOM,
 * which is a poor thing to ask of whoever is setting this up. `ghl_stage_map` needs them
 * exactly right, and a mistyped id disables every move while looking identical to "not
 * configured yet".
 */
export async function listPipelines(cfg: GhlConfig): Promise<GhlResult<GhlPipeline[]>> {
  const r = await ghlFetch<Record<string, unknown>>(cfg, PATHS.pipelines, {
    method: 'GET',
    query: { locationId: cfg.locationId },
  });
  if (!r.ok) return { ok: false, status: r.status, error: r.error };

  const d = (r.data ?? {}) as { pipelines?: unknown };
  const rows = [d.pipelines, r.data].find(Array.isArray) as
    | Array<Record<string, unknown>>
    | undefined;

  const out = (rows ?? []).map(p => {
    const stages = [p.stages, p.pipelineStages].find(Array.isArray) as
      | Array<Record<string, unknown>>
      | undefined;
    return {
      id:   String(p.id ?? p._id ?? ''),
      name: String(p.name ?? ''),
      stages: (stages ?? []).map(st => ({
        id:   String(st.id ?? st._id ?? ''),
        name: String(st.name ?? ''),
      })),
    };
  });

  return { ok: true, status: r.status, data: out };
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
 * The custom fields a location has, and creating the ones it does not.
 *
 * ── Why this is worth an API call ────────────────────────────────────────────────────
 * GHL drops any custom field it does not already have, silently and with a 200. On the
 * contact, a field that was never created looks exactly like a question the applicant
 * skipped. A contractor application carries over a hundred fields; three project
 * references went missing this way for weeks before anyone noticed, because "blank"
 * and "discarded" render identically.
 *
 * Creating a hundred fields by hand in the GHL console is not a reasonable ask, and doing
 * it by hand is also how two of them end up misspelled — at which point they are dropped
 * forever and look, again, like blanks.
 */
export interface GhlCustomField {
  id: string;
  /** The addressable key. GHL prefixes stored keys with `contact.`; compared without it. */
  key: string;
  name: string;
}

/** Strips GHL's `contact.` prefix so a key can be compared with what we send. */
const bareKey = (k: string) => k.replace(/^contact\./, '');

export async function listCustomFields(cfg: GhlConfig): Promise<GhlResult<GhlCustomField[]>> {
  const r = await ghlFetch<Record<string, unknown>>(cfg, PATHS.customFields(cfg.locationId), {
    method: 'GET',
  });
  if (!r.ok) return { ok: false, status: r.status, error: r.error };

  const d = (r.data ?? {}) as { customFields?: unknown; customField?: unknown };
  const rows = [d.customFields, d.customField, r.data].find(Array.isArray) as
    | Array<Record<string, unknown>>
    | undefined;

  const fields = (rows ?? []).map(row => ({
    id:   String(row.id ?? row._id ?? ''),
    key:  bareKey(String(row.fieldKey ?? row.key ?? '')),
    name: String(row.name ?? ''),
  })).filter(f => f.key);

  return { ok: true, status: r.status, data: fields };
}

/**
 * Creates one text custom field on the contact object.
 *
 * Everything is created as TEXT deliberately. The payload flattens numbers, booleans and
 * lists to text before sending (`buildContractorPayload`), so a typed field would reject
 * values it should accept — a NUMERICAL `upload_count` refusing an empty string, say —
 * and a rejected value is another silent blank.
 */
export async function createCustomField(
  cfg: GhlConfig,
  key: string,
  name: string,
): Promise<GhlResult<{ id: string; key: string }>> {
  // ── SEND THE KEY BARE. GHL ADDS THE `contact.` NAMESPACE ITSELF. ────────────────────
  // This used to prefix the key with `contact.`, reasoning that the stored keys come
  // back prefixed so they must go in prefixed. They do not. GHL strips the dot and keeps
  // the rest as the key, so `contact.project_1_location` became the field
  // `contact.contactproject_1_location` — 101 of them, on 31 Aug 2026.
  //
  // A doubled prefix is not a cosmetic problem. The upsert addresses fields by the key
  // WE choose, so every value would have been dropped on arrival and shown on the
  // contact as a blank — precisely the failure this whole module exists to prevent.
  const r = await ghlFetch<Record<string, unknown>>(cfg, PATHS.customFields(cfg.locationId), {
    method: 'POST',
    body: { name, fieldKey: key, dataType: 'TEXT', model: 'contact', placeholder: '' },
  });
  if (!r.ok) return { ok: false, status: r.status, error: r.error };

  const d = (r.data ?? {}) as Record<string, unknown>;
  const nested = (d.customField ?? d.field ?? {}) as Record<string, unknown>;
  const id = d.id ?? d._id ?? nested.id ?? nested._id;

  // Report the key GHL ACTUALLY assigned, not the one we asked for. A 200 here means
  // "a field was created", not "the field you wanted was created" — and the caller
  // counted 101 successes for 101 unusable fields because nothing checked.
  const assigned = bareKey(String(
    d.fieldKey ?? d.key ?? nested.fieldKey ?? nested.key ?? '',
  ));

  return {
    ok: true,
    status: r.status,
    data: { id: String(id ?? ''), key: assigned || key },
  };
}

/**
 * Remove a custom field.
 *
 * Only ever used to undo a field this code created wrongly. Deleting a field deletes
 * every value stored in it across every contact, so callers must match on an exact known
 * key rather than a pattern — see the repair path in crm-fields.ts.
 */
export async function deleteCustomField(
  cfg: GhlConfig,
  id: string,
): Promise<GhlResult<unknown>> {
  return ghlFetch(cfg, `${PATHS.customFields(cfg.locationId)}/${id}`, { method: 'DELETE' });
}

/**
 * One folder per applicant in GHL's media library.
 *
 * ── Why this is worth the trouble ────────────────────────────────────────────────────
 * Media Storage is a single flat library shared by the entire account — every applicant's
 * documents, every marketing image, every screenshot, in one scrolling grid. Good filenames
 * make an individual file identifiable; they do not make the library navigable. Once there
 * are thirty contractors with four documents each, "find Pierre's tax clearance" is a
 * scroll, not a lookup.
 *
 * ── The honest state of this ─────────────────────────────────────────────────────────
 * Uploading *into* a folder is supported and documented: `parentId` on the upload. Folder
 * *creation* is not published in v2 the way uploading is, so `PATHS.createFolder` holds
 * several candidates and this tries them in order, remembering whichever answers.
 *
 * **It never fails a sync.** A null return means "upload it flat" — a document that landed
 * in the wrong place is recoverable, a document that never uploaded because a folder call
 * 404'd is not. Filenames still identify the owner either way.
 */
const folderCache = new Map<string, string>();

/** Names the folder an applicant's documents belong in. Short id keeps namesakes apart. */
export function folderNameFor(who: string, applicationId: string): string {
  const person = who.replace(/[^a-zA-Z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
  return `${person || 'Contractor'} (${applicationId.slice(0, 8)})`;
}

/** Reads the media library and returns the id of a folder with this name, if one exists. */
async function findFolder(cfg: GhlConfig, name: string): Promise<string | null> {
  const r = await ghlFetch<Record<string, unknown>>(cfg, PATHS.listMedia, {
    method: 'GET',
    // `type` is required and must be non-empty — the listing returned
    //   422 ["type must be a string", "type should not be empty"]
    // without it, so every folder lookup failed and every document uploaded flat.
    // Harmless individually; it just meant Media Storage stayed one undifferentiated
    // library, which is the thing `ensureFolder` exists to prevent.
    query: { altId: cfg.locationId, altType: 'location', type: 'folder', limit: '100' },
  });
  if (!r.ok || !r.data) return null;

  // Shape is not pinned down, so accept the containers GHL has been seen to use rather
  // than depending on one of them.
  const d = r.data as { files?: unknown; medias?: unknown; data?: unknown };
  const rows = [d.files, d.medias, d.data, r.data].find(Array.isArray) as
    | Array<Record<string, unknown>>
    | undefined;
  if (!rows) return null;

  const hit = rows.find(row => {
    const isFolder = row.type === 'folder' || row.isFolder === true || row.kind === 'folder';
    return isFolder && typeof row.name === 'string' && row.name === name;
  });
  const id = hit?._id ?? hit?.id;
  return typeof id === 'string' ? id : null;
}

/** Returns a folder id, creating the folder if it does not exist. Null = upload flat. */
export async function ensureFolder(cfg: GhlConfig, name: string): Promise<string | null> {
  const key = `${cfg.locationId}:${name}`;
  const cached = folderCache.get(key);
  if (cached) return cached;

  try {
    const existing = await findFolder(cfg, name);
    if (existing) { folderCache.set(key, existing); return existing; }

    for (const path of PATHS.createFolder) {
      const r = await ghlFetch<Record<string, unknown>>(cfg, path, {
        method: 'POST',
        body: { name, altId: cfg.locationId, altType: 'location', locationId: cfg.locationId },
      });
      if (!r.ok) continue;

      const d = (r.data ?? {}) as Record<string, unknown>;
      const nested = (d.folder ?? d.data ?? {}) as Record<string, unknown>;
      const id = d._id ?? d.id ?? nested._id ?? nested.id;
      if (typeof id === 'string') { folderCache.set(key, id); return id; }
    }
  } catch (err) {
    console.warn('[ghl-api] folder lookup failed, uploading flat', err);
  }

  return null;
}

/**
 * Put a file into GHL's media library and return the URL it will live at.
 *
 * ── This does NOT send JSON, and that is the whole point ─────────────────────────────
 * It used to. GHL answered, in as many words:
 *     400 "Unsupported content type: application/json"
 * `/medias/upload-file` wants the request a browser's file input produces —
 * multipart/form-data, the file as an attachment, the location named in the form.
 *
 * Note that Content-Type is never set by hand below: `fetch` has to generate the
 * multipart boundary itself, and setting the header manually silently breaks the request
 * in a way indistinguishable from a server-side rejection. That is the whole bug.
 *
 * Confirmed against the live account on 26 Aug 2026 via /admin/crm → "Test a document
 * upload": a 3 MB image/jpeg returned **201** with `{ fileId, url }`. Two other plausible
 * arrangements were tried in that run and are no longer carried here; `crm-diagnose.ts`
 * still tries all of them, so if GHL ever moves this the button re-answers the question.
 *
 * Takes a signed URL rather than bytes because that is what the caller already has, and
 * fetches it here — the link is short-lived by design (see `_documents.ts`).
 */
export async function uploadMediaFromUrl(
  cfg: GhlConfig,
  fileUrl: string,
  name: string,
  /** Folder to drop it in. Omitted or null uploads to the top level. */
  parentId?: string | null,
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
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType }), ext && !name.endsWith(ext) ? `${name}${ext}` : name);
  form.append('name', name);
  form.append('locationId', cfg.locationId);
  if (parentId) form.append('parentId', parentId);

  try {
    const r = await fetch(API_BASE + PATHS.uploadMedia, {
      method: 'POST',
      // No Content-Type here. See above.
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Version: API_VERSION,
        Accept: 'application/json',
      },
      body: form,
    });

    const text = await r.text();
    if (!r.ok) return { ok: false, status: r.status, error: text.slice(0, 200) || `http_${r.status}` };

    let data: { url?: string; fileUrl?: string; id?: string; fileId?: string } = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* handled below */ }

    // The live response uses `url` and `fileId`; GHL's own docs also show `fileUrl` and
    // `id`. Accept either rather than losing a file that did upload.
    const hosted = data.url ?? data.fileUrl;
    if (!hosted) {
      console.error('[ghl-api] media uploaded but returned no url', text.slice(0, 200));
      return { ok: false, status: r.status, error: 'no_media_url' };
    }
    return { ok: true, status: r.status, data: { url: hosted, fileId: data.fileId ?? data.id } };
  } catch (err) {
    return { ok: false, status: 0, error: String(err).slice(0, 200) };
  }
}
