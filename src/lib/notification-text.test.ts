import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveNotificationText } from './notification-text';
import { en } from './i18n/en';
import { fr } from './i18n/fr';
import { translate } from './i18n/translate';
import type { TKey } from './i18n';

/**
 * A notification is read in the reader's language.
 *
 * `title` and `body` are stored English, written by whichever writer fired, and the
 * bell rendered them verbatim — so a francophone client on an otherwise French screen
 * read "Your budget is confirmed". 149 added the keys beside them; the stored text has
 * to survive as the fallback, because staff notifications have no key on purpose and
 * nothing written before 149 has one either.
 */

const ROOT = resolve(__dirname, '..', '..');
const t = (lang: 'en' | 'fr') =>
  (key: TKey, params?: Record<string, string | number>) => translate(lang, key, params);

const row = (o: Partial<Parameters<typeof resolveNotificationText>[1]> = {}) => ({
  title: 'Your budget is confirmed', body: 'Jalla has confirmed the budget.',
  title_key: null, body_key: null, params: null, ...o,
});

describe('resolveNotificationText', () => {
  it('reads a keyed notification in French', () => {
    const out = resolveNotificationText(t('fr'), row({
      title_key: 'notifications.item.budgetConfirmed',
      body_key:  'notifications.item.budgetConfirmedBody',
      params:    { project: 'Franka Home' },
    }));
    expect(out.title).toBe('Votre budget est confirmé');
    expect(out.body).toContain('Franka Home');
    expect(out.body).not.toContain('Jalla has confirmed');
  });

  it('keeps the stored English when there is no key', () => {
    // Staff notifications, and everything written before 149.
    const out = resolveNotificationText(t('fr'), row());
    expect(out.title).toBe('Your budget is confirmed');
    expect(out.body).toBe('Jalla has confirmed the budget.');
  });

  it('never puts a raw key on screen when one is missing', () => {
    const out = resolveNotificationText(t('fr'), row({
      title_key: 'notifications.item.doesNotExist',
    }));
    expect(out.title).toBe('Your budget is confirmed');
  });

  it('leaves a message excerpt alone — it is what somebody typed', () => {
    // The title is ours and is translated; the body is theirs and is not.
    const out = resolveNotificationText(t('fr'), {
      title: 'New message about Franka Home',
      body:  'can we talk tomorrow',
      title_key: 'notifications.item.newMessageAbout',
      body_key: null,
      params: { project: 'Franka Home' },
    });
    expect(out.title).toBe('Nouveau message à propos de Franka Home');
    expect(out.body).toBe('can we talk tomorrow');
  });

  it('interpolates the sender into both languages', () => {
    const n = {
      title: 'New message', body: 'Ruth sent a message',
      title_key: 'notifications.item.newMessage',
      body_key:  'notifications.item.newMessageBody',
      params:    { name: 'Ruth' },
    };
    expect(resolveNotificationText(t('en'), n).body).toBe('Ruth sent a message');
    expect(resolveNotificationText(t('fr'), n).body).toBe('Ruth a envoyé un message');
  });
});

/**
 * The migration and the dictionary have to agree. A key the trigger writes but the
 * dictionary lacks renders as the stored English — safe, but silently untranslated,
 * which is the failure this whole change exists to remove.
 */
describe('149 and the dictionary agree', () => {
  const sql = readFileSync(
    join(ROOT, 'supabase/migrations/149_notifications_speak_your_language.sql'), 'utf8');
  const keys = [...sql.matchAll(/'(notifications\.item\.[A-Za-z]+)'/g)].map(m => m[1]);

  it('writes keys at all', () => {
    expect(new Set(keys).size).toBeGreaterThanOrEqual(5);
  });

  it('every key the migration writes exists in both dictionaries', () => {
    for (const key of new Set(keys)) {
      for (const [lang, dict] of [['en', en], ['fr', fr]] as const) {
        const value = key.split('.').reduce<unknown>(
          (node, seg) => (node && typeof node === 'object'
            ? (node as Record<string, unknown>)[seg] : undefined), dict);
        expect(typeof value, `${key} missing from ${lang}`).toBe('string');
      }
    }
  });

  it('drops notify_project_members before widening it, so no overload survives', () => {
    const drop = sql.indexOf('DROP FUNCTION IF EXISTS public.notify_project_members');
    const create = sql.indexOf('CREATE OR REPLACE FUNCTION public.notify_project_members');
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(create);
  });

  it('runs in one transaction', () => {
    expect(sql.replace(/--.*$/gm, '')).toMatch(/BEGIN;[\s\S]*COMMIT;/);
  });
});
