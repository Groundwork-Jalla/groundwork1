import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ reply: {} as any, eq: vi.fn(), is: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: () => ({
  select: () => ({ eq: h.eq }),
}) } }));
import { fetchProjectCertificates } from '@/lib/supabase/certificates';

beforeEach(() => {
  vi.clearAllMocks(); h.reply = { data: [], error: null };
  h.eq.mockReturnValue({ is: h.is }); h.is.mockImplementation(() => Promise.resolve(h.reply));
});

describe('only actual, unrevoked issuance creates certificate entries', () => {
  it('does not manufacture an entry when no certificate was issued', async () => {
    expect(await fetchProjectCertificates('project', { strict: true })).toEqual(new Map());
    expect(h.eq).toHaveBeenCalledWith('project_id', 'project');
    expect(h.is).toHaveBeenCalledWith('revoked_at', null);
  });
  it('indexes formally issued records by their actual stage without inferring from stage status', async () => {
    h.reply.data = [{ id: 'cert', stage_id: 'stage', pdf_url: 'https://files.test/cert.pdf' }];
    const records = await fetchProjectCertificates('project', { strict: true });
    expect(records.size).toBe(1);
    expect(records.get('stage')).toEqual({ id: 'cert', stageId: 'stage', pdfUrl: 'https://files.test/cert.pdf' });
  });
  it('surfaces catalogue read errors, while legacy hidden controls can still degrade quietly', async () => {
    h.reply = { data: null, error: new Error('read denied') };
    await expect(fetchProjectCertificates('project', { strict: true })).rejects.toThrow('read denied');
    expect(await fetchProjectCertificates('project')).toEqual(new Map());
  });
});
