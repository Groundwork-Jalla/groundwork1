import { supabase } from './client';
import { listAdminUsers } from './admin-users';

// =========================================================
// Global search for the admin top bar.
//
// DELIBERATELY SMALL (Favour, 14 Sep 2026: "Keep the implementation scoped. Do not turn
// this into a large global-search architecture yet."). Two record types, both already
// readable by an admin through an existing authorised path:
//
//   • projects — `projects.name`, ILIKE, through the admin's own RLS grant
//   • people   — `admin_list_users()`, the one SECURITY DEFINER function that may read an
//                account's name and email (migration 032). Nothing here widens what an
//                admin can see; it only stops them having to remember which list it is on.
//
// There is no full-text index and no ranking model. At Groundwork's size a prefix/contains
// match over two small sets is the honest implementation — and an honest small search is
// worth more than an input that looks like Algolia and returns nothing.
//
// Every hit is a real row. A search that finds nothing says so; it never pads the list.
// =========================================================

export type SearchKind = 'project' | 'person';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  /** What the admin typed against: a project name, or a person's name. */
  title: string;
  /** The second line — the owner's status, or the account's email and roles. */
  detail: string;
  /** A real admin destination, already filtered to this record. */
  to: string;
}

/** Per kind, so one type can never crowd the other out of the list. */
export const SEARCH_LIMIT = 5;

/** Cached for the life of the page: `admin_list_users()` returns every account at once. */
let peopleCache: Promise<Awaited<ReturnType<typeof listAdminUsers>>> | null = null;
export function resetSearchCache() { peopleCache = null; }

export interface SearchResults {
  projects: SearchHit[];
  people: SearchHit[];
  /** True when a source could not be read, so the UI can say "partial" rather than "none". */
  partial: boolean;
}

export async function searchAdmin(raw: string): Promise<SearchResults> {
  const q = raw.trim();
  if (q.length < 2) return { projects: [], people: [], partial: false };
  const needle = q.toLowerCase();
  let partial = false;

  // PostgREST's ILIKE pattern: `%` and `_` are wildcards and `,` ends the filter value,
  // so they are escaped rather than passed through as typed.
  const pattern = `%${q.replace(/[%_,\\]/g, ch => `\\${ch}`)}%`;

  const [projectsRes, peopleRes] = await Promise.allSettled([
    supabase.from('projects')
      .select('id, name, status, country, city')
      .ilike('name', pattern)
      .order('updated_at', { ascending: false })
      .limit(SEARCH_LIMIT),
    (peopleCache ??= listAdminUsers()),
  ]);

  const projects: SearchHit[] = [];
  if (projectsRes.status === 'fulfilled' && !projectsRes.value.error) {
    for (const r of (projectsRes.value.data ?? []) as Record<string, unknown>[]) {
      const name = String(r.name ?? '');
      projects.push({
        kind: 'project',
        id: String(r.id ?? ''),
        title: name,
        detail: [r.status, [r.city, r.country].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
        // The projects module, narrowed to this one row by the same `q` its own search
        // box uses — so the destination really is showing the record that was clicked.
        to: `/admin/projects?q=${encodeURIComponent(name)}`,
      });
    }
  } else {
    partial = true;
    if (projectsRes.status === 'rejected') { /* nothing to report beyond `partial` */ }
  }

  const people: SearchHit[] = [];
  if (peopleRes.status === 'fulfilled') {
    for (const u of peopleRes.value) {
      if (people.length >= SEARCH_LIMIT) break;
      const hit = u.fullName.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle);
      if (!hit) continue;
      people.push({
        kind: 'person',
        id: u.id,
        // An account with no profile name is shown by the address it signs in with —
        // which is what it is — never by a name invented from the address.
        title: u.fullName || u.email,
        detail: [u.fullName ? u.email : '', u.roles].filter(Boolean).join(' · '),
        to: `/admin/users?q=${encodeURIComponent(u.email)}`,
      });
    }
  } else {
    peopleCache = null;   // a failed call must not be cached as "no people"
    partial = true;
  }

  return { projects, people, partial };
}
