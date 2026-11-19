import { describe, expect, it } from 'vitest';
import { groupActivityByActor } from './activity-groups';

const ev = (id: string, actorName: string, createdAt: string) => ({ id, actorName, createdAt });

describe('groupActivityByActor', () => {
  it('groups multiple events for the same actor and orders by newest activity', () => {
    const groups = groupActivityByActor([
      ev('1', 'Ruth', '2026-11-18T08:00:00Z'),
      ev('2', 'Favour', '2026-11-18T09:00:00Z'),
      ev('3', 'Ruth', '2026-11-18T10:00:00Z'),
      ev('4', 'ruth', '2026-11-18T07:00:00Z'),
    ]);
    expect(groups.map(g => [g.actorName, g.events.length, g.latestAt])).toEqual([
      ['Ruth', 3, '2026-11-18T10:00:00Z'],
      ['Favour', 1, '2026-11-18T09:00:00Z'],
    ]);
    expect(groups[0].events.map(e => e.id)).toEqual(['3', '1', '4']);
  });

  it('keeps unnamed/system events separate instead of lumping them together', () => {
    const groups = groupActivityByActor([
      ev('a', '', '2026-11-18T09:00:00Z'),
      ev('b', '  ', '2026-11-18T08:00:00Z'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every(g => g.events.length === 1)).toBe(true);
  });
});
