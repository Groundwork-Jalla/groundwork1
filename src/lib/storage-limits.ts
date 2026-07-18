import type { SupabaseClient } from '@supabase/supabase-js';

const STORAGE_LIMITS: Record<string, number> = {
  self_verify:       500 * 1024 * 1024,  // 500 MB
  starter:           500 * 1024 * 1024,  // backward compat
  jalla_verify:      Infinity,
  pro:               Infinity,
  enterprise_custom: Infinity,
  enterprise:        Infinity,
  jalla_management:  Infinity,
};

export function getStorageLimit(tier: string): number {
  return STORAGE_LIMITS[tier] ?? STORAGE_LIMITS.self_verify;
}

export async function getProjectStorageUsed(
  supabase: SupabaseClient,
  projectId: string,
): Promise<number> {
  const [{ data: evidenceFiles }, { data: docFiles }] = await Promise.all([
    supabase.storage
      .from('evidence')
      .list(projectId, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } }),
    supabase.storage
      .from('documents')
      .list(projectId, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } }),
  ]);

  const evidenceSize = (evidenceFiles ?? []).reduce(
    (sum, f) => sum + (f.metadata?.size ?? 0), 0,
  );
  const docSize = (docFiles ?? []).reduce(
    (sum, f) => sum + (f.metadata?.size ?? 0), 0,
  );

  return evidenceSize + docSize;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
