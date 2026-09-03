import { supabase } from './client';

// =========================================================
// Admin project deletion
//
// The only way to remove a single project. Owners cannot delete at all (053), and the
// only other route that destroys a project is `admin_delete_user()` (035), which takes
// the whole account with it.
//
// ── WHY THE ORDER IS WHAT IT IS ─────────────────────────────────────────────────────
// The RPC runs FIRST and the files are removed after, never the other way round.
//
// Storage is not part of the foreign-key graph, so the files have to be removed by a
// second, separate call — and one of the two is going to be able to fail after the
// other has succeeded. This order chooses which:
//
//   RPC first   → if it fails, nothing has been touched. If the file removal then
//                 fails, the project is correctly gone and some bytes are orphaned.
//   files first → if the RPC then fails, a LIVE project has permanently lost its
//                 evidence, which is the one thing this product exists to hold.
//
// So a failure here degrades to wasted storage, never to a project that still exists
// with its proof destroyed. `filesOrphaned` reports it rather than hiding it.
//
// The paths come back from the RPC because they only exist in the rows the cascade is
// about to destroy — see migration 069.
// =========================================================

export interface DeletedProjectSummary {
  name:       string;
  ownerEmail: string;
  tier:       string;
  stages:     number;
  substages:  number;
  documents:  number;
  messages:   number;
  /** Files whose bytes Storage confirmed removed. */
  filesRemoved:  number;
  /** Files the database named but Storage would not remove. The project is still gone. */
  filesOrphaned: number;
}

interface StorageFile { bucket: string; path: string; }

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * The RPC's `files` column, defensively.
 *
 * Postgres hands back real JSON, but supabase-js has returned a JSON *string* for jsonb
 * columns in the past depending on the client version — and this runs exactly once per
 * deletion, after the project is already gone, so there is no second chance to get it
 * right. A shape it cannot read means orphaned bytes, not a crash.
 */
function parseFiles(raw: unknown): StorageFile[] {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];

  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const bucket = str((entry as Record<string, unknown>).bucket);
    const path   = str((entry as Record<string, unknown>).path);
    return bucket && path ? [{ bucket, path }] : [];
  });
}

/**
 * Remove the bytes, one call per bucket.
 *
 * Never throws. The project is already deleted by the time this runs, so an exception
 * here would report a failure for something that succeeded — and the caller would have
 * no way to retry the half that actually worked.
 */
async function removeFiles(files: StorageFile[]): Promise<{ removed: number; orphaned: number }> {
  if (files.length === 0) return { removed: 0, orphaned: 0 };

  const byBucket = new Map<string, string[]>();
  for (const f of files) {
    const paths = byBucket.get(f.bucket) ?? [];
    paths.push(f.path);
    byBucket.set(f.bucket, paths);
  }

  let removed  = 0;
  let orphaned = 0;

  for (const [bucket, paths] of byBucket) {
    try {
      const { data, error } = await supabase.storage.from(bucket).remove(paths);
      if (error) { orphaned += paths.length; continue; }
      // Storage reports what it actually removed. A path already gone is not an error
      // and is not in `data`, so counting the response rather than the request keeps
      // the number honest.
      const n = Array.isArray(data) ? data.length : 0;
      removed  += n;
      orphaned += Math.max(0, paths.length - n);
    } catch {
      orphaned += paths.length;
    }
  }

  return { removed, orphaned };
}

/**
 * Delete a project and everything that cascades from it.
 *
 * The guards live in `admin_delete_project()` (migration 069), not here: `is_admin()` is
 * re-checked inside the function, so this cannot be driven from the console by a
 * signed-in client.
 *
 * Deleting a `self_verify` project gives the owner their plan slot back — deliberately.
 * The confirmation dialog says so.
 */
export async function deleteProjectAsAdmin(projectId: string): Promise<DeletedProjectSummary> {
  const { data, error } = await supabase.rpc('admin_delete_project', { p_project_id: projectId });
  if (error) throw error;

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) throw new Error('admin_delete_project returned no row');

  const { removed, orphaned } = await removeFiles(parseFiles(row.files));

  return {
    name:       str(row.name),
    ownerEmail: str(row.owner_email),
    tier:       str(row.tier),
    stages:     num(row.stages),
    substages:  num(row.substages),
    documents:  num(row.documents),
    messages:   num(row.messages),
    filesRemoved:  removed,
    filesOrphaned: orphaned,
  };
}
