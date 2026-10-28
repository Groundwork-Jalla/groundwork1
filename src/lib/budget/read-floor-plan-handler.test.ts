import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The endpoint that looks at a floor plan, exercised rather than grepped.
 *
 * Its whole job in the unhappy cases is to GET OUT OF THE WAY. The extractor has
 * already put its figures on screen by the time this runs, and those figures are what
 * the budget is built from — so an absent key, a refusal, a timeout or a bad response
 * must each come back as "no reading" with a 200, never as an error the person
 * uploading a plan has to understand or get past.
 *
 * Source-matching tests could pin the strings in those branches; only running them
 * proves the branches are reachable and that nothing throws on the way.
 */

const { requireUser, create, FakeAPIError } = vi.hoisted(() => {
  // A class, not an arrow: the handler calls `new Anthropic(...)`, and an arrow
  // function is not a constructor.
  class FakeAPIError extends Error { status = 500; }
  return { requireUser: vi.fn(), create: vi.fn(), FakeAPIError };
});

vi.mock('../../../api/_lib/stripe.js', () => ({ requireUser }));

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    beta = { messages: { create } };
    static APIError = FakeAPIError;
  }
  return { default: Anthropic };
});

const { handler } = await import('../../../api/_handlers/read-floor-plan.js');

/** A one-pixel PNG is a real image as far as this endpoint is concerned. */
const PAGE = { media_type: 'image/png', data: 'aGVsbG8=' };

function res() {
  const out = { code: 0, body: undefined as unknown };
  return {
    out,
    status(code: number) { out.code = code; return this; },
    json(body: unknown) { out.body = body; return this; },
  };
}

const post = (body: unknown) => ({ method: 'POST', headers: {}, body });

beforeEach(() => {
  requireUser.mockResolvedValue({ id: 'user-1' });
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  vi.clearAllMocks();
});

describe('who may spend money on this', () => {
  it('refuses a caller who is not signed in', async () => {
    requireUser.mockResolvedValue(null);
    const r = res();
    await handler(post({ pages: [PAGE] }), r);
    expect(r.out.code).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses anything but POST', async () => {
    const r = res();
    await handler({ method: 'GET', headers: {}, body: {} }, r);
    expect(r.out.code).toBe(405);
    expect(create).not.toHaveBeenCalled();
  });

  it('checks the caller before it checks the key', async () => {
    // Otherwise a stranger learns whether this deployment has a key configured.
    requireUser.mockResolvedValue(null);
    delete process.env.ANTHROPIC_API_KEY;
    const r = res();
    await handler(post({ pages: [PAGE] }), r);
    expect(r.out.code).toBe(401);
  });
});

describe('when it cannot read anything, it says so and does not fail', () => {
  it('no key configured — every local deployment', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = res();
    await handler(post({ pages: [PAGE] }), r);
    expect(r.out.code).toBe(200);
    expect(r.out.body).toEqual({ available: false, reason: 'not-configured' });
    expect(create).not.toHaveBeenCalled();
  });

  it('the model declined', async () => {
    create.mockResolvedValue({ stop_reason: 'refusal', content: [], model: 'claude-opus-5-5' });
    const r = res();
    await handler(post({ pages: [PAGE] }), r);
    expect(r.out).toEqual({ code: 200, body: { available: false, reason: 'refused' } });
  });

  it('the answer was not JSON', async () => {
    create.mockResolvedValue({
      stop_reason: 'end_turn', model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'I had a look and honestly it is hard to say' }],
    });
    const r = res();
    await handler(post({ pages: [PAGE] }), r);
    expect(r.out).toEqual({ code: 200, body: { available: false, reason: 'unparseable' } });
  });

  it('the call threw', async () => {
    create.mockRejectedValue(new FakeAPIError('upstream is down'));
    const r = res();
    await handler(post({ pages: [PAGE] }), r);
    expect(r.out).toEqual({ code: 200, body: { available: false, reason: 'error' } });
  });

  it('and a thrown error never escapes to the caller', async () => {
    create.mockRejectedValue(new Error('something nobody predicted'));
    const r = res();
    await expect(handler(post({ pages: [PAGE] }), r)).resolves.not.toThrow();
    expect(r.out.code).toBe(200);
  });
});

describe('what it will accept as a page', () => {
  it.each([
    ['no body at all', {}],
    ['an empty list', { pages: [] }],
    ['not a list', { pages: 'a picture' }],
    ['a PDF rather than a rendered image', { pages: [{ media_type: 'application/pdf', data: 'x' }] }],
    ['an SVG, which the API will not take', { pages: [{ media_type: 'image/svg+xml', data: 'x' }] }],
    ['no data', { pages: [{ media_type: 'image/png', data: '' }] }],
  ])('rejects %s', async (_label, body) => {
    const r = res();
    await handler(post(body), r);
    expect(r.out.code).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an oversized image before paying to send it', async () => {
    const huge = 'A'.repeat(8 * 1024 * 1024);
    const r = res();
    await handler(post({ pages: [{ media_type: 'image/png', data: huge }] }), r);
    expect(r.out.code).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('sends at most four sheets, however many it is given', async () => {
    create.mockResolvedValue({
      stop_reason: 'end_turn', model: 'claude-opus-5-5',
      content: [{ type: 'text', text: '{}' }],
    });
    const r = res();
    await handler(post({ pages: Array.from({ length: 9 }, () => PAGE) }), r);
    const images = create.mock.calls[0][0].messages[0].content
      .filter((block: { type: string }) => block.type === 'image');
    expect(images).toHaveLength(4);
    expect((r.out.body as { pagesRead: number }).pagesRead).toBe(4);
  });
});

describe('the request it actually builds', () => {
  beforeEach(() => {
    create.mockResolvedValue({
      stop_reason: 'end_turn', model: 'claude-opus-5-5',
      content: [{ type: 'text', text: '{"dwellingUnits":3}' }],
    });
  });

  it('pins the model, so the same plan cannot read differently next week', async () => {
    await handler(post({ pages: [PAGE] }), res());
    expect(create.mock.calls[0][0].model).toBe('claude-opus-5-5');
  });

  it('asks for a schema instead of prose it would have to pick apart', async () => {
    await handler(post({ pages: [PAGE] }), res());
    const format = create.mock.calls[0][0].output_config.format;
    expect(format.type).toBe('json_schema');
    expect(format.schema.properties.dwellingUnits).toBeTruthy();
    expect(format.schema.additionalProperties).toBe(false);
  });

  it('sends the image before the instruction, as vision prompts want', async () => {
    await handler(post({ pages: [PAGE] }), res());
    const content = create.mock.calls[0][0].messages[0].content;
    expect(content[0].type).toBe('image');
    expect(content[content.length - 1].type).toBe('text');
  });

  it('returns the parsed reading and which model gave it', async () => {
    const r = res();
    await handler(post({ pages: [PAGE] }), r);
    expect(r.out.body).toMatchObject({
      available: true,
      reading: { dwellingUnits: 3 },
      model: 'claude-opus-5-5',
      pagesRead: 1,
    });
  });
});
