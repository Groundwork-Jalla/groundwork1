import { siteUrl } from '../../src/lib/site-url.js';
import { contractorTags } from './_pipeline.js';

/**
 * The contractor-application payload, in one place.
 *
 * Two callers now build it: `contractor.ts` at submission, from the browser's body, and
 * `resync-application.ts` from the stored row when the first attempt missed. They must
 * produce byte-identical shapes — Philip's GHL workflow maps these field names, and a
 * resync that sent slightly different keys would land as a half-populated contact that
 * looks like a data problem rather than a retry.
 *
 * Kept separate from `_forward.ts` on purpose: that one carries lifecycle events on the
 * shared events webhook, this one is the original contractor lead on its own webhook and
 * its own workflow, which already works.
 */

import type { ContractorApplicationInput } from '../../src/lib/contractor/application-types.js';
import { normalisePhone } from './_phone.js';
import { translator, type TKey } from '../../src/lib/i18n/translate.js';

/** How many repeatable rows are flattened. Beyond this, the deep link is the answer. */
const MAX_PROJECTS = 5;
/**
 * Raised from 6 after a real applicant sent 8. The upload field is `multiple` with no
 * limit, so no number here is ever the fix — every document is listed with its link in
 * `documents_summary` regardless of this cap. These numbered fields exist so GHL can
 * filter and automate on a document; the summary exists so none is ever unreachable.
 */
const MAX_DOCUMENTS = 8;

export interface ContractorLead extends ContractorApplicationInput {
  applicationId: string;
  status?: string | null;
  /** Short-lived download links, resolved by the caller. Empty when unavailable. */
  documentUrls?: string[];
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * One line, single-spaced, or null.
 *
 * For anything that can be merged into a WhatsApp template. Meta rejects a variable that
 * contains a newline, a tab, or four or more consecutive spaces — the send fails, it does
 * not degrade — and two of these fields are free text somebody typed into a textarea.
 * A contractor who pressed Enter between two regions would otherwise never receive the
 * message that was about them, with an error that names none of this.
 */
const line = (v: unknown): string | null => {
  const s = str(v);
  return s ? s.replace(/\s+/g, ' ').trim() || null : null;
};
const yn  = (v: unknown) => (v === true ? 'Yes' : v === false ? 'No' : null);

/** GHL custom fields are flat text. An array or object arrives as unusable JSON. */
function flat(v: unknown): string | null {
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : null;
  if (v && typeof v === 'object') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return str(v);
}

/**
 * Everything the applicant typed, flattened for GHL.
 *
 * The form has three shapes GHL cannot hold: a repeatable project history, a credentials
 * object whose keys change with the role, and uploaded files. Each is flattened rather
 * than dropped, because "manage it in GHL" fails the moment someone has to open the admin
 * console to answer a basic question about an applicant.
 *
 *   projects     → project_1_name, project_1_ref_email, … up to MAX_PROJECTS
 *   credentials  → cred_<key>, since the keys differ per credential track
 *   uploads      → document_1_label / _url, … up to MAX_DOCUMENTS
 *
 * Anything past those caps stays reachable through `application_url`, and every document
 * — capped or not — is listed with its link in `documents_summary`. A contact record is
 * a summary; the application itself is the record.
 */
export function buildContractorPayload(lead: ContractorLead): Record<string, unknown> {
  // PUBLIC_APP_URL is a legacy alias only this path still accepts; PUBLIC_SITE_URL is the
  // documented name. Without the fallback an older deployment silently deep-links to the
  // wrong host on every CRM record.
  const appUrl = process.env.PUBLIC_APP_URL && !process.env.PUBLIC_SITE_URL
    ? process.env.PUBLIC_APP_URL.replace(/\/+$/, '')
    : siteUrl();

  const tags = contractorTags(lead.status, lead.lang);

  // ── Labels, not keys ──────────────────────────────────────────────────────────────
  //
  // The form stores `y10`, `two_three`, `other`. Those are the right thing to STORE —
  // they are what filtering and matching key on — and the wrong thing to send anywhere a
  // person reads. A contact synced on 10 Sep carried `role: other` and
  // `years_experience: y10`, and a WhatsApp template merging `{{contact.role}}` would
  // have sent "Trade applied for: other" to the contractor it was about.
  //
  // Labels come from the dictionary rather than a lookup table written here. There is
  // already one place these strings live, and `contractor-application-html.ts` resolves
  // them exactly this way for the application email — a second copy would be wrong the
  // first time a trade is added, and would only be wrong in the CRM.
  //
  // In the APPLICANT'S language, matching the email builder and the EN/FR split of the
  // WhatsApp templates: a French contractor reading "Trade applied for: Maçon" is the
  // point of translating at all.
  const t = translator(lead.lang === 'fr' ? 'fr' : 'en');

  /**
   * One option's label, or the raw value if the dictionary has no entry.
   *
   * `translate()` returns the key itself when a lookup misses, so without the guard an
   * enum value added to the form but not to the dictionary would put
   * `contractorApply.form.role.foo` into the CRM — worse than the key it replaced.
   */
  const optionLabel = (group: string, value: unknown): string | null => {
    const v = str(value);
    if (!v) return null;
    const key = `contractorApply.form.${group}.${v}`;
    const hit = t(key as TKey);
    return hit === key ? v : hit;
  };

  const optionLabels = (group: string, values: unknown): string | null => {
    if (!Array.isArray(values) || !values.length) return null;
    const out = values.map(v => optionLabel(group, v)).filter(Boolean);
    return out.length ? out.join(', ') : null;
  };

  /**
   * Capitalise a place name the way French does it.
   *
   * `l'ouest` is the Ouest region behind an elided article. Upcasing the first character
   * gives `L'ouest`, which is wrong in the language it is written in — the article stays
   * lowercase and the noun takes the capital: `l'Ouest`. This is the first thing a
   * Cameroonian contractor reads about themselves, so it is worth getting right.
   *
   * Handles `l'`, `d'` and the curly apostrophe. Anything else is upcased on its first
   * letter, as before.
   */
  const capitalise = (x: string): string => {
    const m = x.match(/^([ld])(['\u2019])\s*(\S)(.*)$/i);
    if (m) return `${m[1].toLowerCase()}'${m[3].toUpperCase()}${m[4]}`;
    return x.charAt(0).toUpperCase() + x.slice(1);
  };

  /**
   * `regions` is a free-text textarea, not a multi-select — so there is no option list to
   * map it against, and the messy value observed in GHL
   * (`Kribi,buea.limbe, l'ouest, ebolowa`) is what the applicant actually typed.
   *
   * All this does is separate, single-space and capitalise. It deliberately drops nothing
   * and invents nothing: turning `l'Ouest` into `Ouest` needs a list of region names, and
   * guessing at one would silently rewrite what somebody told us. Making this a real
   * multi-select is the actual fix and is a form change.
   */
  const tidyRegions = (v: unknown): string | null => {
    const raw = str(v);
    if (!raw) return null;
    const parts = raw
      .split(/[,;/\n]+|\.(?=\s*\S)/)
      .map(x => line(x))
      .filter((x): x is string => !!x)
      .map(capitalise);
    return parts.length ? parts.join(', ') : null;
  };

  // GHL stores first and last name separately, so send both alongside the full string.
  // The form asks for one "Full name" field on purpose — splitting on the first space is
  // a heuristic, not a truth. `full_name` stays authoritative and is what to display.
  const fullName = str(lead.fullName) ?? '';
  const spaceAt  = fullName.indexOf(' ');
  const firstName = spaceAt === -1 ? fullName : fullName.slice(0, spaceAt);
  const lastName  = spaceAt === -1 ? ''       : fullName.slice(spaceAt + 1).trim();

  const projects = Array.isArray(lead.projects) ? lead.projects : [];
  const uploads  = Array.isArray(lead.uploads)  ? lead.uploads  : [];
  const urls     = lead.documentUrls ?? [];

  const out: Record<string, unknown> = {
    full_name:  fullName || null,
    first_name: firstName || null,
    last_name:  lastName  || null,
    email:      lead.email,
    // E.164, so GHL can actually message them. A number stored the way people type it
    // — `670 00 00 00` — looks like a filled-in phone field and cannot be reached by
    // WhatsApp or SMS. Falls back to the raw string when it cannot be placed.
    phone:      normalisePhone(lead.phone, lead.country) ?? str(lead.phone),
    country:    str(lead.country),
    city:       str(lead.city),

    // ── Section 1–3: who they are and how they work ──
    business_name:       str(lead.businessName),
    // `other` means the trade is in the free-text field beside it. Falling through to
    // the literal string "other" is what put it in front of a contractor; falling
    // through to null is no better, because GHL has no default for an empty merge field
    // and the send fails outright.
    role: lead.role === 'other'
      ? (line(lead.roleOther) ?? 'Other')
      : optionLabel('role', lead.role),
    // Kept as typed, and kept as its own field: `role` now carries it for display, but
    // the raw answer is still the record of what they wrote. Single-lined for the same
    // reason as `role` — it is also a template variable.
    role_other:          line(lead.roleOther),
    years_experience:    optionLabel('years', lead.yearsExperience),
    operates_as:         optionLabel('operates', lead.operatesAs),
    // Free-text numeric on the form — no options, nothing to map.
    team_size:           str(lead.teamSize),
    project_types:       optionLabels('projectType', lead.projectTypes),
    concurrent_projects: optionLabel('concurrent', lead.concurrentProjects),
    regions:             tidyRegions(lead.regions),
    portfolio_url:       str(lead.portfolioUrl),
    video_url:           str(lead.videoUrl),

    // ── Section 6: the professional standards. These decide the screen-out. ──
    accepts_milestones:   yn(lead.acceptsMilestones),
    accepts_verification: yn(lead.acceptsVerification),
    accepts_no_side_pay:  yn(lead.acceptsNoSidePay),

    // ── Section 7: in their own words. Long text, and the most useful part of a call. ──
    why_join:        str(lead.whyJoin),
    differentiator:  str(lead.differentiator),
    ready_for_early: yn(lead.readyForEarly),
    agreed_to_terms: yn(lead.agreedToTerms),

    project_count: projects.length,
    upload_count:  uploads.length,

    // "disqualified" means they answered No to a Section 6 standard. Branch the workflow
    // on this so screened-out applicants do not enter the main pipeline.
    status: lead.status === 'disqualified' ? 'disqualified' : 'pending',
    lang:   lead.lang === 'fr' ? 'fr' : 'en',

    // Deep link back to the full application — the part GHL cannot hold.
    application_id:  lead.applicationId,
    application_url: `${appUrl}/admin/applications/${lead.applicationId}`,

    tags,
    tags_csv: tags.join(','),

    source: 'groundwork_contractor_application',
    // Contractor or homeowner, in one readable word. GHL's native "Contact type" is a
    // fixed Lead/Customer field and cannot express this — see partyFor in _pipeline.ts.
    groundwork_party: 'Contractor',
    submitted_at: new Date().toISOString(),
  };

  // ── Credentials: keys differ per role, so they cannot be a fixed list ──
  //
  // LOWERCASED, because GoHighLevel folds custom-field keys to lower case and there is
  // no way to make it keep a capital. The credential keys are camelCase in our own model
  // (`avgProject`, `workStyle`), so sending them unchanged asked GHL for a field it can
  // never create: six of them failed on 31 Aug 2026 while the three already-lowercase
  // ones succeeded, which is what made the rule visible.
  //
  // The important half is not the create. It is that the upsert addresses fields by this
  // same key, so a camelCase key would have been silently discarded on every sync — a
  // blank on the contact, indistinguishable from a question the applicant skipped.
  for (const [key, value] of Object.entries(lead.credentials ?? {})) {
    const v = flat(value);
    if (v !== null) out[`cred_${key.toLowerCase()}`] = v;
  }

  // ── Project history ──
  projects.slice(0, MAX_PROJECTS).forEach((proj, i) => {
    const n = i + 1;
    out[`project_${n}_name`]      = str(proj.name);
    out[`project_${n}_location`]  = str(proj.location);
    out[`project_${n}_budget`]    = str(proj.budget);
    out[`project_${n}_role`]      = str(proj.role);
    out[`project_${n}_year`]      = str(proj.year);
    out[`project_${n}_ref_name`]  = str(proj.refName);
    out[`project_${n}_ref_phone`] = str(proj.refPhone);
    out[`project_${n}_ref_email`] = str(proj.refEmail);
  });

  // One readable block as well as the split fields — this is what belongs in a Note, and
  // what someone reads before picking up the phone.
  out.projects_summary = projects.length
    ? projects.map((p, i) =>
        `${i + 1}. ${p.name || '—'} (${p.location || '—'}, ${p.year || '—'})` +
        ` · ${p.budget || 'budget not given'}` +
        ` · ref: ${p.refName || '—'} ${p.refEmail || ''} ${p.refPhone || ''}`.trimEnd(),
      ).join('\n')
    : null;

  // ── Documents ──
  uploads.slice(0, MAX_DOCUMENTS).forEach((doc, i) => {
    const n = i + 1;
    out[`document_${n}_label`] = str(doc.label);
    out[`document_${n}_size`]  = typeof doc.size === 'number' ? doc.size : null;
    // Present only when the caller could resolve one. These expire by design — see the
    // note in api/ghl/contractor.ts on why they are short-lived.
    if (urls[i]) out[`document_${n}_url`] = urls[i];
  });

  // Every document, not just the flattened ones, each with its link where we have one.
  // Uploads past MAX_DOCUMENTS are still pushed to GHL's media storage by the sync, so
  // without this they would sit there with nothing on the contact pointing at them.
  out.documents_summary = uploads.length
    ? uploads.map((d, i) => {
        const line = `${i + 1}. ${d.label || 'Document'}`;
        return urls[i] ? `${line} — ${urls[i]}` : line;
      }).join('\n')
    : null;

  return out;
}

/**
 * Flag the application as forwarded, so `WHERE NOT synced_to_ghl` finds anything that
 * missed the CRM. Never throws — the lead is already in GHL by the time this runs, and
 * losing the bookkeeping is not worth failing the request over.
 */
export async function markApplicationSynced(applicationId: string): Promise<void> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    await createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      .from('contractor_applications')
      .update({ synced_to_ghl: true, synced_to_ghl_at: new Date().toISOString() })
      .eq('id', applicationId);
  } catch (err) {
    console.warn('[ghl] application forwarded but could not be marked synced:', err);
  }
}

/** Every credential key the form can set, across all four credential tracks. */
const CRED_KEYS = [
  'avgProject', 'diaspora', 'diasporaProperty', 'legalServices',
  'paymentStructure', 'services', 'software', 'tradeProjects', 'workStyle',
];

/**
 * Every custom field a contractor application can ever set.
 *
 * Derived by running the builder over a maximal application rather than written out by
 * hand. A hand-written list drifts the moment someone adds a field, and the consequence
 * of drift here is invisible: **GoHighLevel silently discards a value whose field does
 * not exist**, so a missing name shows up as a blank on the contact — identical to a
 * question the applicant skipped. Projects 1–3 were being dropped this way for weeks.
 *
 * Used by the admin "create missing fields" action, which is the only sane way to get a
 * hundred-odd fields into GHL.
 */
/**
 * Payload keys that GoHighLevel already has a **native** contact field for.
 *
 * `upsertContact` sends each of these as a real contact property — the boxes GHL's own
 * UI shows at the top of a contact, and the ones its features read. Sending them a
 * second time as custom fields would give every contact two Phones, two Emails and two
 * Cities, one of which is the real one.
 *
 * That is not merely untidy. WhatsApp and SMS address the **native** phone: a duplicate
 * custom `phone` beside it is the field someone will read, copy, and wonder why the
 * message never arrived. Duplicates on a CRM record are a support burden forever.
 *
 * So these are stripped from the custom-field payload and excluded from the list the
 * "create missing fields" action offers — nothing is lost, because the native field
 * carries the same value.
 */
export const NATIVE_CONTACT_FIELDS = new Set([
  'email', 'first_name', 'last_name', 'full_name', 'phone', 'country', 'city', 'source',
]);

export function contractorFieldKeys(): string[] {
  const pad = (n: number, make: (i: number) => unknown) => Array.from({ length: n }, (_, i) => make(i));


  const payload = buildContractorPayload({
    applicationId: 'x', status: 'pending',
    fullName: 'x x', businessName: 'x', phone: 'x', email: 'x@x.x',
    country: 'CM', city: 'x', portfolioUrl: 'x',
    role: 'general_contractor', roleOther: 'x',
    yearsExperience: 'x', operatesAs: 'x', teamSize: 'x', projectTypes: ['x'],
    credentials: Object.fromEntries(CRED_KEYS.map(k => [k, 'x'])),
    uploads:  pad(MAX_DOCUMENTS, i => ({ label: `x${i}`, path: `x${i}.pdf`, size: 1 })) as never,
    projects: pad(MAX_PROJECTS,  i => ({
      name: `x${i}`, location: 'x', budget: 'x', role: 'x', year: 'x',
      refName: 'x', refPhone: 'x', refEmail: 'x@x.x',
    })) as never,
    acceptsMilestones: true, acceptsVerification: true, acceptsNoSidePay: true,
    videoUrl: 'x', whyJoin: 'x', differentiator: 'x', readyForEarly: true,
    regions: 'x', concurrentProjects: 'x', agreedToTerms: true, lang: 'en',
    documentUrls: pad(MAX_DOCUMENTS, i => `https://x/${i}`) as string[],
  });

  // `tags` is an array handled separately by the upsert, not a custom field, and the
  // native fields already exist on every GHL contact — see NATIVE_CONTACT_FIELDS.
  return Object.keys(payload)
    .filter(k => k !== 'tags' && !NATIVE_CONTACT_FIELDS.has(k))
    .sort();
}
