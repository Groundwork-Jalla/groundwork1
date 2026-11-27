import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filterAdminUsers,
  summarizeUserProjects,
} from './user-directory-filter';
import { mergeUserProjectCounts, type AdminUser } from '@/lib/supabase/admin-users';
import {
  adminBroadcastHtml,
  adminBroadcastText,
  firstNameOf,
  resolveBroadcastActionUrl,
} from '@/lib/email/admin-broadcast-html';

const ROOT = resolve(__dirname, '..', '..', '..');

const SAMPLE_USERS = [
  { id: '11111111-1111-4111-8111-111111111111', email: 'kenno@example.cm', fullName: 'Kenno Jean', roles: '', country: 'CM', projectCount: 0, createdAt: '2026-11-25T10:00:00Z' },
  { id: '22222222-2222-4222-8222-222222222222', email: 'amara@example.com', fullName: 'Amara Builder', roles: 'contractor', country: 'CM', projectCount: 0, createdAt: '2026-08-15T10:00:00Z' },
  { id: '33333333-3333-4333-8333-333333333333', email: 'grace@example.com', fullName: 'Grace Owner', roles: '', country: 'US', projectCount: 2, createdAt: '2026-09-10T10:00:00Z' },
  { id: '44444444-4444-4444-8444-444444444444', email: 'ruth@tryjalla.com', fullName: 'Ruth Ijoma', roles: 'admin', country: 'NG', projectCount: 1, createdAt: '2026-08-01T10:00:00Z' },
];

describe('admin user directory filters', () => {
  it('summarizes users with and without projects accurately', () => {
    expect(summarizeUserProjects(SAMPLE_USERS)).toEqual({
      total: 4,
      withProjects: 2,
      withoutProjects: 2,
    });
  });

  it('filters to users without projects and with projects', () => {
    const noProjects = filterAdminUsers(SAMPLE_USERS, {
      query: '',
      projectFilter: 'no_projects',
      roleFilter: 'all',
    });
    expect(noProjects.map(u => u.email)).toEqual(['kenno@example.cm', 'amara@example.com']);

    const hasProjects = filterAdminUsers(SAMPLE_USERS, {
      query: '',
      projectFilter: 'has_projects',
      roleFilter: 'all',
    });
    expect(hasProjects.map(u => u.email)).toEqual(['grace@example.com', 'ruth@tryjalla.com']);
  });

  it('combines project filter, role filter, and search query', () => {
    const homeownersWithoutProjects = filterAdminUsers(SAMPLE_USERS, {
      query: '',
      projectFilter: 'no_projects',
      roleFilter: 'client',
    });
    expect(homeownersWithoutProjects.map(u => u.email)).toEqual(['kenno@example.cm']);

    const searchContractors = filterAdminUsers(SAMPLE_USERS, {
      query: 'amara',
      projectFilter: 'no_projects',
      roleFilter: 'contractor',
    });
    expect(searchContractors.map(u => u.email)).toEqual(['amara@example.com']);
  });

  it('filters by joined date so active 7-day sequence signups can be excluded', () => {
    const nowMs = Date.parse('2026-11-27T12:00:00Z');
    const olderNoProjects = filterAdminUsers(SAMPLE_USERS, {
      query: '',
      projectFilter: 'no_projects',
      roleFilter: 'all',
      joinedFilter: 'older_than_7d',
      nowMs,
    });
    expect(olderNoProjects.map(u => u.email)).toEqual(['amara@example.com']);

    const recentOnly = filterAdminUsers(SAMPLE_USERS, {
      query: '',
      projectFilter: 'no_projects',
      roleFilter: 'all',
      joinedFilter: 'last_7d',
      nowMs,
    });
    expect(recentOnly.map(u => u.email)).toEqual(['kenno@example.cm']);
  });

  it('counts accepted contractor invites and project viewers as active projects', () => {
    const base: AdminUser[] = SAMPLE_USERS.map(u => ({
      ...u,
      tier: null,
      provisionedBy: null,
      mustChangePassword: false,
      lastSignInAt: null,
    }));
    const merged = mergeUserProjectCounts(base, {
      owned: [{ id: 'proj-1', user_id: '33333333-3333-4333-8333-333333333333' }],
      invites: [{ project_id: 'proj-1', contractor_id: '22222222-2222-4222-8222-222222222222' }],
      viewers: [
        { project_id: 'proj-1', user_id: '22222222-2222-4222-8222-222222222222' },
        { project_id: 'proj-2', user_id: '11111111-1111-4111-8111-111111111111' },
      ],
    });
    // Amara has 1 distinct project across invite + viewer; Kenno gained 1 viewer project; Grace keeps RPC count 2
    expect(merged.find(u => u.email === 'amara@example.com')?.projectCount).toBe(1);
    expect(merged.find(u => u.email === 'kenno@example.cm')?.projectCount).toBe(1);
    expect(merged.find(u => u.email === 'grace@example.com')?.projectCount).toBe(2);
  });

  it('never leaks selections outside the active filter on /admin/users', () => {
    const src = readFileSync(join(ROOT, 'src/app/routes/admin/users.tsx'), 'utf8');
    expect(src).toContain('filtered.filter(u => selectedIds.has(u.id))');
    expect(src).toContain('setProjectFilterState(next);\n    setSelectedIds(new Set());');
    expect(src).not.toContain('setSelectedIds(new Set(filtered.map(u => u.id)))');
  });
});

describe('admin broadcast email template', () => {
  it('extracts first names safely with bilingual fallbacks', () => {
    expect(firstNameOf('Kenno Jean', 'fr')).toBe('Kenno');
    expect(firstNameOf('   ', 'en')).toBe('there');
    expect(firstNameOf('', 'fr')).toBe('cher membre');
  });

  it('rejects unsafe CTA URLs while allowing Groundwork routes and https URLs', () => {
    expect(resolveBroadcastActionUrl('/projects/new')).toMatch(/\/projects\/new$/);
    expect(resolveBroadcastActionUrl('https://www.tryjalla.com/projects/new')).toBe('https://www.tryjalla.com/projects/new');
    expect(resolveBroadcastActionUrl('javascript:alert(1)')).toBeNull();
    expect(resolveBroadcastActionUrl('//evil.example/phish')).toBeNull();
    expect(resolveBroadcastActionUrl('http://insecure.example')).toBeNull();
  });

  it('renders branded Groundwork green HTML, escapes user input, and interpolates {{name}}', () => {
    const html = adminBroadcastHtml({
      recipientName: 'Kenno Jean',
      body: 'Bonjour {{name}},\n\nTest <script>alert(1)</script> & follow-up.',
      lang: 'fr',
      actionLabel: 'Activer mon projet',
      actionPath: '/projects/new',
    });

    expect(html).toContain('lang="fr"');
    expect(html).toContain('#122d2b');
    expect(html).toContain('#006b5e');
    expect(html).toContain('Bonjour Kenno,');
    // Should not duplicate the automatic greeting when {{name}} was used
    expect(html.match(/Bonjour Kenno,/g)?.length).toBe(1);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; follow-up.');
    expect(html).toContain('Activer mon projet');
  });

  it('produces a clean plain-text fallback with automatic greeting when {{name}} is absent', () => {
    const text = adminBroadcastText({
      recipientName: 'Grace Owner',
      body: 'Your account is ready.',
      lang: 'en',
      actionLabel: 'Activate your project',
      actionPath: '/projects/new',
    });
    expect(text).toContain('Hi Grace,');
    expect(text).toContain('Your account is ready.');
    expect(text).toContain('Activate your project:');
  });
});

// ── Handler unit tests (mocked Supabase & Resend) ──────────────────────────
const requireUserMock = vi.fn();
const getSupabaseAdminMock = vi.fn();
const sendViaResendMock = vi.fn();

vi.mock('../../../api/_lib/stripe.js', () => ({
  requireUser: (...args: unknown[]) => requireUserMock(...args),
  getSupabaseAdmin: (...args: unknown[]) => getSupabaseAdminMock(...args),
}));

vi.mock('../../../api/_lib/resend-send.js', () => ({
  sendViaResend: (...args: unknown[]) => sendViaResendMock(...args),
}));

function makeRes() {
  const out = { statusCode: 200, body: null as unknown };
  return {
    out,
    status(code: number) { out.statusCode = code; return this; },
    json(payload: unknown) { out.body = payload; return this; },
  };
}

describe('api/_handlers/admin-message-users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is wired into api/events.ts and dev-invitation-api.ts', () => {
    const events = readFileSync(join(ROOT, 'api/events.ts'), 'utf8');
    expect(events).toMatch(/'admin-message-users':\s*adminMessageUsers/);
    const devMw = readFileSync(join(ROOT, 'scripts/dev-invitation-api.ts'), 'utf8');
    expect(devMw).toContain('admin-message-users');
  });

  it('rejects unauthenticated and non-admin callers', async () => {
    const { handler } = await import('../../../api/_handlers/admin-message-users');

    requireUserMock.mockResolvedValueOnce(null);
    const res401 = makeRes();
    await handler({ method: 'POST', headers: {}, body: {} }, res401);
    expect(res401.out.statusCode).toBe(401);

    requireUserMock.mockResolvedValueOnce({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    getSupabaseAdminMock.mockReturnValueOnce({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null }),
            }),
          }),
        }),
      }),
    });
    const res404 = makeRes();
    await handler({ method: 'POST', headers: {}, body: {} }, res404);
    expect(res404.out.statusCode).toBe(404);
  });

  it('resolves recipients by userIds on the server and sends branded emails via Resend', async () => {
    const { handler } = await import('../../../api/_handlers/admin-message-users');

    requireUserMock.mockResolvedValueOnce({ id: '44444444-4444-4444-8444-444444444444' });
    getSupabaseAdminMock.mockReturnValueOnce({
      from: (table: string) => {
        if (table === 'user_roles') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { role: 'admin' } }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            in: async () => ({
              data: [
                { id: '11111111-1111-4111-8111-111111111111', email: 'kenno@example.cm', full_name: 'Kenno Jean' },
                { id: '22222222-2222-4222-8222-222222222222', email: 'amara@example.com', full_name: 'Amara Builder' },
              ],
            }),
          }),
        };
      },
      auth: { admin: { getUserById: vi.fn() } },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    sendViaResendMock
      .mockResolvedValueOnce({ ok: true, attempts: 1, messageId: 're_1' })
      .mockResolvedValueOnce({ ok: false, attempts: 1, error: 'resend_422: invalid' });

    const res = makeRes();
    await handler({
      method: 'POST',
      headers: {},
      body: {
        userIds: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
        subject: 'Activez votre projet',
        message: 'Votre espace Groundwork vous attend.',
        lang: 'fr',
        includeActionLink: true,
        actionLabel: 'Activer mon projet',
        actionPath: '/projects/new',
      },
    }, res);

    expect(res.out.statusCode).toBe(200);
    expect(res.out.body).toMatchObject({
      ok: false,
      sent: 1,
      failed: 1,
      skipped: 0,
      failures: [{ email: 'amara@example.com', error: 'resend_422: invalid' }],
    });
    expect(sendViaResendMock).toHaveBeenCalledTimes(2);
    expect(sendViaResendMock.mock.calls[0][0].to).toBe('kenno@example.cm');
    expect(sendViaResendMock.mock.calls[0][0].html).toContain('Bonjour Kenno,');
  });
});
