import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';
import { forwardToGhl } from '../ghl/_forward.js';

/**
 * Project created → GoHighLevel.
 *
 * A signup who actually starts a build is a different person, commercially, from one who
 * made an account and stopped. Nothing in the CRM could tell them apart, so this is the
 * event that separates them.
 *
 * The caller names a project id and nothing else. Ownership is checked against the row
 * before anything is sent, so this cannot be used to enumerate other people's projects
 * or push their details into the CRM — the id is a UUID, but guessing is not the only
 * way someone comes to hold one.
 */
export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { projectId } = req.body ?? {};
  if (typeof projectId !== 'string' || !projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }

  const user = await requireUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    console.error('[ghl] SUPABASE_SERVICE_ROLE_KEY is not set — project not forwarded');
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const { data: project } = await admin
    .from('projects')
    .select('id, name, country, city, tier, user_id')
    .eq('id', projectId)
    .maybeSingle();

  // The owner, or an admin who created it for them (migration 082). Same answer for
  // "no such project" and "not yours", so this cannot be used to test whether an id
  // exists.
  const { data: adminRow } = project && project.user_id !== user.id
    ? await admin.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin').maybeSingle()
    : { data: null };
  if (!project || (project.user_id !== user.id && !adminRow)) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  // The OWNER's profile, never the caller's. When an admin creates a project for a
  // client, the CRM card that gets a project stage is the client's — reading the
  // caller's profile here would file the client's build under the admin's contact.
  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, email, country, preferred_lang, ghl_contact_id')
    .eq('id', project.user_id)
    .maybeSingle();
  const ownerContactId = (profile?.ghl_contact_id as string | null) ?? null;

  // No session-email fallback: `user.email` is the caller's, and for an admin-created
  // project that is the wrong person. A profile with no email simply is not forwarded.
  const email = (profile?.email as string | null) ?? '';

  const result = await forwardToGhl('project_created', {
    email,
    fullName: profile?.full_name as string | null,
    country:  (profile?.country as string | null) ?? (project.country as string | null),
    lang:     profile?.preferred_lang as string | null,
  }, {
    // The OWNER, not the caller: this is identity metadata on the contact and in the
    // outbox, and an admin creating a project for a client must not stamp the client's
    // record with the admin's id (06 §17, found while designing the linkage backfill).
    user_id:      project.user_id as string,
    project_id:   project.id as string,
    project_name: (project.name as string | null) ?? '',
    project_tier: (project.tier as string | null) ?? '',
    build_country: (project.country as string | null) ?? '',
    build_city:    (project.city as string | null) ?? '',
  }, {
    dedupeKey: `project_created:${project.id}`,
    // Also as a tag, so "everyone on Jalla Verify" is a smart list rather than a
    // custom-field filter. See tierTag in _pipeline.ts.
    tier: project.tier as string | null,
    // Address the contact the owner is already linked to, when known, rather than
    // relying on GHL's email upsert to find the same person.
    contactId: ownerContactId,
  });

  // The OWNER's profile learns the contact the CRM now holds — as crm-user does on the
  // API path (06 §16.15: this handler never did, which is why homeowners created through
  // a project were unlinked and every inbound reply from them was `unmatched`). Never
  // over an id it already has: a second contact for the same person is a CRM problem to
  // merge, not something to paper over here — `.is(null)` makes that hold under a race.
  let linked = false;
  if (result.ok && result.contactId && !ownerContactId) {
    const { data: stamped, error: linkErr } = await admin
      .from('profiles')
      .update({ ghl_contact_id: result.contactId })
      .eq('id', project.user_id)
      .is('ghl_contact_id', null)
      .select('id');
    if (linkErr) console.warn('[ghl] project forwarded but owner contact id not stored:', linkErr);
    linked = !linkErr && (stamped?.length ?? 0) > 0;
  }

  // 200 either way: the project exists and the caller is fire-and-forget. The reason is
  // returned for the logs rather than for the browser, which ignores it.
  res.status(200).json({ ok: result.ok, reason: result.reason, linked });
}
