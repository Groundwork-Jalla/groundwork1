import { useEffect, useState } from 'react';
import { FileImage } from 'lucide-react';
import { getSignedEvidenceUrl } from '@/lib/supabase/approvals';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Evidence files, each opened through a signed URL fetched on demand. A path that cannot
 * be signed (a deleted object, a bucket policy still missing) is listed and marked, not
 * hidden — the record says a file was there.
 */
const IMAGE = /\.(jpe?g|png|webp|gif|heic|avif)$/i;

/**
 * `thumbnails` (Site updates, 18 Nov redesign): the photos themselves, large, each opening
 * full size in a new tab. Anything that is not an image keeps its file tile. Without it the
 * list is the compact row of icons the stage panels use.
 */
export function EvidenceList({ paths, thumbnails = false }: { paths: string[]; thumbnails?: boolean }) {
  const t = useT();
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let alive = true;
    Promise.all(paths.slice(0, 12).map(async p => [p, await getSignedEvidenceUrl(p)] as const))
      .then(pairs => { if (alive) setUrls(Object.fromEntries(pairs)); })
      .catch(() => { /* every entry stays "unsigned" and renders as such */ });
    return () => { alive = false; };
  }, [paths]);

  if (thumbnails) {
    return (
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {paths.slice(0, 12).map((p, i) => {
          const url = urls[p];
          const label = t('admin.workspace.stage.evidenceOpen', { n: i + 1 });
          const tile = 'relative block aspect-[4/3] overflow-hidden rounded-xl border border-brand-border-grey bg-brand-light-grey dark:border-[#2c2c2c]';
          return (
            <li key={p}>
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" title={label} aria-label={label}
                  className={cn(tile, 'transition-opacity hover:opacity-90')}>
                  {IMAGE.test(p)
                    ? <img src={url} alt="" loading="lazy" className="size-full object-cover" />
                    : <span className="grid size-full place-items-center text-brand-mid-grey"><FileImage className="size-6" /></span>}
                  <FileImage aria-hidden className="absolute bottom-2 left-2 size-3.5 text-white drop-shadow" />
                </a>
              ) : (
                // Marked, never dropped: the record says a file was here.
                <span title={p} className={cn(tile, 'opacity-50', 'grid place-items-center border-dashed text-center text-xs text-brand-mid-grey')}>
                  <span><FileImage className="mx-auto mb-1.5 size-4" />{t('admin.workspace.ui.couldNotOpen')}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div>
      <p className="text-xs text-brand-near-black dark:text-white">{t('admin.workspace.stage.evidenceCount', { n: paths.length })}</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {paths.slice(0, 12).map((p, i) => {
          const url = urls[p];
          const label = t('admin.workspace.stage.evidenceOpen', { n: i + 1 });
          const cls = 'inline-flex size-8 items-center justify-center rounded-lg border border-brand-border-grey text-brand-mid-grey dark:border-[#2c2c2c]';
          return (
            <li key={p}>
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" title={label} aria-label={label}
                  className={cn(cls, 'transition-colors hover:border-brand-near-black hover:text-brand-near-black dark:hover:border-white dark:hover:text-white')}>
                  <FileImage className="size-3.5" />
                </a>
              ) : (
                <span title={p} className={cn(cls, 'opacity-50')}><FileImage className="size-3.5" /></span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
