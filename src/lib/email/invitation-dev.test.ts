import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { invitationApiMiddleware } from '../../../scripts/dev-invitation-api';

async function request(url: string, body = JSON.stringify({ lang: 'en' }), method = 'POST') {
  const handler = vi.fn(async (req: any, res: any) => { res.status(202).json({ lang: req.body.lang }); });
  const load = vi.fn(async () => ({ default: handler, handler }));
  const next = vi.fn();
  const req = Object.assign(Readable.from(body ? [Buffer.from(body)] : []), { url, method });
  const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn(), writableEnded: false };
  await invitationApiMiddleware(load)(req as IncomingMessage, response as unknown as ServerResponse, next);
  return { handler, load, next, response };
}

describe('development invitations use the production handlers', () => {
  it.each([
    ['/api/send-invite', '/api/send-invite.ts'],
    ['/api/events?action=send-share-invite', '/api/_handlers/send-share-invite.ts'],
    ['/api/events?action=contractor-invite-client', '/api/_handlers/contractor-invite-client.ts'],
  ])('%s preserves the English UI request for its production handler', async (url, modulePath) => {
    const result = await request(url);
    expect(result.load).toHaveBeenCalledWith(modulePath);
    expect(result.handler).toHaveBeenCalledOnce();
    expect(result.handler.mock.calls[0][0].body).toEqual({ lang: 'en' });
    expect(result.response.statusCode).toBe(202);
    expect(result.response.end).toHaveBeenCalledWith(JSON.stringify({ lang: 'en' }));
  });

  it('leaves unrelated event actions for the next middleware', async () => {
    const result = await request('/api/events?action=read-floor-plan');
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.load).not.toHaveBeenCalled();
  });

  it('refuses invalid JSON before executing the handler', async () => {
    const result = await request('/api/send-invite', '{broken');
    expect(result.response.statusCode).toBe(400);
    expect(result.handler).not.toHaveBeenCalled();
  });

  it('supports pending-client GET requests without a body', async () => {
    const result = await request('/api/events?action=contractor-invite-client', '', 'GET');
    expect(result.handler.mock.calls[0][0].method).toBe('GET');
    expect(result.handler.mock.calls[0][0].body).toEqual({});
  });
});
