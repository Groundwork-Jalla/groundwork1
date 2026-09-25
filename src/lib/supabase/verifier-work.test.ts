import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadVerification } from './verifier-work';

const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('./client', () => ({ supabase: { from: mock.from } }));

const row = { id: 'verification-a', project_id: 'project-a', stage_id: 'stage-a', verifier_id: 'verifier-a', decision: 'pending', projects: { name: 'Bastos' }, project_stages: { name: 'Structure', stage_number: 4 } };
let denied = false;
let evidenceError: unknown = null;
let documentError: unknown = null;
const selects = new Map<string, string>();
const filters: [string, string, unknown][] = [];
beforeEach(() => {
  denied = false; evidenceError = null; documentError = null; selects.clear(); filters.length = 0;
  mock.from.mockReset().mockImplementation((table: string) => {
    const chain = {
      select: (columns: string) => { selects.set(table, columns); return chain; },
      eq: (column: string, value: unknown) => { filters.push([table, column, value]); return chain; },
      maybeSingle: async () => ({ data: denied ? null : row, error: null }),
      order: async () => table === 'project_substages'
        ? { data: [], error: evidenceError }
        : { data: [{ id: 'doc-a', file_name: 'Structural drawings.pdf', file_path: 'project-a/drawings.pdf', created_at: '2026-09-01' }], error: documentError },
    };
    return chain;
  });
});

describe('verification context reads', () => {
  it('uses the document schema’s file_name and keeps reads tied to the assigned verification', async () => {
    const result = await loadVerification('verification-a', 'verifier-a');
    expect(result?.documents[0]).toMatchObject({ name: 'Structural drawings.pdf', path: 'project-a/drawings.pdf' });
    expect(selects.get('project_documents')).toBe('id, file_name, file_path, created_at');
    expect(filters).toContainEqual(['stage_verifications', 'verifier_id', 'verifier-a']);
    expect(filters).toContainEqual(['project_substages', 'stage_id', 'stage-a']);
    expect(filters).toContainEqual(['project_documents', 'project_id', 'project-a']);
  });
  it('does not fetch context when the guessed verification is unavailable to the reader', async () => {
    denied = true;
    expect(await loadVerification('verification-a', 'verifier-b')).toBeNull();
    expect(mock.from).toHaveBeenCalledTimes(1);
  });
  it.each(['evidence', 'documents'])('surfaces an unreadable %s source instead of reporting it as empty', async source => {
    const failure = { message: 'permission denied', code: '42501' };
    if (source === 'evidence') evidenceError = failure;
    else documentError = failure;
    await expect(loadVerification('verification-a', 'verifier-a')).rejects.toEqual(failure);
  });
});
