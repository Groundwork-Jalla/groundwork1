import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  isClient: false, accepted: false, recipientLang: null as string | null,
  from: vi.fn(), send: vi.fn(), crm: vi.fn(), note: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: h.from }) }));
vi.mock('../../../api/_lib/resend-send.js', () => ({ sendViaResend: h.send }));
vi.mock('../../../api/ghl/_forward.js', () => ({ forwardToGhl: h.crm }));
vi.mock('../../../api/ghl/_email-log.js', () => ({ logEmailToCrm: h.note }));
import { handler } from '../../../api/_handlers/send-share-invite';

beforeEach(() => {
  vi.clearAllMocks(); h.isClient = false; h.accepted = false; h.recipientLang = null;
  vi.stubEnv('RESEND_API_KEY', 'test-only'); vi.stubEnv('SUPABASE_URL', 'https://test.invalid'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No external network in this test'); }));
  h.send.mockResolvedValue({ ok: true, messageId: 'email-id', attempts: 1 });
  h.crm.mockResolvedValue({ ok: true }); h.note.mockResolvedValue({ ok: true, surface: 'note' });
  h.from.mockImplementation((table: string) => {
    const query: any = {
      select: () => query, eq: () => query, ilike: () => query, update: () => query,
      limit: async () => ({ data: h.recipientLang ? [{ preferred_lang: h.recipientLang }] : [] }),
      maybeSingle: async () => ({ data: table === 'project_viewers'
        ? { email: 'recipient@example.com', relationship: 'Name', project_id: 'project', invited_by: 'inviter', accepted_at: h.accepted ? 'now' : null, revoked_at: null, is_client: h.isClient }
        : table === 'projects' ? { name: 'Home', country: 'CM' } : { full_name: 'Inviter', preferred_lang: null } }),
    };
    return query;
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function send() {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ method: 'POST', body: { shareToken: '00000000-0000-0000-0000-000000000001', lang: 'en' } }, res);
  return res;
}
describe('invitation emails reflect the actual project role', () => {
  it.each([false, true])('sends English from an English screen and only activates primary clients (isClient=%s)', async isClient => {
    h.isClient = isClient;
    expect((await send()).status).toHaveBeenCalledWith(200);
    expect(h.send).toHaveBeenCalledOnce();
    const email = h.send.mock.calls[0][0];
    expect(email.html).toContain(isClient ? 'approve work and invite observers' : 'Follow project stages');
    expect(email.to).toBe('recipient@example.com');
    expect(h.crm).toHaveBeenCalledTimes(isClient ? 1 : 0);
    expect(h.note).toHaveBeenCalledOnce();
  });
  it('honours the recipient’s stored French preference', async () => {
    h.isClient = true; h.recipientLang = 'fr'; await send();
    expect(h.send.mock.calls[0][0].html).toContain('validez les travaux et invitez des observateurs');
  });
  it('does not send an already accepted invitation', async () => {
    h.accepted = true; expect((await send()).status).toHaveBeenCalledWith(404);
    expect(h.send).not.toHaveBeenCalled(); expect(h.crm).not.toHaveBeenCalled();
  });
});
