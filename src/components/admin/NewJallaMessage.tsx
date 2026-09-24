import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2, Search, X, MessagesSquare } from 'lucide-react';
import { listProjectsForJalla, type JallaProject } from '@/lib/supabase/jalla-projects';
import { matchesProject, canMessage, jallaHref } from '@/lib/admin/jalla-picker';
import { ensureProjectConversation } from '@/lib/supabase/conversations';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// Start a native Jalla conversation about a project (01 §3 COMMUNICATION).
//
// ── Only the project is chosen ───────────────────────────────────────────────────────
// The client is not a second field, because it is not a decision: `project_conversation()`
// (091) reads the owner off the project inside the database. Pairing a project with the
// wrong client is therefore impossible here rather than merely discouraged, and the
// client shown below is a display of that relationship, never an input to it.
//
// ── It does not create a second anything ─────────────────────────────────────────────
// `ensure_project_conversation` returns the project's existing Jalla thread when there is
// one, and takes an advisory lock before inserting when there is not. So "start" is the
// same call as "open", and pressing it twice cannot produce two threads. Nothing is sent
// from this modal: it hands the admin the real Inbox composer.
// =========================================================

export function NewJallaMessage({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();

  const [state, setState] = useState<{ rows: JallaProject[]; available: boolean } | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<JallaProject | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listProjectsForJalla()
      .then(r => { if (alive) setState(r); })
      .catch(() => { if (alive) setState(null); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const filtered = useMemo(
    () => (state?.rows ?? []).filter(p => matchesProject(p, query)),
    [state, query],
  );

  async function start(project: JallaProject) {
    setBusy(true); setError(null);
    try {
      // Reuse or create — one call, and the database decides which.
      const id = await ensureProjectConversation(project.id);
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
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('admin.jalla.newTitle')}</h2>
            <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.jalla.newSub')}</p>
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
              placeholder={t('admin.jalla.search')} aria-label={t('admin.jalla.search')}
              className="w-full rounded-xl border border-brand-border-grey bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20 dark:border-[#2c2c2c] dark:bg-[#161616] dark:text-white"
            />
          </div>
        </div>

        {state === undefined ? (
          <p className="flex items-center gap-2 px-5 py-10 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>
        ) : state === null || !state.available ? (
          // Unreadable, which is not "no projects".
          <p className="px-5 py-10 text-center text-xs text-brand-mid-grey">{t('admin.jalla.unavailable')}</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-xs text-brand-mid-grey">
            {state.rows.length === 0 ? t('admin.jalla.noProjects') : t('admin.jalla.noMatch')}
          </p>
        ) : (
          <ul className="max-h-[46vh] divide-y divide-brand-border-grey overflow-y-auto dark:divide-[#2c2c2c]">
            {filtered.map(p => {
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
                      {/* The client, read off the project — shown, never selected. */}
                      {ok ? (p.ownerName || p.ownerEmail || t('admin.jalla.ownerUnknown')) : t('admin.jalla.noOwner')}
                      {p.city && <> · {p.city}</>}
                      {p.status && <> · {t(`admin.workspace.header.status.${p.status}` as TKey)}</>}
                      {p.currentStage !== null && <> · {t('admin.ops.pipelineStage', { n: p.currentStage })}</>}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
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
