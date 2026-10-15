import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('project messaging surfaces', () => {
  it('renders the same Jalla project thread for clients, contractors and verifiers', () => {
    expect(read('src/app/routes/projects/detail.tsx')).toContain('<ProjectConversations');
    expect(read('src/app/routes/work/projects.detail.tsx')).toContain("id: 'messages'");
    expect(read('src/app/routes/work/projects.detail.tsx')).toContain('<ProjectConversations');
    expect(read('src/components/verifier/VerificationWorkspace.tsx')).toContain('<ProjectConversations');
    expect(read('src/components/admin/workspace/ConversationsTab.tsx')).toContain('<ConversationThread');
  });

  it('limits the member thread to message sending, not staff-only actions', () => {
    const thread = read('src/components/admin/conversations/ConversationThread.tsx');
    expect(thread).toContain('memberView ? undefined : direction');
    expect(thread).toContain('{!memberView && <div');
    expect(thread).toContain('{!memberView && <button');
    expect(thread).toContain("{!memberView && <span");
  });
});

describe('project message authorization', () => {
  const sql = read('supabase/migrations/122_project_member_messaging.sql');

  it('allows owners, accepted contractors and active verifiers but not unassigned users', () => {
    expect(sql).toMatch(/ci\.status = 'accepted'/);
    expect(sql).toMatch(/pv\.status = 'active'/);
    expect(sql).toContain('public.project_messaging_member(v_conv.project_id)');
    expect(sql).toContain('public.project_messaging_member(p_project)');
    expect(sql).toContain('public.project_messaging_member(project_id)');
  });

  it('keeps admin-only notes private and leaves viewers read-only', () => {
    expect(sql).toContain("direction <> 'internal'");
    expect(sql).not.toContain('project_viewers');
    expect(sql).toMatch(/IF v_dir NOT IN \('outbound', 'internal'\)/);
  });
});
