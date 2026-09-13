import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Search, FolderOpen, UserRound, Loader2 } from 'lucide-react';
import { searchAdmin, type SearchHit, type SearchResults } from '@/lib/supabase/admin-search';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// The admin top bar's search.
//
// It exists because the alternative was a decorative input: a search box that accepts
// typing and does nothing is the same lie as a fabricated number, and it is a worse one
// because the admin will trust it and conclude a record is missing.
//
// Scope is two record types (projects, people) and one behaviour: every result is a real
// row, and selecting it lands on the module that holds it, already narrowed to it.
// =========================================================

const EMPTY: SearchResults = { projects: [], people: [], partial: false };

export function AdminSearch() {
  const t = useT();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResults>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const hits: SearchHit[] = [...res.projects, ...res.people];

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRes(EMPTY); setBusy(false); return; }
    setBusy(true);
    // Debounced: one request per pause in typing, not one per keystroke.
    const id = setTimeout(() => {
      let alive = true;
      searchAdmin(term)
        .then(r => { if (alive) { setRes(r); setCursor(0); } })
        .catch(() => { if (alive) setRes({ ...EMPTY, partial: true }); })
        .finally(() => { if (alive) setBusy(false); });
      return () => { alive = false; };
    }, 220);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    function away(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  function go(hit: SearchHit) {
    setOpen(false);
    setQ('');
    setRes(EMPTY);
    navigate(hit.to);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => (c + 1) % hits.length); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => (c - 1 + hits.length) % hits.length); }
    if (e.key === 'Enter')     { e.preventDefault(); go(hits[cursor] ?? hits[0]); }
  }

  const showPanel = open && q.trim().length >= 2;

  return (
    <div ref={box} className="relative hidden min-w-0 flex-1 md:block md:max-w-xs lg:max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#9a9a96]" />
      <input
        type="search"
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={t('admin.search.placeholder')}
        aria-label={t('admin.search.label')}
        className={cn(
          'w-full rounded-xl border py-1.5 pl-9 pr-3 text-xs outline-none transition-colors',
          'border-[#e4e3df] bg-[#f7f7f5] text-[#0a0a0a] placeholder:text-[#9a9a96] focus:border-[#0a0a0a]',
          'dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white dark:placeholder:text-white/40 dark:focus:border-white/40',
        )}
      />
      {busy && <Loader2 className="absolute right-3 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-[#9a9a96]" />}

      {showPanel && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-[#e4e3df] bg-white shadow-lg dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
        >
          {hits.length === 0 ? (
            <p className="px-3 py-3 text-[11px] text-[#5a5a57] dark:text-white/55">
              {busy ? t('common.loading') : t('admin.search.none', { q: q.trim() })}
            </p>
          ) : (
            <>
              <Group labelKey="admin.search.projects" hits={res.projects} all={hits} cursor={cursor} onPick={go} />
              <Group labelKey="admin.search.people"   hits={res.people}   all={hits} cursor={cursor} onPick={go} />
            </>
          )}
          {res.partial && (
            <p className="border-t border-[#e4e3df] px-3 py-2 text-[10px] text-[#5a5a57] dark:border-[#2c2c2c] dark:text-white/55">
              {t('admin.search.partial')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ labelKey, hits, all, cursor, onPick }: {
  labelKey: 'admin.search.projects' | 'admin.search.people';
  hits: SearchHit[];
  all: SearchHit[];
  cursor: number;
  onPick: (h: SearchHit) => void;
}) {
  const t = useT();
  if (hits.length === 0) return null;
  return (
    <>
      <p className="border-b border-[#e4e3df] px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a9a96] dark:border-[#2c2c2c] dark:text-white/40">
        {t(labelKey)}
      </p>
      <ul>
        {hits.map(h => {
          const active = all[cursor]?.kind === h.kind && all[cursor]?.id === h.id;
          const Icon = h.kind === 'project' ? FolderOpen : UserRound;
          return (
            <li key={`${h.kind}:${h.id}`}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => onPick(h)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                  active ? 'bg-[#f7f7f5] dark:bg-[#252525]' : 'hover:bg-[#f7f7f5] dark:hover:bg-[#252525]',
                )}
              >
                <Icon className="size-3.5 shrink-0 text-[#9a9a96]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-[#0a0a0a] dark:text-white">{h.title}</span>
                  {h.detail && <span className="block truncate text-[10px] text-[#5a5a57] dark:text-white/55">{h.detail}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
