import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Deleting a project is two calls that cannot be one: the row lives in Postgres, the
 * files live in Storage, and nothing joins them. Either call can fail after the other
 * has succeeded, so the ORDER decides which half survives a partial failure.
 *
 * Getting it backwards destroys a live project's evidence — silently, and only for
 * whoever happens to be mid-delete when Storage has a bad minute. Nothing in the UI
 * could show it, which is why it is pinned here.
 */

const h = vi.hoisted(() => ({
  calls: [] as string[],
  rpc:    { data: null as unknown, error: null as unknown },
  remove: (_bucket: string, paths: string[]): { data: { name: string }[] | null; error: unknown } =>
    ({ data: paths.map(p => ({ name: p })), error: null }),
}));

vi.mock('./client', () => ({
  supabase: {
    rpc: async (fn: string) => {
      h.calls.push(`rpc:${fn}`);
      return h.rpc.error ? { data: null, error: h.rpc.error } : { data: h.rpc.data, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          h.calls.push(`remove:${bucket}`);
          return h.remove(bucket, paths);
        },
      }),
    },
  },
}));

import { deleteProjectAsAdmin } from './admin-projects';

/** One row shaped like admin_delete_project()'s RETURNS TABLE. */
function row(files: unknown = []) {
  return [{
    name: 'Buea Residence', owner_email: 'client@example.com', tier: 'self_verify',
    stages: 10, substages: 42, documents: 3, messages: 7,
    files,
  }];
}

beforeEach(() => {
  h.calls.length = 0;
  h.rpc = { data: row(), error: null };
  h.remove = (_b, paths) => ({ data: paths.map(p => ({ name: p })), error: null });
});

describe('deleteProjectAsAdmin', () => {
  it('deletes the project before touching a single file', async () => {
    h.rpc.data = row([
      { bucket: 'evidence',  path: 'p1/s1/ss1/photo.jpg' },
      { bucket: 'documents', path: 'p1/permit.pdf' },
    ]);

    await deleteProjectAsAdmin('p1');

    expect(h.calls[0]).toBe('rpc:admin_delete_project');
    expect(h.calls.slice(1).every(c => c.startsWith('remove:'))).toBe(true);
  });

  it('removes nothing when the delete itself fails', async () => {
    // The failure that must not cost anything: the project is still live, so its
    // evidence has to still be there when the admin retries.
    h.rpc = { data: null, error: { message: 'not_admin: only an administrator may delete a project' } };

    await expect(deleteProjectAsAdmin('p1')).rejects.toBeTruthy();
    expect(h.calls).toEqual(['rpc:admin_delete_project']);
  });

  it('does not fail the deletion when storage refuses', async () => {
    // The project is already gone by this point. Throwing here would report a failure
    // for something that succeeded, and there is nothing left to retry.
    h.rpc.data = row([{ bucket: 'evidence', path: 'p1/s1/ss1/photo.jpg' }]);
    h.remove = () => ({ data: null, error: { message: 'storage unavailable' } });

    const summary = await deleteProjectAsAdmin('p1');
    expect(summary.name).toBe('Buea Residence');
    expect(summary.filesRemoved).toBe(0);
    expect(summary.filesOrphaned).toBe(1);
  });

  it('survives storage throwing outright', async () => {
    h.rpc.data = row([{ bucket: 'documents', path: 'p1/permit.pdf' }]);
    h.remove = () => { throw new Error('network'); };

    const summary = await deleteProjectAsAdmin('p1');
    expect(summary.filesOrphaned).toBe(1);
  });

  it('makes one call per bucket, not one per file', async () => {
    h.rpc.data = row([
      { bucket: 'evidence',     path: 'p1/s1/ss1/a.jpg' },
      { bucket: 'evidence',     path: 'p1/s1/ss1/b.jpg' },
      { bucket: 'evidence',     path: 'p1/s2/ss4/c.jpg' },
      { bucket: 'documents',    path: 'p1/permit.pdf' },
      { bucket: 'certificates', path: 'p1/stage-1.pdf' },
    ]);

    const summary = await deleteProjectAsAdmin('p1');

    expect(h.calls.filter(c => c === 'remove:evidence')).toHaveLength(1);
    expect(h.calls.filter(c => c.startsWith('remove:'))).toHaveLength(3);
    expect(summary.filesRemoved).toBe(5);
  });

  it('counts what storage confirmed, not what was asked', async () => {
    // A path already gone is not an error and does not come back in `data`. Counting the
    // request would report bytes freed that never existed.
    h.rpc.data = row([
      { bucket: 'evidence', path: 'p1/s1/ss1/a.jpg' },
      { bucket: 'evidence', path: 'p1/s1/ss1/missing.jpg' },
    ]);
    h.remove = (_b, paths) => ({ data: [{ name: paths[0] }], error: null });

    const summary = await deleteProjectAsAdmin('p1');
    expect(summary.filesRemoved).toBe(1);
    expect(summary.filesOrphaned).toBe(1);
  });

  it('reads files when the driver hands back jsonb as a string', async () => {
    h.rpc.data = row(JSON.stringify([{ bucket: 'evidence', path: 'p1/s1/ss1/a.jpg' }]));

    const summary = await deleteProjectAsAdmin('p1');
    expect(summary.filesRemoved).toBe(1);
  });

  it('skips malformed entries rather than removing a wrong path', async () => {
    h.rpc.data = row([
      { bucket: 'evidence', path: 'p1/s1/ss1/a.jpg' },
      { bucket: 'evidence' },              // no path
      { path: 'orphan.jpg' },              // no bucket
      null,
      'nonsense',
    ]);

    const summary = await deleteProjectAsAdmin('p1');
    expect(h.calls.filter(c => c.startsWith('remove:'))).toHaveLength(1);
    expect(summary.filesRemoved).toBe(1);
  });

  it('reports the project with no files at all without calling storage', async () => {
    const summary = await deleteProjectAsAdmin('p1');
    expect(h.calls).toEqual(['rpc:admin_delete_project']);
    expect(summary.stages).toBe(10);
    expect(summary.filesRemoved).toBe(0);
  });
});
