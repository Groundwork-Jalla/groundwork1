import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * The document upload, which for weeks put nothing in GHL's media library.
 *
 * It sent `Content-Type: application/json`. GHL answered, in as many words:
 *     400 "Unsupported content type: application/json"
 * A file upload has to go as multipart/form-data — the request a browser's file input
 * produces. That is not a thing a type checker can catch, and there is no GHL sandbox to
 * try it against, so the shape of the outgoing request is asserted here instead.
 *
 * The trap this locks down: `fetch` generates the multipart boundary itself, and setting
 * Content-Type by hand silently breaks the request in a way that looks identical to a
 * server-side rejection. If anyone "helpfully" re-adds that header, this fails.
 *
 * The fixtures are not invented. They are what the live account returned on 26 Aug 2026.
 */

const SRC = 'https://storage.example/doc.jpg?token=abc';
const GHL = 'https://services.leadconnectorhq.com';

/** Verbatim from the live 201, truncated only in the id. */
const LIVE_201 = '{"fileId":"6a8e8132cdd4b797a32c5718","url":"https://assets.cdn.example/6a8e.jpg"}';

interface Call { url: string; init: RequestInit }

/** Fresh module per test so nothing leaks between them. */
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
        status: 200, headers: { 'content-type': 'image/jpeg' },
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
    const calls = stub(() => new Response(LIVE_201, { status: 201 }));
    const { uploadMediaFromUrl, ghlConfig } = await freshClient();

    await uploadMediaFromUrl((await ghlConfig())!, SRC, 'app-1-Registration');

    const [up] = uploads(calls);
    const headers = up.init.headers as Record<string, string>;
    // The bug, asserted directly: a manual Content-Type destroys the boundary.
    expect(Object.keys(headers).map(k => k.toLowerCase())).not.toContain('content-type');

    const body = up.init.body as FormData;
    expect(body).toBeInstanceOf(FormData);

    const file = body.get('file') as File;
    expect(file).toBeTruthy();
    // Extension carried over from the source path rather than dropped.
    expect(file.name).toBe('app-1-Registration.jpg');
    expect(file.type).toBe('image/jpeg');
    // The arrangement the live account accepted: location named in the form.
    expect(body.get('locationId')).toBe('loc123');
    expect(body.get('name')).toBe('app-1-Registration');
  });

  it('accepts the 201 the live account actually returns', async () => {
    stub(() => new Response(LIVE_201, { status: 201 }));
    const { uploadMediaFromUrl, ghlConfig } = await freshClient();

    const r = await uploadMediaFromUrl((await ghlConfig())!, SRC, 'a');

    // 201, not 200 — anything checking `status === 200` would drop a file that uploaded.
    expect(r.ok).toBe(true);
    expect(r.data?.url).toBe('https://assets.cdn.example/6a8e.jpg');
    expect(r.data?.fileId).toBe('6a8e8132cdd4b797a32c5718');
  });

  it('still reads the shape GHL documents but did not send', async () => {
    stub(() => new Response('{"fileUrl":"https://cdn/x.jpg","id":"abc"}', { status: 200 }));
    const { uploadMediaFromUrl, ghlConfig } = await freshClient();

    const r = await uploadMediaFromUrl((await ghlConfig())!, SRC, 'a');
    expect(r.data?.url).toBe('https://cdn/x.jpg');
    expect(r.data?.fileId).toBe('abc');
  });

  it('reports a rejection without pretending the file landed', async () => {
    stub(() => new Response('{"status":400,"message":"Unsupported content type"}', { status: 400 }));
    const { uploadMediaFromUrl, ghlConfig } = await freshClient();

    const r = await uploadMediaFromUrl((await ghlConfig())!, SRC, 'a');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it('blames our own storage, not GHL, when the signed link will not serve', async () => {
    vi.stubGlobal('fetch', async (url: unknown) => {
      if (String(url).startsWith(GHL)) throw new Error('should never reach GHL');
      return new Response('gone', { status: 404 });
    });
    const { uploadMediaFromUrl, ghlConfig } = await freshClient();

    const r = await uploadMediaFromUrl((await ghlConfig())!, SRC, 'a');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('source_unreadable');
  });
});
