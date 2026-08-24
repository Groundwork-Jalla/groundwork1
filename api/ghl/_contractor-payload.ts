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

export interface ContractorLead {
  applicationId: string;
  email: string;
  fullName?: string | null;
  phone?: string | null;
  country?: string | null;
  city?: string | null;
  businessName?: string | null;
  role?: string | null;
  roleOther?: string | null;
  yearsExperience?: string | null;
  operatesAs?: string | null;
  concurrentProjects?: string | null;
  regions?: string | null;
  portfolioUrl?: string | null;
  videoUrl?: string | null;
  projectCount?: number | null;
  uploadCount?: number | null;
  status?: string | null;
  lang?: string | null;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function buildContractorPayload(lead: ContractorLead): Record<string, unknown> {
  // PUBLIC_APP_URL is a legacy alias only this path still accepts; PUBLIC_SITE_URL is the
  // documented name. Without the fallback an older deployment silently deep-links to the
  // wrong host on every CRM record.
  const appUrl = process.env.PUBLIC_APP_URL && !process.env.PUBLIC_SITE_URL
    ? process.env.PUBLIC_APP_URL.replace(/\/+$/, '')
    : siteUrl();

  // GHL stores first and last name separately, so send both alongside the full string.
  // The form asks for one "Full name" field on purpose — splitting on the first space is
  // a heuristic, not a truth. `full_name` stays authoritative and is what to display.
  const tags = contractorTags(lead.status, lead.lang);

  const fullName = str(lead.fullName) ?? '';
  const spaceAt  = fullName.indexOf(' ');
  const firstName = spaceAt === -1 ? fullName : fullName.slice(0, spaceAt);
  const lastName  = spaceAt === -1 ? ''       : fullName.slice(spaceAt + 1).trim();

  return {
    full_name:  fullName || null,
    first_name: firstName || null,
    last_name:  lastName  || null,
    email:      lead.email,
    phone:      str(lead.phone),
    country:    str(lead.country),
    city:       str(lead.city),

    // Custom fields — created once in GHL and mapped in the workflow.
    business_name:       str(lead.businessName),
    role:                str(lead.role),
    role_other:          str(lead.roleOther),
    years_experience:    str(lead.yearsExperience),
    operates_as:         str(lead.operatesAs),
    concurrent_projects: str(lead.concurrentProjects),
    regions:             str(lead.regions),
    portfolio_url:       str(lead.portfolioUrl),
    video_url:           str(lead.videoUrl),
    project_count:       num(lead.projectCount),
    upload_count:        num(lead.uploadCount),

    // "disqualified" means they answered No to a Section 6 standard. Branch the workflow
    // on this so screened-out applicants do not enter the main pipeline.
    status: lead.status === 'disqualified' ? 'disqualified' : 'pending',
    lang:   lead.lang === 'fr' ? 'fr' : 'en',

    // Deep link back to the full application — the part GHL deliberately does not hold.
    application_id:  lead.applicationId,
    application_url: `${appUrl}/admin/applications/${lead.applicationId}`,

    // Same tag vocabulary as every other lead, so one filter finds them all. `tags_csv`
    // is what GHL's "Add Tag" action can actually consume — an array arrives there as
    // unusable JSON.
    tags,
    tags_csv: tags.join(','),

    source: 'groundwork_contractor_application',
    submitted_at: new Date().toISOString(),
  };
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
