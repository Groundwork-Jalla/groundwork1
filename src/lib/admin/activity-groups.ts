/**
 * Groups audit/activity rows by actor so high-volume feeds stay scannable at scale
 * (18 Nov: "group by user with a total count, e.g. 17 notifications, expanding on click").
 *
 * Groups are ordered by their most recent event timestamp descending; events inside each
 * group stay newest-first. Unnamed actors ("") are kept as separate singletons so distinct
 * system/deleted-account rows are never merged into one anonymous bucket.
 */
export interface ActivityGroup<T extends { id: string; actorName: string; createdAt: string }> {
  key: string;
  actorName: string;
  latestAt: string;
  events: T[];
}

export function groupActivityByActor<T extends { id: string; actorName: string; createdAt: string }>(
  events: T[],
): ActivityGroup<T>[] {
  const byKey = new Map<string, ActivityGroup<T>>();
  const ordered: ActivityGroup<T>[] = [];

  for (const ev of events) {
    const trimmed = (ev.actorName ?? '').trim();
    const key = trimmed ? `actor:${trimmed.toLowerCase()}` : `anon:${ev.id}`;
    const existing = byKey.get(key);
    if (!existing) {
      const group: ActivityGroup<T> = {
        key,
        actorName: trimmed,
        latestAt: ev.createdAt,
        events: [ev],
      };
      byKey.set(key, group);
      ordered.push(group);
    } else {
      existing.events.push(ev);
      if (ev.createdAt > existing.latestAt) existing.latestAt = ev.createdAt;
    }
  }

  for (const g of ordered) {
    g.events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return ordered.sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}
