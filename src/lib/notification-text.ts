import { useCallback } from 'react';
import { useT, type TKey } from '@/lib/i18n';

/**
 * A notification, read in the reader's language.
 *
 * `notifications.title` and `body` are stored English, written by whichever writer
 * fired. Migration 149 added `title_key` / `body_key` / `params` beside them, so the
 * bell can go through the dictionary — the same shape 024 gave stage names, and for
 * the same reason: the stored text has to survive as the fallback.
 *
 * Three rules, in one place so the page and the bell cannot disagree:
 *
 *   no key           → the stored English. Staff notifications are written for staff
 *                      and have no key on purpose; so does anything written before 149.
 *   key that misses  → the stored English, never a raw `notifications.item.…` on screen.
 *   body is an excerpt of a real message → no body_key, so it is never translated.
 *     What somebody typed is theirs, in the language they typed it in.
 */
export interface TranslatableNotification {
  title: string;
  body: string;
  title_key?: string | null;
  body_key?: string | null;
  params?: Record<string, unknown> | null;
}

/** A translator with the shape `useT()` returns. */
type Translate = (key: TKey, params?: Record<string, string | number>) => string;

/**
 * Kept pure and separate from the hook so the three rules above are actually testable
 * — the same reason `reconcileLang` sits outside its effect.
 */
export function resolveNotificationText(
  t: Translate, n: TranslatableNotification,
): { title: string; body: string } {
  const params = (n.params ?? {}) as Record<string, string | number>;

  const resolve = (key: string | null | undefined, stored: string): string => {
    if (!key) return stored;
    const out = t(key as TKey, params);
    // t() hands back the key itself when it is missing, which is worse than English.
    return out === key ? stored : out;
  };

  return {
    title: resolve(n.title_key, n.title),
    body:  resolve(n.body_key, n.body),
  };
}

export function useNotificationText() {
  const t = useT();
  return useCallback(
    (n: TranslatableNotification) => resolveNotificationText(t, n),
    [t],
  );
}
