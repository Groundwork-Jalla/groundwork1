import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * The document upload, which for weeks put nothing in GHL's media library.
 *
 * It sent `Content-Type: application/json`. GHL answered, in as many words:
 *     400 "Unsupported content type: application/json"
 * A file upload has to go as multipart/form-data — the request a browser's file input
 * produces. That is not a detail a type checker can catch, and there is no GHL sandbox to
 * try it against, so the shape of the outgoing request is asserted here instead.
 *
 * The trap this locks down: `fetch` generates the multipart boundary itself, and setting
 * Content-Type by hand silently breaks the request in a way that looks identical to a
 * server-side rejection. If anyone "helpfully" re-adds that header, this fails.
 */

const SRC = 'https://storage.example/doc.pdf?token=abc';
const GHL = 'https://services.leadconnectorhq.com';

interface Call { url: string; init: RequestInit }

/** Loads a fresh module so the cached variant does not leak between tests. */
async function freshClient() {
  vi.resetModules();
  process.env.GHL_API_TOKEN = 't';
  process.env.GHL_LOCATION_ID = 'loc123';
  return import('../../../api/ghl/_client');
}

function stub(handler: (url: string, init: RequestInit) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: unknown, init: RequestInit = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith(SRC.split('?')[0])) {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200, headers: { 'content-type': 'application/pdf' },
      });
    }
    return handler(u, init);
  });
  return calls;
}

const uploads = (calls: Call[]) => calls.filter(c => c.url.startsWith(GHL));

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('uploadMediaFromUrl', () => {
  it('sends multipart with the file attached, and never sets Content-Type by hand', async () => {
    const calls = stub(() => new Response(JSON.stringify({ url: 'https://ghl.example/stored.pdf' }), { status: 200 }));
    const { uploadMediaFromUrl, ghlConfig } = await freshClient();

    const r = await uploadMediaFromUrl(ghlConfig()!, SRC, 'app-1-Registration');

    expect(r.ok).toBe(true);
    expect(r.data?.url).toBe('https://ghl.example/stored.pdf');

    const [up] = uploads(calls);
    const headers = up.init.headers as Record<string, string>;
    // The bug, asserted directly: a manual Content-Type destroys the boundary.
    expect(Object.keys(headers).map(k => k.toLowerCase())).not.toContain('content-type');

    const body = up.init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    const file = body.get('file') as File;
    expect(file).toBeTruthy();
    // Extension carried over from the source path, not dropped.
    expect(file.name).toBe('app-1-Registration.pdf');
    expect(body.get('locationId')).toBe('loc123');
  });

  it('falls through to the next shape on a 400 and remembers the one that worked', async () => {
    let seen = 0;
    const calls = stub(url => {
      seen++;
      // Only the altId/altType form is accepted by this fake account.
      return url.includes('altId=loc123')
        ? new Response(JSON.stringify({ fileUrl: 'https://ghl.example/ok.pdf' }), { status: 200 })
        : new Response('{"status":400,"message":"Unsupported content type"}', { status: 400 });
    });
    const { uploadMediaFromUrl, ghlConfig } = await freshClient();
    const cfg = ghlConfig()!;

    const first = await uploadMediaFromUrl(cfg, SRC, 'a');
    expect(first.ok).toBe(true);
    expect(first.data?.url).toBe('https://ghl.example/ok.pdf');
    expect(seen).toBe(2);           // rejected once, then succeeded

    const before = uploads(calls).length;
    const second = await uploadMediaFromUrl(cfg, SRC, 'b');
    expect(second.ok).toBe(true);
    // The discovery is paid for once: the second document goes straight to the winner.
    expect(uploads(calls).length - before).toBe(1);
  });

  it('stops immediately on 401 — a missing scope is not a body-shape problem', async () => {
    const calls = stub(() => new Response('Unauthorized', { status: 401 }));
    const { uploadMediaFromUrl, ghlConfig } = await freshClient();

    const r = await uploadMediaFromUrl(ghlConfig()!, SRC, 'a');

    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(uploads(calls)).toHaveLength(1);
  });

  it('blames our own storage, not GHL, when the signed link will not serve', async () => {
    vi.stubGlobal('fetch', async (url: unknown) => {
      if (String(url).startsWith(GHL)) throw new Error('should never reach GHL');
      return new Response('gone', { status: 404 });
    });
    const { uploadMediaFromUrl, ghlConfig } = await freshClient();

    const r = await uploadMediaFromUrl(ghlConfig()!, SRC, 'a');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('source_unreadable');
  });
});
