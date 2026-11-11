import type { IncomingMessage, ServerResponse } from 'node:http';

type Handler = (req: any, res: any) => Promise<void>;
type ModuleLoader = (path: string) => Promise<Record<string, unknown>>;

/** Local invitations execute the deployed handlers, including locale and auth checks. */
export function invitationApiMiddleware(loadModule: ModuleLoader) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let modulePath: string;
    let exportName = 'handler';
    if (url.pathname === '/api/send-invite') {
      modulePath = '/api/send-invite.ts';
      exportName = 'default';
    } else if (url.pathname === '/api/events' && url.searchParams.get('action') === 'send-share-invite') {
      modulePath = '/api/_handlers/send-share-invite.ts';
    } else if (url.pathname === '/api/events' && url.searchParams.get('action') === 'contractor-invite-client') {
      modulePath = '/api/_handlers/contractor-invite-client.ts';
    } else {
      next();
      return;
    }

    const response = Object.assign(res, {
      status(code: number) { res.statusCode = code; return response; },
      json(body: unknown) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
        return response;
      },
    });

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = {};
      try { if (raw) body = JSON.parse(raw); }
      catch { response.status(400).json({ error: 'Invalid JSON' }); return; }
      Object.assign(req, { body });
      const module = await loadModule(modulePath);
      const handler = module[exportName] as Handler;
      await handler(req, response);
    } catch {
      if (!res.writableEnded) response.status(500).json({ error: 'Invitation request failed' });
    }
  };
}
