import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { destinationFor } from '@/components/ui/NotificationBell';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * Every way into a conversation actually arrives at one.
 *
 * Messaging existed and the doors did not. Reported, in order:
 *
 *   · the client's sidebar had no Messages at all;
 *   · the dashboard's "Messages" shortcut went to /notifications — a list of things
 *     that had happened, not the thread;
 *   · the bell opened the project overview instead of the message;
 *   · `destinationFor` had been pointing project-less threads at /messages, a route
 *     that did not exist, so that was a dead link too.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const nav       = read('src/components/shell/nav-config.ts');
const routes    = read('src/app/routes.ts');
const dashboard = read('src/app/routes/dashboard.tsx');

describe('the sidebar', () => {
  it('the client has a Messages item', () => {
    const block = nav.slice(nav.indexOf('CLIENT_NAV'), nav.indexOf('ADMIN_NAV'));
    expect(block).toMatch(/to: '\/messages'/);
  });

  it('and it is labelled in both languages', () => {
    expect((en as any).nav.messages).toBe('Messages');
    expect((fr as any).nav.messages).toBe('Messages');
  });
});

describe('the route it points at exists', () => {
  it('/messages is registered inside the signed-in shell', () => {
    // It was referenced by destinationFor long before it existed.
    expect(routes).toMatch(/route\("messages",\s+"routes\/messages\.tsx"\)/);
  });

  it('and the page reuses the project chat rather than a second one', () => {
    // Two chat implementations drift: one gets the channel buttons, one does not.
    expect(read('src/app/routes/messages.tsx')).toMatch(/<ProjectConversations/);
  });

  it('with an empty state rather than invented threads', () => {
    expect(read('src/app/routes/messages.tsx')).toMatch(/messages\.emptyTitle/);
    for (const d of [en, fr]) expect((d as any).messages.emptyTitle.length).toBeGreaterThan(0);
  });
});

describe('the dashboard shortcut', () => {
  it('no longer sends "Messages" to the notifications list', () => {
    const block = dashboard.slice(dashboard.indexOf('const actions = ['),
                                  dashboard.indexOf("labelKey: 'dashboard.quick.documents'"));
    const msg = block.slice(block.indexOf("icon: MessageSquare") - 300,
                            block.indexOf("labelKey: 'dashboard.quick.messages'"));
    expect(msg).not.toMatch(/to: '\/notifications'/);
  });

  it('and opens the open build\'s messages when there is one', () => {
    expect(dashboard).toMatch(/to: project \? `\/projects\/\$\{project\.id\}\?tab=messages` : '\/messages'/);
  });
});

describe('the bell', () => {
  const PROJECT = '11111111-2222-3333-4444-555555555555';

  it('a message notification opens the messages tab, per role', () => {
    expect(destinationFor({ project_id: PROJECT, conversation_id: 'c' }))
      .toBe(`/projects/${PROJECT}?tab=messages`);
    expect(destinationFor({ project_id: PROJECT, conversation_id: 'c', role: 'contractor' }))
      .toBe(`/work/projects/${PROJECT}?tab=messages`);
  });

  it('and a thread with no project goes to the page that now exists', () => {
    expect(destinationFor({ conversation_id: 'c' })).toBe('/messages');
  });
});
