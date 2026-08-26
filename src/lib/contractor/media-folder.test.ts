import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * One folder per applicant in GHL's Media Storage.
 *
 * Media Storage is a single flat library shared by the whole account. Naming files for
 * their owner made an individual file identifiable; it did not make the library navigable.
 *
 * Uploading *into* a folder is documented (`parentId`). Creating one is not published in
 * v2, so several routes are tried. The rule that matters is the last test here: **a folder
 * problem must never cost a document.** A file in the wrong place is recoverable; a file
 * that never uploaded because a folder call 404'd is not.
 */

const GHL = 'https://services.leadconnectorhq.com';
const SRC = 'https://storage.example/doc.jpg?token=abc';

async function fresh() {
  vi.resetModules();
  process.env.GHL_API_TOKEN = 't';
  process.env.GHL_LOCATION_ID = 'loc123';
  return import('../../../api/ghl/_client');
}

interface Call { url: string; init: RequestInit }

function stub(handler: (url: string, init: RequestInit) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: unknown, init: RequestInit = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith(SRC.split('?')[0])) {
      return new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    return handler(u, init);
  });
  return calls;
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('folderNameFor', () => {
  it('reads as a person, with a short id so namesakes stay apart', async () => {
    const { folderNameFor } = await fresh();
    expect(folderNameFor('Ketchouang Pierre', '2538b51e-3d7a-4f22')).toBe('Ketchouang Pierre (2538b51e)');
  });

  it('never produces a nameless folder', async () => {
    const { folderNameFor } = await fresh();
    expect(folderNameFor('', 'abcd1234-x')).toBe('Contractor (abcd1234)');
  });
});

describe('ensureFolder', () => {
  it('reuses a folder that already exists rather than making a second one', async () => {
    const calls = stub(url => {
      if (url.includes('/medias/files')) {
        return new Response(JSON.stringify({
          files: [
            { _id: 'other', name: 'Relocated Item', type: 'folder' },
            { _id: 'fold99', name: 'Ada Mbeki (abcd1234)', type: 'folder' },
          ],
        }), { status: 200 });
      }
      return new Response('nope', { status: 404 });
    });
    const { ensureFolder, ghlConfig } = await fresh();

    expect(await ensureFolder(ghlConfig()!, 'Ada Mbeki (abcd1234)')).toBe('fold99');
    // Found by listing: no creation attempt at all.
    expect(calls.some(c => c.url.includes('create-folder'))).toBe(false);
  });

  it('creates one when it is missing, and caches it', async () => {
    let creates = 0;
    const calls = stub(url => {
      if (url.includes('/medias/files')) return new Response(JSON.stringify({ files: [] }), { status: 200 });
      if (url.includes('/medias/create-folder')) {
        creates++;
        return new Response(JSON.stringify({ _id: 'newfold' }), { status: 201 });
      }
      return new Response('nope', { status: 404 });
    });
    const { ensureFolder, ghlConfig } = await fresh();
    const cfg = ghlConfig()!;

    expect(await ensureFolder(cfg, 'Ada Mbeki (abcd1234)')).toBe('newfold');
    const after = calls.length;
    // Second application for the same person must not re-ask GHL anything.
    expect(await ensureFolder(cfg, 'Ada Mbeki (abcd1234)')).toBe('newfold');
    expect(calls.length).toBe(after);
    expect(creates).toBe(1);
  });

  it('falls through the candidate routes until one answers', async () => {
    stub(url => {
      if (url.includes('/medias/files')) return new Response(JSON.stringify({ files: [] }), { status: 200 });
      // Only the third candidate exists on this account.
      if (url.includes('/medias/folders')) return new Response(JSON.stringify({ folder: { id: 'f3' } }), { status: 201 });
      return new Response('Not Found', { status: 404 });
    });
    const { ensureFolder, ghlConfig } = await fresh();
    expect(await ensureFolder(ghlConfig()!, 'X (abcd1234)')).toBe('f3');
  });

  it('returns null rather than throwing when GHL will not make folders at all', async () => {
    stub(() => new Response('Not Found', { status: 404 }));
    const { ensureFolder, ghlConfig } = await fresh();
    expect(await ensureFolder(ghlConfig()!, 'X (abcd1234)')).toBeNull();
  });
});

describe('uploadMediaFromUrl with a folder', () => {
  it('puts the file in the folder when there is one', async () => {
    const calls = stub(() => new Response('{"fileId":"a","url":"https://cdn/x"}', { status: 201 }));
    const { uploadMediaFromUrl, ghlConfig } = await fresh();

    await uploadMediaFromUrl(ghlConfig()!, SRC, 'doc', 'fold99');

    const up = calls.find(c => c.url.includes('upload-file'))!;
    expect((up.init.body as FormData).get('parentId')).toBe('fold99');
  });

  it('still uploads when there is no folder — a folder must never cost a document', async () => {
    const calls = stub(() => new Response('{"fileId":"a","url":"https://cdn/x"}', { status: 201 }));
    const { uploadMediaFromUrl, ghlConfig } = await fresh();

    const r = await uploadMediaFromUrl(ghlConfig()!, SRC, 'doc', null);

    expect(r.ok).toBe(true);
    const up = calls.find(c => c.url.includes('upload-file'))!;
    // Absent, not empty: an empty parentId could be read as a real folder id.
    expect((up.init.body as FormData).has('parentId')).toBe(false);
  });
});
