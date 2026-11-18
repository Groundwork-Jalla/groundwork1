import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { lookup } from '@/lib/i18n/translate';

const h = vi.hoisted(() => ({ location: { pathname: '/admin', search: '' } }));
vi.mock('react-router', () => ({
  useLocation: () => h.location,
  Link: ({ to, children, onClick: _onClick, ...rest }: any) => createElement('a', { href: to, ...rest }, children),
}));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => (lookup(en as never, key) as string) ?? key, useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/ui/LanguageToggle', () => ({ LanguageToggle: () => null }));
vi.mock('@/components/ui/GroundworkLogo', () => ({ GroundworkLogo: () => null }));
import { ADMIN_NAV, CLIENT_NAV } from './nav-config';
import { activeNavItem, navGroups } from './nav-groups';
import { AppSidebar } from './AppSidebar';

const label = (key: string) => lookup(en as never, key) as string;
const sidebar = (pathname: string, search = '', nav = ADMIN_NAV) => {
  h.location = { pathname, search };
  return renderToStaticMarkup(createElement(AppSidebar, { nav, displayName: 'Ruth', onLogout: () => {} }));
};
const links = (html: string) => [...html.matchAll(/<a href="([^"]+)"([^>]*)>/g)].map(m => ({ href: m[1].replace(/&amp;/g, '&'), current: m[2].includes('aria-current="page"') }));

describe('the admin sidebar in dropdowns keeps every item', () => {
  it('groups all 38 items, each once, in the same order', () => {
    const groups = navGroups(ADMIN_NAV);
    expect(groups.flatMap(group => group.items)).toEqual(ADMIN_NAV);
    expect(ADMIN_NAV).toHaveLength(38);
    expect(groups.map(group => [label(group.section!), group.items.length, group.collapsible])).toEqual([
      ['Overview', 2, false], ['Work', 5, true], ['Finance', 4, true], ['People', 8, true], ['Communication', 6, true],
      ['Acquisition', 6, true], ['Support', 1, false], ['Analytics', 1, false], ['System', 5, true]]);
  });

  it('on every item\'s own page: that item is shown, lit alone, and links where it always did', () => {
    for (const item of ADMIN_NAV) {
      const [path, query] = item.to.split('?');
      const html = sidebar(path, query ? `?${query}` : '');
      const shown = links(html);
      expect(shown.find(link => link.href === item.to), `${item.to} is visible on its own page`).toBeTruthy();
      expect(shown.filter(link => link.current).map(link => link.href), `only ${item.to} is lit`).toEqual([item.to]);
      expect(html).toContain(`>${label(item.labelKey).replace(/&/g, '&amp;')}<`);
    }
  });

  it('lights WhatsApp alone, not Inbox, Jalla Messages, Email or Calls (the 18 Nov bug)', () => {
    expect(activeNavItem(ADMIN_NAV, '/admin/inbox', '?channel=whatsapp&conversation=abc')).toBe('/admin/inbox?channel=whatsapp');
    expect(activeNavItem(ADMIN_NAV, '/admin/inbox', '')).toBe('/admin/inbox');
    expect(activeNavItem(ADMIN_NAV, '/admin/inbox', '?status=active')).toBe('/admin/inbox');
    expect(activeNavItem(ADMIN_NAV, '/admin/contractors/records', '')).toBe('/admin/contractors/records');
    expect(activeNavItem(ADMIN_NAV, '/admin/projects/123', '?tab=money')).toBe('/admin/projects');
    expect(activeNavItem(ADMIN_NAV, '/admin/finance/inflows', '')).toBe('/admin/finance/inflows');
  });

  it('opens only the current page\'s dropdown; the others show their name and count', () => {
    const html = sidebar('/admin/inbox', '?channel=whatsapp');
    const hrefs = links(html).map(link => link.href);
    for (const to of ['/admin/inbox', '/admin/inbox?channel=whatsapp', '/admin/notifications', '/admin/inbox?channel=jalla', '/admin/inbox?channel=email', '/admin/inbox?channel=call']) expect(hrefs).toContain(to);
    expect(hrefs).not.toContain('/admin/projects');
    expect(hrefs).toEqual(expect.arrayContaining(['/admin', '/admin/action-center', '/admin/support', '/admin/analytics']));
    expect(html).toMatch(/aria-expanded="true"[^>]*data-nav-group="nav.sectionCommunication"/);
    expect(html).toMatch(/aria-expanded="false"[^>]*data-nav-group="nav.sectionWork"/);
  });

  it('leaves the homeowner sidebar exactly as it was: flat, every item', () => {
    const shown = links(sidebar('/projects', '', CLIENT_NAV)).map(link => link.href);
    expect(shown).toEqual(CLIENT_NAV.map(item => item.to));
    expect(sidebar('/projects', '', CLIENT_NAV)).not.toContain('aria-expanded');
  });
});
