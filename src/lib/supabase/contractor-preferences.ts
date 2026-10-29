import { supabase } from './client';

// =========================================================
// A contractor's own settings.
//
// Stored on the account rather than the device, so a contractor who picks up a
// different phone on site finds the same app. They live in `user_metadata`, which is
// where `updateProfile()` already writes the name and the phone — no new table, and
// therefore no migration standing between this screen and working.
//
// Language and dark mode are NOT here. Language belongs to LanguageContext and dark
// mode to ThemeContext (migration 043, account-scoped); duplicating either would give
// the app two answers to one question.
// =========================================================

/** Which notification a contractor wants. Every one defaults ON except the last. */
export const NOTIFY_KEYS = [
  'stageApproved', 'paymentReleased', 'clientMessage', 'verifierChanges', 'news',
] as const;
export type NotifyKey = typeof NOTIFY_KEYS[number];

export type NotifyPrefs = Record<NotifyKey, boolean>;

/**
 * What somebody gets if they have never touched the switches.
 *
 * The four that concern a live build are on: a contractor who misses "a verifier
 * asked for changes" loses days. Groundwork's own news is off, because opting
 * somebody into marketing by default is not a default, it is a decision made for
 * them.
 */
export const NOTIFY_DEFAULTS: NotifyPrefs = {
  stageApproved: true, paymentReleased: true, clientMessage: true,
  verifierChanges: true, news: false,
};

/** Which currency leads on a figure: the project's own, or dollars. */
export type CurrencyFirst = 'local' | 'usd';

export interface ContractorPreferences {
  notify: NotifyPrefs;
  currencyFirst: CurrencyFirst;
}

export function readPreferences(metadata: unknown): ContractorPreferences {
  const m = (metadata ?? {}) as Record<string, unknown>;
  const saved = (m.notify ?? {}) as Record<string, unknown>;
  const notify = { ...NOTIFY_DEFAULTS };
  // Only a real boolean overrides a default: a half-written object must not turn
  // somebody's stage notifications off by being absent.
  for (const key of NOTIFY_KEYS) {
    if (typeof saved[key] === 'boolean') notify[key] = saved[key] as boolean;
  }
  return {
    notify,
    currencyFirst: m.currency_first === 'usd' ? 'usd' : 'local',
  };
}

export async function savePreferences(next: Partial<{
  notify: NotifyPrefs;
  currencyFirst: CurrencyFirst;
}>): Promise<void> {
  const data: Record<string, unknown> = {};
  if (next.notify) data.notify = next.notify;
  if (next.currencyFirst) data.currency_first = next.currencyFirst;
  const { error } = await supabase.auth.updateUser({ data });
  if (error) throw new Error(error.message);
}
