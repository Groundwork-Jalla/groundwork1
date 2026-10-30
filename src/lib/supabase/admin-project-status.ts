import { supabase } from './client';

// =========================================================
// Business status per project, read from the 169 view.
//
// general | qualified | verified, defined once in SQL so every surface counts the
// same thing (169). This is the read side; the rule itself lives in the migration and
// must not be re-derived here.
//
// A database without 169 returns an empty map rather than throwing. The admin pages
// then simply do not offer the business-status tiles, which is the same guard the rest
// of the admin surface uses for a migration that is not applied yet: a missing feature
// is hidden, never an error page.
// =========================================================

export type BusinessStatus = 'general' | 'qualified' | 'verified';

export async function fetchBusinessStatuses(): Promise<Map<string, BusinessStatus>> {
  const out = new Map<string, BusinessStatus>();
  const { data, error } = await supabase
    .from('project_business_statuses')
    .select('project_id, business_status');
  if (error) return out;
  for (const row of (data ?? []) as { project_id: string; business_status: string }[]) {
    const s = row.business_status;
    if (s === 'general' || s === 'qualified' || s === 'verified') out.set(String(row.project_id), s);
  }
  return out;
}
