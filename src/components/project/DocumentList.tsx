import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

/** The badge on a file row. It used to read "PDF" for every file, including a .xlsx. */
export function fileKind(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop() ?? '' : '';
  return (ext || 'FILE').slice(0, 4).toUpperCase();
}

export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white px-5 py-3 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h3 className="py-2 text-[10px] font-bold uppercase tracking-wider text-brand-mid-grey">{title}</h3>
      {children}
    </section>
  );
}

/**
 * One file in the list.
 *
 * 31 Oct 2026. `action` used to be a `<span>` — "Share" and "View" were styled text
 * with no click handler, no href, and no handler on the row either. Philip, twice:
 * "I can't view any of these documents here … nothing here is actually functional."
 * The look had been transcribed from the mockup and the behaviour had not.
 *
 * It is now a real button that opens the file. `onOpen` is optional because a row can
 * legitimately have nothing behind it yet — a stage with no certificate issued — and
 * in that case no control is drawn at all. A button that does nothing is worse than
 * no button: it is what made this tab look finished when it was not.
 */
export function FileRow({ id, kind, name, sub, when, action, state, onOpen, busy }: {
  id?: string;
  kind: string; name: string; sub: string; when: string;
  action?: string; state?: 'done' | 'open';
  onOpen?: () => void; busy?: boolean;
}) {
  const t = useT();
  return (
    <div id={id} className="flex items-center gap-3 border-t border-brand-border-grey py-3 dark:border-[#2c2c2c]">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-border-grey bg-brand-off-white font-mono text-[8px] font-semibold text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#141414]">
        {kind}
      </span>
      <span className="min-w-0 flex-1">
        {onOpen ? <button type="button" onClick={onOpen} disabled={busy} className="block max-w-full truncate text-left text-[13px] font-semibold text-brand-near-black underline-offset-4 hover:underline dark:text-white">{name}</button>
          : <span className="block truncate text-[13px] font-semibold text-brand-near-black dark:text-white">{name}</span>}
        <span className="block text-[11px] text-brand-mid-grey">{sub}</span>
      </span>
      {when && <span className="shrink-0 font-mono text-[11px] text-brand-mid-grey">{when}</span>}
      {state && (
        <span className={cn('flex shrink-0 items-center gap-1.5 text-[11px] font-semibold',
          state === 'done' ? 'text-state-complete' : 'text-state-held')}>
          <span aria-hidden className={cn('size-1.5 rounded-full',
            state === 'done' ? 'bg-state-complete' : 'bg-state-held')} />
          {t(state === 'done' ? 'contractorDocs.approved' : 'contractorDocs.open')}
        </span>
      )}
      {action && onOpen && (
        <button
          type="button" onClick={onOpen} disabled={busy}
          className="shrink-0 rounded-lg border border-brand-border-grey px-2.5 py-1.5 text-[11px] font-semibold text-brand-near-black transition-colors hover:border-brand-near-black disabled:opacity-50 dark:border-[#2c2c2c] dark:text-white dark:hover:border-white"
        >
          {busy ? t('common.loading') : action}
        </button>
      )}
    </div>
  );
}
