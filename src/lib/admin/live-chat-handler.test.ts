import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  from: vi.fn(),
  inserts: [] as { table: string; row: any }[],
  sessionRow: null as any,
  messages: [] as any[],
}));

vi.mock('../../../api/_lib/stripe.js', () => ({
  getSupabaseAdmin: () => ({ from: h.from }),
}));

import { handler } from '../../../api/_handlers/live-chat';

function response() {
  const res: any = { code: 0, body: null, setHeader: vi.fn() };
  res.status = (code: number) => { res.code = code; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  res.end = () => res;
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.inserts = [];
  h.sessionRow = null;
  h.messages = [];
  h.from.mockImplementation((table: string) => {
    const q: any = {};
    let mode: 'select' | 'insert' | 'update' = 'select';
    let lastRow: any = null;
    q.select = () => q;
    q.eq = () => q;
    q.neq = () => q;
    q.ilike = () => q;
    q.gte = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.insert = (row: any) => {
      mode = 'insert';
      lastRow = row;
      h.inserts.push({ table, row });
      return q;
    };
    q.update = () => { mode = 'update'; return q; };
    q.single = () => {
      if (table === 'live_chat_sessions' && mode === 'insert') {
        h.sessionRow = {
          id: '11111111-1111-4111-8111-111111111111',
          visitor_token_hash: lastRow.visitor_token_hash,
          visitor_name: lastRow.visitor_name,
          visitor_email: lastRow.visitor_email,
          status: 'waiting_on_us',
          unread_for_user: 0,
        };
        return Promise.resolve({ data: h.sessionRow, error: null });
      }
      if (table === 'live_chat_messages' && mode === 'insert') {
        const msg = { id: 'm1', session_id: lastRow.session_id, sender_type: lastRow.sender_type, sender_name: lastRow.sender_name, body: lastRow.body, created_at: '2026-11-20T12:00:00Z' };
        h.messages.push(msg);
        return Promise.resolve({ data: msg, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    q.maybeSingle = () => {
      if (table === 'live_chat_settings') {
        return Promise.resolve({ data: { online: true, greeting_en: 'Hello!', greeting_fr: 'Bonjour !', away_message_en: 'Away', away_message_fr: 'Absent' }, error: null });
      }
      if (table === 'live_chat_sessions') {
        return Promise.resolve({ data: h.sessionRow, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    q.then = (resolve: any) => {
      if (table === 'live_chat_messages') {
        return Promise.resolve({ data: h.messages, count: 0, error: null }).then(resolve);
      }
      return Promise.resolve({ data: null, error: null }).then(resolve);
    };
    return q;
  });
});

describe('Public Live Chat API handler', () => {
  it('GET returns online status and bilingual greetings', async () => {
    const res = response();
    await handler({ method: 'GET' }, res);
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ online: true, greetingEn: 'Hello!', greetingFr: 'Bonjour !' });
  });

  it('POST start validates input, stores only a SHA-256 token hash, and returns visitorToken', async () => {
    let res = response();
    await handler({ method: 'POST', body: { operation: 'start', name: 'A', email: 'bad', message: 'Hi' } }, res);
    expect(res.code).toBe(400);

    res = response();
    await handler({
      method: 'POST',
      body: { operation: 'start', name: 'Chidi Okafor', email: 'chidi@example.com', message: 'Can I start in Douala?', pagePath: '/', lang: 'en' },
    }, res);
    expect(res.code).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.visitorToken).toMatch(/^[a-f0-9]{64}$/);
    const sessionInsert = h.inserts.find(x => x.table === 'live_chat_sessions')!;
    // Token itself is never stored in plain text — only its SHA-256 hash.
    expect(sessionInsert.row.visitor_token_hash).not.toBe(res.body.visitorToken);
    expect(sessionInsert.row.visitor_token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('POST poll rejects invalid session tokens cleanly', async () => {
    const res = response();
    await handler({ method: 'POST', body: { operation: 'poll', sessionId: 'not-a-uuid', visitorToken: 'short' } }, res);
    expect(res.code).toBe(401);
    expect(res.body.error).toBe('invalid_session');
  });
});
