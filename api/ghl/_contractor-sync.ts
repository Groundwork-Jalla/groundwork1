import {
  ghlConfig, upsertContact, addContactTags, moveToStage, uploadMediaFromUrl,
  ensureFolder, folderNameFor,
} from './_client.js';
import { buildContractorPayload, NATIVE_CONTACT_FIELDS } from './_contractor-payload.js';
import { signDocuments, mediaName } from './_documents.js';
import { contractorTags, stageForKey } from './_pipeline.js';
import type { ContractorApplicationInput } from '../../src/lib/contractor/application-types.js';
import { normalisePhone } from './_phone.js';

/**
 * Put a contractor application into GoHighLevel through the API, documents and all.
 *
 * ── Why this exists alongside the webhook ────────────────────────────────────────────
 * The webhook has driven contractor applications since before any of this, and Philip's
 * workflow is built on it. It is still fired: removing it would silently switch off
 * automations nobody asked to lose. But a webhook cannot return a contact id and cannot
 * take a file, so it can never satisfy "every field including the documents".
 *
 * So both run. The webhook keeps the existing automation working; this adds the contact
 * id, the custom fields and the documents. They converge on one contact because the
 * upsert matches on email, and tags are idempotent.
 *
 * ── The documents ────────────────────────────────────────────────────────────────────
 * Each file is signed for fifteen minutes and handed to GHL by URL. GHL fetches the
 * bytes and keeps its own copy, so what ends up on the contact is a document behind
 * GHL's login rather than a bearer URL that works for anyone who ever sees it. The
 * temporary link is dead long before it could leak — see `_documents.ts`.
 *
 * Never throws. The application is already saved and the applicant already emailed; a
 * CRM problem is reported and dropped, never surfaced.
 */

export interface ContractorSyncResult {
  ok: boolean;
  skipped?: 'not_configured';
  contactId?: string;
  documentsUploaded?: number;
  documentsFailed?: number;
  reason?: string;
}

export async function syncContractorToApi(
  application: ContractorApplicationInput,
  applicationId: string,
  status: string | null,
  storage: Parameters<typeof signDocuments>[0],
): Promise<ContractorSyncResult> {
  const cfg = await ghlConfig();
  if (!cfg) return { ok: false, skipped: 'not_configured' };

  try {
    // ── Documents first: the payload wants the permanent URLs, not the temporary ones ──
    const signed = await signDocuments(storage, application.uploads);
    const uploads = Array.isArray(application.uploads) ? application.uploads : [];

    // One folder per applicant, resolved once. Null means GHL would not give us one, in
    // which case everything still uploads — flat, and still named for the person.
    const folderId = await ensureFolder(
      cfg,
      folderNameFor(application.fullName || application.businessName, applicationId),
    );

    const hosted: string[] = [];
    let failed = 0;

    for (let i = 0; i < signed.length; i++) {
      const url = signed[i];
      if (!url) { hosted.push(''); failed++; continue; }

      // Named for the person, not the row id — Media Storage is one flat library for
      // the whole account, and a UUID there identifies nobody. See `mediaName`.
      const name = mediaName(
        application.fullName || application.businessName,
        uploads[i]?.label ?? '',
        applicationId,
        i,
      );

      const up = await uploadMediaFromUrl(cfg, url, name, folderId);
      if (up.ok && up.data) {
        hosted.push(up.data.url);
      } else {
        // One unreadable document must not cost the other five, or the contact.
        console.warn('[ghl] document upload failed for', applicationId, i + 1, up.error);
        hosted.push('');
        failed++;
      }
    }

    // ── The contact ──
    const payload = buildContractorPayload({
      ...application,
      applicationId,
      status,
      documentUrls: hosted,
    });

    // GHL custom fields hold flat text. `tags` is an array and is passed separately;
    // anything else non-scalar would arrive as unusable JSON, so it is dropped here
    // rather than silently corrupting a field.
    const customFields: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (key === 'tags') continue;
      // Sent below as real contact properties. Duplicating them here would put a second
      // Phone and a second Email on every contact, and the duplicate phone is the one
      // someone would copy into WhatsApp — where it would not work.
      if (NATIVE_CONTACT_FIELDS.has(key)) continue;
      if (value === null || value === undefined) continue;
      if (typeof value === 'object') continue;
      customFields[key] = value as string | number | boolean;
    }

    const tags = contractorTags(status, application.lang);

    const up = await upsertContact(cfg, {
      email:     application.email,
      firstName: String(payload.first_name ?? '') || null,
      lastName:  String(payload.last_name ?? '') || null,
      name:      String(payload.full_name ?? '') || null,
      // The old GHL workflow set this and the API did not, so every contact the API
      // created showed a blank Business name in the contacts list while the duplicate
      // beside it showed the trading name.
      companyName: application.businessName || null,
      // E.164. This is the field WhatsApp and SMS actually address, so it is the one
      // that has to be normalised — a contractor stored as `670000000` cannot be
      // messaged at all, however complete the rest of the contact looks.
      phone:     normalisePhone(application.phone, application.country) ?? application.phone ?? null,
      country:   application.country || null,
      city:      application.city || null,
      tags,
      customFields,
      source: 'groundwork_contractor_application',
    });

    if (!up.ok || !up.data) {
      return { ok: false, reason: up.error, documentsUploaded: hosted.filter(Boolean).length, documentsFailed: failed };
    }

    // Additive by definition, unlike the upsert's tag field which has been seen to
    // replace on some accounts — losing an earlier tag would quietly shrink an audience.
    await addContactTags(cfg, up.data.contactId, tags);

    // ── Onto the board ──────────────────────────────────────────────────────────────
    // An applicant used to reach GHL as a contact and nothing else, so there was no card
    // to move from "Applied" to "Interview scheduled". Mapping `contractor_application`
    // in ghl_stage_map puts one there the moment they apply, which is what makes the
    // acknowledgement something you can act on rather than just read.
    //
    // Unmapped is the normal, harmless case — nobody is moved, exactly as before. A
    // failed move is deliberately not a failed sync: the contact is in the CRM with the
    // right tags and fields, which is most of the value, and a board can be corrected.
    const stage = await stageForKey('contractor_application');
    if (stage) {
      const moved = await moveToStage(cfg, {
        contactId: up.data.contactId,
        pipelineId: stage.pipelineId,
        stageId: stage.stageId,
        name: application.fullName?.trim() || application.businessName || application.email,
      });
      if (!moved.ok) {
        console.warn('[ghl] could not place', applicationId, 'on the pipeline:', moved.error);
      }
    }

    return {
      ok: true,
      contactId: up.data.contactId,
      documentsUploaded: hosted.filter(Boolean).length,
      documentsFailed: failed,
    };
  } catch (err) {
    console.error('[ghl] contractor API sync failed for', applicationId, err);
    return { ok: false, reason: 'exception' };
  }
}
