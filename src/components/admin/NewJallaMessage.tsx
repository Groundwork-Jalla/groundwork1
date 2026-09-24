import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2, Search, X, MessagesSquare, ChevronLeft, User } from 'lucide-react';
import { listAccountsForJalla, type JallaAccount, type JallaProject } from '@/lib/supabase/jalla-projects';
import { matchesAccount, matchesProject, canMessage, canMessageAccount, jallaHref } from '@/lib/admin/jalla-picker';
import { ensureProjectConversation } from '@/lib/supabase/conversations';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// Start a native Jalla conversation about a project (01 §3 COMMUNICATION).
//
// ── Account, then project — but the project still decides ───────────────────────────
// Picking the person first is how an admin thinks: "I need to talk to Mary about one of
// her builds." So step one lists accounts and step two lists that account's projects.
//
// This does NOT make the client an input. `project_conversation()` (091) reads the owner
// off the project inside the database, so the only thing that reaches the RPC is a
// project id. The account step is navigation — a way to narrow the list — and choosing
// one cannot pair a project with the wrong person, because the person is never sent.
//
// ── It does not create a second anything ─────────────────────────────────────────────
// `ensure_project_conversation` returns the project's existing Jalla thread when there is
// one, and takes an advisory lock before inserting when there is not. So "start" is the
// same call as "open", and pressing it twice cannot produce two threads. Nothing is sent
// from this modal: it hands the admin the real Inbox composer.
// =========================================================

export function NewJallaMessage({ onClose, onCreated }: {
  onClose: () => void;
  /** Re-read the Inbox before navigating, so the new thread is already in the list. */
  onCreated?: () => Promise<void> | void;
}) {
  const t = useT();
  const navigate = useNavigate();

  const [state, setState] = useState<{ rows: JallaAccount[]; available: boolean } | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  /** Step two. `null` is the account list. */
  const [account, setAccount] = useState<JallaAccount | null>(null);
  const [picked, setPicked] = useState<JallaProject | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listAccountsForJalla()
      .then(r => { if (alive) setState(r); })
      .catch(() => { if (alive) setState(null); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const accounts = useMemo(
    () => (state?.rows ?? []).filter(a => matchesAccount(a, query)),
    [state, query],
  );
  // The account's own projects, narrowed by the same box — so a search typed on step one
  // still applies when it lands on step two rather than silently resetting.
  const projects = useMemo(
    () => (account?.projects ?? []).filter(p => matchesProject(p, query) || matchesAccount(account!, query)),
    [account, query],
  );

  function back() { setAccount(null); setPicked(null); }

  async function start(project: JallaProject) {
    setBusy(true); setError(null);
    try {
      // Reuse or create — one call, and the database decides which.
      const id = await ensureProjectConversation(project.id);
      // The Inbox read its list when it mounted, so a thread created just now is not in
      // it. Without this the URL names a real conversation and the page says there is
      // none. Awaited, so the list is ready before the navigation lands.
      await onCreated?.();
      navigate(jallaHref(id));
      onClose();
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[10vh]" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label={t('admin.jalla.newTitle')}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-brand-border-grey bg-white shadow-xl dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-brand-border-grey px-5 py-4 dark:border-[#2c2c2c]">
          <div className="flex min-w-0 items-start gap-2">
            {account && (
              <button type="button" onClick={back} aria-label={t('common.back')}
                className="mt-px rounded-lg p-1 text-brand-mid-grey hover:bg-brand-off-white dark:hover:bg-[#252525]">
                <ChevronLeft className="size-4" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">
                {account ? (account.name || account.email || t('admin.jalla.ownerUnknown')) : t('admin.jalla.newTitle')}
              </h2>
              <p className="mt-0.5 text-xs text-brand-mid-grey">
                {account ? t('admin.jalla.pickProject') : t('admin.jalla.newSub')}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}
            className="rounded-lg p-1 text-brand-mid-grey hover:bg-brand-off-white dark:hover:bg-[#252525]">
            <X className="size-4" />
          </button>
        </header>

        {error && (
          <p role="alert" className="border-b border-brand-border-grey px-5 py-2.5 text-xs text-state-alert dark:border-[#2c2c2c]">{error}</p>
        )}

        <div className="border-b border-brand-border-grey px-5 py-3 dark:border-[#2c2c2c]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-mid-grey" />
            <input
              type="search" value={query} onChange={e => setQuery(e.target.value)} autoFocus
              placeholder={t(account ? 'admin.jalla.searchProjects' : 'admin.jalla.search')}
              aria-label={t(account ? 'admin.jalla.searchProjects' : 'admin.jalla.search')}
              className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20 dark:border-[#2c2c2c] dark:bg-[#161616] dark:text-white"
            />
          </div>
        </div>

        {state === undefined ? (
          <p className="flex items-center gap-2 px-5 py-10 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>
        ) : state === null || !state.available ? (
          // Unreadable, which is not "no accounts".
          <p className="px-5 py-10 text-center text-xs text-brand-mid-grey">{t('admin.jalla.unavailable')}</p>
        ) : account === null ? (
          // ── Step one: who ──────────────────────────────────────────────────
          accounts.length === 0 ? (
            <p className="px-5 py-10 text-center text-xs text-brand-mid-grey">
              {state.rows.length === 0 ? t('admin.jalla.noAccounts') : t('admin.jalla.noMatch')}
            </p>
          ) : (
            <ul className="max-h-[46vh] divide-y divide-brand-border-grey overflow-y-auto dark:divide-[#2c2c2c]">
              {accounts.map(a => {
                const ok = canMessageAccount(a);
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => ok && setAccount(a)}
                      disabled={!ok}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors disabled:cursor-default',
                        ok ? 'hover:bg-brand-off-white dark:hover:bg-[#252525]' : 'opacity-60',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-near-black dark:text-white">
                          <User className="size-3 shrink-0 text-brand-mid-grey" aria-hidden />
                          {a.name || a.email || t('admin.jalla.ownerUnknown')}
                        </span>
                        {a.name && a.email && <span className="ml-[18px] block text-[11px] text-brand-mid-grey">{a.email}</span>}
                      </span>
                      {/* An account with nothing to message about says so rather than
                          vanishing from a list the admin is searching. */}
                      <span className="shrink-0 text-[11px] text-brand-mid-grey">
                        {ok ? t('admin.jalla.projectCount', { n: a.projects.length }) : t('admin.jalla.noProjectsForAccount')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          // ── Step two: which build ──────────────────────────────────────────
          projects.length === 0 ? (
            <p className="px-5 py-10 text-center text-xs text-brand-mid-grey">{t('admin.jalla.noMatch')}</p>
          ) : (
            <ul className="max-h-[46vh] divide-y divide-brand-border-grey overflow-y-auto dark:divide-[#2c2c2c]">
              {projects.map(p => {
                const ok = canMessage(p);
                const active = picked?.id === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => ok && setPicked(active ? null : p)}
                      disabled={!ok}
                      aria-pressed={active}
                      className={cn(
                        'w-full px-5 py-3 text-left transition-colors disabled:cursor-default',
                        active ? 'bg-brand-off-white dark:bg-[#252525]' : 'hover:bg-brand-off-white dark:hover:bg-[#252525]',
                        !ok && 'opacity-60',
                      )}
                    >
                      <p className="text-xs font-semibold text-brand-near-black dark:text-white">{p.name}</p>
                      <p className="mt-0.5 text-[11px] text-brand-mid-grey">
                        {!ok && <>{t('admin.jalla.noOwner')} · </>}
                        {p.city && <>{p.city} · </>}
                        {p.status && <>{t(`admin.workspace.header.status.${p.status}` as TKey)}</>}
                        {p.currentStage !== null && <> · {t('admin.ops.pipelineStage', { n: p.currentStage })}</>}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        )}

        {picked && (
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-brand-border-grey px-5 py-3 dark:border-[#2c2c2c]">
            <p className="min-w-0 text-[11px] text-brand-mid-grey">
              {t('admin.jalla.confirm', { project: picked.name, client: picked.ownerName || picked.ownerEmail || t('admin.jalla.ownerUnknown') })}
            </p>
            <button
              type="button" disabled={busy} onClick={() => start(picked)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-[#0a0a0a]"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <MessagesSquare className="size-3.5" />}
              {t('admin.jalla.start')}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
