import { describe, expect, it } from 'vitest';
import { ticketThread, byRecency } from './ticket-thread';
import type { Conversation } from '@/lib/supabase/conversations';

/**
 * The rule under test is a negative one: a person with several conversations must never
 * resolve to one of them automatically. Every other branch exists to make that branch
 * rare, not to make it disappear.
 */
const C = (over: Partial<Conversation>): Conversation => ({
  id: 'c1', personId: 'p1', projectId: null, channel: 'whatsapp', subject: null,
  status: 'open', assignedTo: null, ghlConversationId: null,
  lastMessageAt: '2026-09-01T00:00:00Z', resolvedAt: null, createdAt: '2026-08-01T00:00:00Z',
  ...over,
});
const index = (rows: Conversation[]) => new Map(rows.map(c => [c.id, c]));
const grouped = (rows: Conversation[]) => {
  const m = new Map<string, Conversation[]>();
  for (const c of rows) if (c.personId) m.set(c.personId, [...(m.get(c.personId) ?? []), c]);
  return m;
};

describe('several conversations are a question, never an answer', () => {
  const rows = [
    C({ id: 'old', lastMessageAt: '2026-01-01T00:00:00Z' }),
    C({ id: 'new', lastMessageAt: '2026-09-20T00:00:00Z' }),
    C({ id: 'mid', lastMessageAt: '2026-05-05T00:00:00Z' }),
  ];

  it('does not pick the newest — it asks', () => {
    const got = ticketThread({ user_id: 'p1' }, grouped(rows), index(rows));
    expect(got.kind).toBe('choose');
    // The failure this guards against: silently landing on 'new'.
    expect(JSON.stringify(got)).not.toMatch(/"kind":"(single|linked)"/);
  });

  it('offers every one of them, newest first, for a human to read', () => {
    const got = ticketThread({ user_id: 'p1' }, grouped(rows), index(rows));
    if (got.kind !== 'choose') throw new Error('expected a chooser');
    expect(got.conversations).toHaveLength(3);
    expect(got.conversations.map(c => c.id)).toEqual(['new', 'mid', 'old']);
  });

  it('an explicit link ends the question, even against a newer thread', () => {
    const got = ticketThread({ user_id: 'p1', conversation_id: 'old' }, grouped(rows), index(rows));
    expect(got.kind).toBe('linked');
    if (got.kind !== 'linked') throw new Error('unreachable');
    expect(got.conversation.id).toBe('old');
  });
});

describe('the branches that are not guesses', () => {
  it('exactly one conversation is used without asking', () => {
    const rows = [C({ id: 'only' })];
    const got = ticketThread({ user_id: 'p1' }, grouped(rows), index(rows));
    expect(got.kind).toBe('single');
  });

  it('091 absent is unavailable, not "no conversation"', () => {
    expect(ticketThread({ user_id: 'p1' }, null, new Map()).kind).toBe('unavailable');
  });

  it('a ticket with no account has no thread, and its email is not matched on', () => {
    const rows = [C({ id: 'someone-elses', personId: 'p2' })];
    expect(ticketThread({ user_id: null }, grouped(rows), index(rows)).kind).toBe('none');
  });

  it('a person who has never written in gets an honest empty, not a chooser', () => {
    expect(ticketThread({ user_id: 'p1' }, new Map(), new Map()).kind).toBe('none');
  });

  it('a link to a thread we cannot read says so rather than falling back to a guess', () => {
    const rows = [C({ id: 'visible' }), C({ id: 'other' })];
    const got = ticketThread({ user_id: 'p1', conversation_id: 'gone' }, grouped(rows), index(rows));
    expect(got.kind).toBe('linkedMissing');
  });

  it('undefined and null both mean "nothing linked" — 091 may not be applied', () => {
    const rows = [C({ id: 'only' })];
    expect(ticketThread({ user_id: 'p1', conversation_id: null }, grouped(rows), index(rows)).kind).toBe('single');
    expect(ticketThread({ user_id: 'p1' }, grouped(rows), index(rows)).kind).toBe('single');
  });
});

describe('byRecency is for display only', () => {
  it('falls back to createdAt when a thread has no messages', () => {
    const rows = [
      C({ id: 'never', lastMessageAt: null, createdAt: '2026-09-22T00:00:00Z' }),
      C({ id: 'spoke', lastMessageAt: '2026-09-10T00:00:00Z' }),
    ];
    expect(byRecency(rows).map(c => c.id)).toEqual(['never', 'spoke']);
  });

  it('does not mutate what it is given', () => {
    const rows = [C({ id: 'a', lastMessageAt: '2026-01-01T00:00:00Z' }), C({ id: 'b' })];
    byRecency(rows);
    expect(rows.map(c => c.id)).toEqual(['a', 'b']);
  });
});
