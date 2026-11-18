import type { NavItem } from './nav-config';

// =========================================================
// The admin sidebar as dropdown groups, and which item is lit (18 Nov 2026).
//
// Every item in ADMIN_NAV keeps its label, order and destination; this only decides how
// they are grouped on screen and which ONE is highlighted.
// =========================================================

/** Where the open groups are remembered, per browser. */
export const OPEN_GROUPS_KEY = 'gw.nav.openGroups';

export interface NavGroup {
  key: string;
  /** The section's i18n key; undefined for a nav with no sections (the client's). */
  section?: NavItem['section'];
  items: NavItem[];
  /** Folds away. The first group (Overview) and one-item groups stay plain links. */
  collapsible: boolean;
}

/** Contiguous runs of items under one section heading, in nav order. */
export function navGroups(nav: NavItem[]): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const item of nav) {
    const last = groups[groups.length - 1];
    if (item.section && (!last || last.section !== item.section)) groups.push({ key: item.section, section: item.section, items: [item], collapsible: false });
    else if (last) last.items.push(item);
    else groups.push({ key: 'nav', items: [item], collapsible: false });
  }
  groups.forEach((group, i) => { group.collapsible = !!group.section && i > 0 && group.items.length > 1; });
  return groups;
}

/**
 * The one item the current address belongs to.
 *
 * A path matches like NavLink (exactly for `exact` items, otherwise itself or anything
 * beneath it). An item with a query matches only when every one of its parameters is in
 * the address — so `/admin/inbox?channel=whatsapp` is not lit on `/admin/inbox`, and
 * `/admin/inbox` is not lit on WhatsApp. Of the matches, the most specific wins: a query
 * match beats a bare path, and a longer path beats a shorter one.
 */
export function activeNavItem(nav: NavItem[], pathname: string, search: string): string | null {
  const params = new URLSearchParams(search);
  let best: string | null = null; let bestScore = -1;
  for (const item of nav) {
    const [path, query] = item.to.split('?');
    const onPath = item.exact ? pathname === path : pathname === path || pathname.startsWith(`${path.replace(/\/$/, '')}/`);
    if (!onPath) continue;
    let score = path.length;
    if (query) {
      const wanted = new URLSearchParams(query);
      let all = true; wanted.forEach((value, key) => { if (params.get(key) !== value) all = false; });
      if (!all) continue;
      score += 10_000;
    }
    if (score > bestScore) { bestScore = score; best = item.to; }
  }
  return best;
}
