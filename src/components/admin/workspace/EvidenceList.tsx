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
export function EvidenceList({ paths }: { paths: string[] }) {
  const t = useT();
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let alive = true;
    Promise.all(paths.slice(0, 12).map(async p => [p, await getSignedEvidenceUrl(p)] as const))
      .then(pairs => { if (alive) setUrls(Object.fromEntries(pairs)); })
      .catch(() => { /* every entry stays "unsigned" and renders as such */ });
    return () => { alive = false; };
  }, [paths]);

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
