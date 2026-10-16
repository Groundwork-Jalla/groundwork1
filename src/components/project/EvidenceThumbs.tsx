import { useEffect, useState } from 'react';
import { FileText, Play } from 'lucide-react';
import { signedUrlIn } from '@/lib/supabase/documents';
import { EvidenceLightbox, type EvidenceItem } from '@/components/project/EvidenceLightbox';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Evidence as tiles you can actually see.
 *
 * ── Why not "Photo 1 · File 2 · Photo 3" ────────────────────────────────────────────
 * Those labels carried no information. Nobody is looking for "photo 4" — they are
 * looking for the one with the rebar in it, and a row of identical grey pills makes you
 * open all seven to find it. A thumbnail answers the question without a click.
 *
 * ── The cost, taken deliberately ────────────────────────────────────────────────────
 * A thumbnail needs its URL up front, so this signs every file on the substage when it
 * renders rather than one on click. That is a real change: seven photographs is seven
 * hour-long signed URLs instead of one. It is the price of being able to see them, and
 * the set is small and bounded — the files of one substage, not a project.
 *
 * Supabase's image transform is asked for first so the browser fetches a thumbnail
 * rather than a 5 MB photograph over a phone connection; where the add-on is not
 * enabled the URL fails and `onError` falls back to the original.
 */

const IMAGE = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v|ogg)$/i;

export function EvidenceThumbs({ paths, bucket = 'evidence', className }: {
  paths: string[];
  bucket?: 'evidence' | 'documents';
  className?: string;
}) {
  const t = useT();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [at, setAt] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    const images = paths.filter(p => IMAGE.test(p));
    if (images.length === 0) return;
    void Promise.all(images.map(async p => {
      const small = await signedUrlIn(bucket, p, { width: 160, height: 160 });
      return [p, small ?? ''] as const;
    })).then(pairs => {
      if (!live) return;
      setUrls(Object.fromEntries(pairs.filter(([, u]) => u)));
    });
    return () => { live = false; };
  }, [paths.join('|'), bucket]);

  if (paths.length === 0) return null;

  const items: EvidenceItem[] = paths.map(p => ({
    path: p, bucket,
    // The file's own name, with the upload timestamp prefix dropped — what the person
    // who took the photograph called it, not an index we invented.
    label: (p.split('/').pop() ?? p).replace(/^\d+_/, ''),
  }));

  return (
    <>
      <div className={cn('mt-2 flex flex-wrap gap-1.5', className)}>
        {paths.map((p, i) => {
          const isImage = IMAGE.test(p);
          const isVideo = VIDEO.test(p);
          const src = urls[p];
          return (
            <button
              key={p}
              type="button"
              onClick={() => setAt(i)}
              title={items[i].label}
              aria-label={t('project.stages.openEvidence', { name: items[i].label })}
              className="group relative size-16 shrink-0 overflow-hidden rounded-lg border border-brand-border-grey bg-brand-off-white transition-colors hover:border-brand-near-black dark:border-[#444] dark:bg-[#2c2c2c] dark:hover:border-white"
            >
              {isImage && src ? (
                <img
                  src={src} alt={items[i].label} loading="lazy"
                  onContextMenu={e => e.preventDefault()}
                  onDragStart={e => e.preventDefault()}
                  // The transform add-on may not be on; fall back to the original file.
                  onError={e => {
                    const el = e.currentTarget;
                    if (el.dataset.full) return;
                    el.dataset.full = '1';
                    void signedUrlIn(bucket, p).then(u => { if (u) el.src = u; });
                  }}
                  className="size-full select-none object-cover"
                />
              ) : (
                // A video has no cheap poster frame, and a document has no image at all:
                // both get a plain tile that says which it is.
                <span className="flex size-full items-center justify-center text-brand-mid-grey">
                  {isVideo ? <Play className="size-5" /> : <FileText className="size-5" />}
                </span>
              )}
              {isVideo && src === undefined && (
                <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[9px] font-semibold text-white">
                  {t('project.evidence.video')}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {at !== null && (
        <EvidenceLightbox items={items} index={at} onIndex={setAt} onClose={() => setAt(null)} />
      )}
    </>
  );
}
