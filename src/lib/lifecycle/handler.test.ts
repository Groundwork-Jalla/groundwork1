import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ run: vi.fn(), preview: vi.fn(), caller: vi.fn(), replies:vi.fn(),admin: {from:vi.fn(),rpc:vi.fn()} }));
vi.mock('../../../api/_lib/lifecycle.js', () => ({ runDue: h.run, previewDue: h.preview }));
vi.mock('../../../api/_lib/stripe.js', () => ({ getSupabaseAdmin: () => h.admin }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: h.caller }) }));
vi.mock('../../../api/_lib/communication-email.js',()=>({sendQueuedCommunicationReplies:h.replies}));
import { handler } from '../../../api/_handlers/lifecycle-run';
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('SUPABASE_URL', 'https://db.example.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'unit-test-service'); vi.stubEnv('CRON_SECRET', 'unit-test-scheduler');
  h.run.mockResolvedValue({ sent: 1 }); h.preview.mockResolvedValue({ checked: 1, ready: 1, rows: [] });
  h.caller.mockResolvedValue({ data: false });
  h.replies.mockResolvedValue({sent:0,failed:0,skipped:0});h.admin.rpc.mockResolvedValue({data:{resolved:0,overdue:0},error:null});
  h.admin.from.mockImplementation(()=>{const query:any={insert:()=>query,select:()=>query,single:async()=>({data:{id:'run'},error:null}),update:()=>query,eq:async()=>({error:null})};return query;});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function request(body: any, bearer = 'unit-test-scheduler') {
  const response: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ method: 'POST', body, headers: { authorization: `Bearer ${bearer}` } }, response);
  return response;
}
describe('reminder execution endpoint', () => {
  it('previews with authorized access and never invokes delivery', async () => {
    const response = await request({ preview: true });
    expect(h.preview).toHaveBeenCalledWith(h.admin); expect(h.run).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, preview: true, ready: 1 }));
  });
  it('retains the normal authorized scheduled run', async () => {
    await request({}); expect(h.run).toHaveBeenCalledWith(h.admin,expect.any(Date),20); expect(h.preview).not.toHaveBeenCalled();
  });
  it('rejects ordinary accounts for preview and delivery', async () => {
    const response = await request({ preview: true }, 'ordinary-session');
    expect(response.status).toHaveBeenCalledWith(401); expect(h.preview).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled();
  });
  it('allows an actual staff session to preview', async () => {
    h.caller.mockResolvedValue({ data: true });
    await request({ preview: true }, 'admin-session'); expect(h.preview).toHaveBeenCalledOnce();
  });
  it('explains an unapplied migration clearly', async () => {
    h.run.mockRejectedValue({ code: 'PGRST202' });
    const response = await request({}); expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({ error: 'Apply the lifecycle delivery migration before running reminders.' });
  });
});
