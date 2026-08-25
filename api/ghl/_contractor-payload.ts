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

/** How many repeatable rows are flattened. Beyond this, the deep link is the answer. */
const MAX_PROJECTS = 5;
const MAX_DOCUMENTS = 6;

export interface ContractorLead extends ContractorApplicationInput {
  applicationId: string;
  status?: string | null;
  /** Short-lived download links, resolved by the caller. Empty when unavailable. */
  documentUrls?: string[];
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
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
 * Anything past those caps stays reachable through `application_url`. A contact record is
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
    phone:      str(lead.phone),
    country:    str(lead.country),
    city:       str(lead.city),

    // ── Section 1–3: who they are and how they work ──
    business_name:       str(lead.businessName),
    role:                str(lead.role),
    role_other:          str(lead.roleOther),
    years_experience:    str(lead.yearsExperience),
    operates_as:         str(lead.operatesAs),
    team_size:           str(lead.teamSize),
    project_types:       flat(lead.projectTypes),
    concurrent_projects: str(lead.concurrentProjects),
    regions:             str(lead.regions),
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
    submitted_at: new Date().toISOString(),
  };

  // ── Credentials: keys differ per role, so they cannot be a fixed list ──
  for (const [key, value] of Object.entries(lead.credentials ?? {})) {
    const v = flat(value);
    if (v !== null) out[`cred_${key}`] = v;
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

  out.documents_summary = uploads.length
    ? uploads.map((d, i) => `${i + 1}. ${d.label || 'Document'}`).join('\n')
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
