import { getSupabaseAdmin, requireUser } from '../_lib/stripe.js';
import { forwardToGhl } from './_forward.js';

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
export default async function handler(req: any, res: any) {
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

  // Same answer for "no such project" and "not yours", so this cannot be used to test
  // whether an id exists.
  if (!project || project.user_id !== user.id) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, email, country, preferred_lang')
    .eq('id', user.id)
    .maybeSingle();

  const email = (profile?.email as string | null) ?? user.email ?? '';

  const result = await forwardToGhl('project_created', {
    email,
    fullName: profile?.full_name as string | null,
    country:  (profile?.country as string | null) ?? (project.country as string | null),
    lang:     profile?.preferred_lang as string | null,
  }, {
    user_id:      user.id,
    project_id:   project.id as string,
    project_name: (project.name as string | null) ?? '',
    project_tier: (project.tier as string | null) ?? '',
    build_country: (project.country as string | null) ?? '',
    build_city:    (project.city as string | null) ?? '',
  }, {
    dedupeKey: `project_created:${project.id}`,
  });

  // 200 either way: the project exists and the caller is fire-and-forget. The reason is
  // returned for the logs rather than for the browser, which ignores it.
  res.status(200).json({ ok: result.ok, reason: result.reason });
}
