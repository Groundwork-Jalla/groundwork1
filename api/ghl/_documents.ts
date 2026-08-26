/**
 * Download links for an applicant's uploaded credentials.
 *
 * The documents are ID papers, business registrations and tax clearances. They live in a
 * **private** Supabase bucket with no public read, deliberately — `uploadCredential` even
 * namespaces the path by a random id so a guessed path is not a way in. None of that
 * survives being handed a permanent public URL.
 *
 * ── Why these expire quickly ─────────────────────────────────────────────────────────
 * A signed URL is a bearer token in a query string: anyone holding it is the owner of
 * that document for as long as it lasts. A year-long link pasted into a CRM field,
 * forwarded in an email, or read out of a workflow log is indistinguishable from
 * publishing the file.
 *
 * So these last minutes, not months. They exist to hand the bytes to GoHighLevel once,
 * so GHL can keep its own copy under its own access control — which is both what "the
 * files in GHL" means and the safer arrangement, because the copy is then behind GHL's
 * login rather than behind a naked URL.
 *
 * The consequence, stated plainly: **a link stored in a GHL custom field goes dead.**
 * That is the intended behaviour, not a bug to be fixed by lengthening the expiry. The
 * durable answer is uploading the file, and `application_url` is the permanent route to
 * the originals for anyone who needs them later.
 */

/** Long enough for GHL to fetch, short enough that a leaked link is worthless. */
const TTL_SECONDS = 15 * 60;

const BUCKET = 'contractor-docs';

/** Matches `UploadedFile` — kept structural so this module needs no browser imports. */
interface StoredUpload {
  label?: string;
  path?: string;
  size?: number;
}

/**
 * One URL per upload, in the same order. An entry that cannot be signed comes back as
 * an empty string rather than shifting the rest — the caller pairs these with labels by
 * index, and a silent shift would attach the wrong name to a document.
 *
 * Never throws: a missing link must not stop the application reaching the CRM.
 */
export async function signDocuments(
  svc: { storage: { from: (b: string) => { createSignedUrl: (p: string, s: number) => Promise<any> } } },
  uploads: unknown,
): Promise<string[]> {
  if (!Array.isArray(uploads) || uploads.length === 0) return [];

  const rows = uploads as StoredUpload[];

  return Promise.all(rows.map(async (u) => {
    const path = typeof u?.path === 'string' ? u.path : '';
    if (!path) return '';
    try {
      const { data, error } = await svc.storage.from(BUCKET).createSignedUrl(path, TTL_SECONDS);
      if (error || !data?.signedUrl) {
        console.warn('[ghl] could not sign document', path, error?.message);
        return '';
      }
      return data.signedUrl as string;
    } catch (err) {
      console.warn('[ghl] could not sign document', path, err);
      return '';
    }
  }));
}

/**
 * What a document is called once it is in GHL's media library.
 *
 * The first version led with the application id, so every file in Media Storage read as
 * `2538b51e-3d7a-4f22-8c2e-f9c714a692d6-1-…` — the UUID consumed the whole visible
 * filename and every applicant's documents looked identical. Media Storage is a flat,
 * shared library across the whole account; a name that does not say *whose* document it
 * is makes it unusable as soon as there is more than one contractor.
 *
 * So: who, then what, then a short id to keep two applications from the same person
 * apart. The extension is appended by the uploader from the source path.
 */
export function mediaName(
  who: string,
  label: string,
  applicationId: string,
  index: number,
): string {
  const slug = (v: string, max: number) =>
    v.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');

  const person = slug(who, 40) || 'contractor';
  const what   = slug(label, 40) || `document-${index + 1}`;
  return `${person}-${what}-${applicationId.slice(0, 8)}`;
}
