import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Bell, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { NotificationRow } from '@/lib/supabase/notifications';
import { useNotifications } from '@/hooks/useNotifications';
import { useNotificationText } from '@/lib/notification-text';
import { destinationFor, resolveNotificationDestination } from '@/lib/notification-destination';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// /admin/notifications — the full list behind the bell (01 §3 COMMUNICATION).
//
// One source of truth: the same `notifications` rows, the same `destinationFor()` the
// bell uses, the same read state written by the same functions. The bell shows the most
// recent few; this is all of them, with the filter the bell has no room for.
//
// Read state is real — `notifications.read_at` (009) — so "unread" here is a column, not
// a count this page invented. A notification whose data names nothing we can open is
// shown without a link rather than as a dead click.
// =========================================================

const PAGE = 100;

export default function AdminNotifications() {
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const unreadOnly = params.get('state') === 'unread';

  const feed = useNotifications(user?.id, PAGE);
  const rows = feed.loaded ? feed.rows : null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const account = useRef(user?.id); account.current = user?.id;
  const clickVersion = useRef(0);
  const notificationText = useNotificationText();
  useEffect(() => { setError(null); return () => { ++clickVersion.current; }; }, [user?.id]);
  const unread = feed.unread;
  const shown = (rows ?? []).filter(n => !unreadOnly || !n.read_at);

  async function open(n: NotificationRow) {
    const recipient = user?.id, turn = ++clickVersion.current;
    try {
      const to = await resolveNotificationDestination(n.data, { isAdmin: true });
      if (account.current !== recipient || clickVersion.current !== turn) return;
      if (!n.read_at) void feed.markRead(n.id).catch(() => { if (account.current === recipient) setError(t('notifications.readFailed')); });
      if (to) navigate(to);
    } catch { if (account.current === recipient && clickVersion.current === turn) setError(t('notifications.openFailed')); }
  }

  async function markAll() {
    setBusy(true);
    try { await feed.markAllRead(); setError(null); }
    catch { setError(t('notifications.readFailed')); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-near-black dark:text-white">{t('admin.notifications.title')}</h1>
          <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.notifications.subtitle')}</p>
        </div>
        {rows !== null && rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setParams(prev => {
              const next = new URLSearchParams(prev);
              if (unreadOnly) next.delete('state'); else next.set('state', 'unread');
              return next;
            }, { replace: true })} aria-pressed={unreadOnly}
              className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                unreadOnly
                  ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                  : 'border-brand-border-grey text-brand-near-black hover:bg-brand-off-white dark:border-[#2c2c2c] dark:text-white dark:hover:bg-[#252525]')}>
              {t('admin.notifications.unread')}<span className="ml-1.5 tabular-nums">{unread}</span>
            </button>
            {unread > 0 && (
              <button type="button" onClick={markAll} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-semibold text-brand-near-black disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white">
                {busy && <Loader2 className="size-3.5 animate-spin" />}{t('admin.notifications.markAll')}
              </button>
            )}
          </div>
        )}
      </header>

      {(error || feed.failed) && <p role="alert" className="text-sm text-state-alert">{error ?? t('notifications.loadFailed')} <button type="button" className="underline" onClick={() => void feed.refresh()}>{t('common.retry')}</button></p>}
      {rows === null ? (
        <p className="flex items-center gap-2 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <EmptyState icon={<Bell className="size-8" />}
            title={t(rows.length === 0 ? 'admin.notifications.empty' : 'admin.notifications.allRead')}
            description={t(rows.length === 0 ? 'admin.notifications.emptyBody' : 'admin.notifications.allReadBody')} />
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          {shown.map(n => {
            const to = destinationFor(n.data, { isAdmin: true });
            const { title, body } = notificationText(n);
            return (
              <li key={n.id} className="border-b border-brand-border-grey last:border-0 dark:border-[#2c2c2c]">
                <button type="button" onClick={() => open(n)} disabled={!to && !!n.read_at}
                  className={cn('flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors',
                    (to || !n.read_at) && 'hover:bg-brand-off-white dark:hover:bg-[#252525]',
                    !n.read_at && 'bg-brand-off-white/60 dark:bg-[#252525]/60')}>
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-brand-border-grey' : 'bg-state-active')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-brand-near-black dark:text-white">{title}</span>
                    <span className="mt-0.5 block text-xs text-brand-mid-grey">{body}</span>
                    <span className="mt-1 block text-[11px] text-brand-mid-grey" title={formatDateTime(n.created_at)}>
                      {formatRelative(n.created_at)}
                      {!to && ` · ${t('admin.notifications.noTarget')}`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
