import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { AccountRole } from '@/lib/auth/account-role';
const h = vi.hoisted(() => ({ role: 'client' as AccountRole | undefined }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ accountRole: h.role }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
import { ProjectBackLink } from './ProjectBackLink';
beforeEach(() => { h.role = 'client'; });

describe('Back from a project has a usable, explicit destination', () => {
  it.each([
    ['client', '/projects'], ['contractor', '/work/projects'], ['admin', '/admin/projects'], ['verifier', '/verifiers#projects'],
  ] as const)('%s returns to its current dashboard project list', (role, expected) => {
    h.role = role;
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/projects/a?tab=stages&stage=4']}><ProjectBackLink fallbackRole="contractor" /></MemoryRouter>);
    expect(html).toContain(`href="${expected}"`);
    expect(html).toContain('aria-label="projectLinks.backToProjects"');
    expect(html).toContain('min-h-11');
    expect(html).not.toContain('hidden sm:inline');
  });
  it('uses document navigation, so it does not depend on a failing project SPA transition', () => {
    expect(ProjectBackLink({}).props.reloadDocument).toBe(true);
  });
  it('follows an admin role correction instead of the role of the screen being left', () => {
    h.role = 'contractor'; expect(ProjectBackLink({ fallbackRole: 'contractor' }).props.to).toBe('/work/projects');
    h.role = 'client'; expect(ProjectBackLink({ fallbackRole: 'contractor' }).props.to).toBe('/projects');
    h.role = 'admin'; expect(ProjectBackLink({}).props.to).toBe('/admin/projects');
  });
  it('can leave a loading or denied project before account roles finish loading', () => {
    h.role = undefined;
    expect(ProjectBackLink({ fallbackRole: 'verifier' }).props.to).toBe('/verifiers#projects');
    expect(ProjectBackLink({ fallbackRole: 'admin' }).props.to).toBe('/admin/projects');
  });
  it('keeps a nested editor’s exact project/tab return path', () => {
    const back = ProjectBackLink({ to: '/work/projects/project-1?tab=money', label: 'My project' });
    expect(back.props).toMatchObject({ to: '/work/projects/project-1?tab=money', 'aria-label': 'My project', reloadDocument: true });
  });
});
