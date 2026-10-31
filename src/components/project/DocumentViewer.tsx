import { useEffect } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { useT } from '@/lib/i18n';

// =========================================================
// Open a document without leaving the project.
//
// Favour, 31 Oct 2026: "it should not open the file in a new tab, it should open in
// same browser more like a pop up." A new tab costs the reader their place — they were
// on a stage, looking at one file among several, and coming back means finding the
// project, the tab and the scroll position again. On a phone it is worse: a new tab is
// a different app screen.
//
// ── What can and cannot be shown ────────────────────────────────────────────────────
// PDFs and images render here. A spreadsheet or a Word file cannot be drawn by a
// browser, so for those this says so plainly and offers the download rather than
// showing an empty grey frame, which is what an <iframe> of an .xlsx looks like.
//
// ── Why the URL is passed in ────────────────────────────────────────────────────────
// Signing is the caller's job: project documents need a signed Storage URL that expires
// and certificates live in a public bucket. This component is given a URL and a name
// and does not know or care which it got.
// =========================================================

export type ViewerKind = 'pdf' | 'image' | 'other';

/** What a browser can draw, decided from the file name rather than a stored MIME type,
 *  because `mime_type` is null on plenty of older rows. */
export function viewerKindFor(fileName: string): ViewerKind {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'].includes(ext)) return 'image';
  return 'other';
}

export function DocumentViewer({ name, url, loading, onClose }: {
  name: string;
  /** Null while the signed URL is still being fetched. */
  url: string | null;
  loading?: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const kind = viewerKindFor(name);

  // Escape closes it, and the page behind does not scroll while it is open — a modal
  // whose backdrop scrolls reads as a broken overlay rather than a window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-6"
      role="dialog" aria-modal="true" aria-label={name}
      // Only a click on the backdrop itself, never one that bubbled up from the file.
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden bg-white shadow-xl dark:bg-[#1e1e1e] sm:h-[92vh] sm:rounded-2xl">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-brand-border-grey px-5 py-3.5 dark:border-[#2c2c2c]">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-near-black dark:text-white">
            {name}
          </h2>
          {url && (
            // A download beside the view, because a contractor on site often wants the
            // file itself rather than a look at it.
            <a
              href={url} download={name} target="_blank" rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-border-grey px-2.5 py-1.5 text-[11px] font-semibold text-brand-near-black dark:border-[#2c2c2c] dark:text-white"
            >
              <Download className="size-3.5" aria-hidden />{t('contractorDocs.download')}
            </a>
          )}
          <button
            type="button" onClick={onClose} aria-label={t('common.close')}
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-brand-mid-grey hover:bg-brand-off-white dark:hover:bg-[#2c2c2c]"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-brand-off-white dark:bg-[#111]">
          {loading || !url ? (
            <p className="flex items-center gap-2 text-sm text-brand-mid-grey">
              <Loader2 className="size-4 animate-spin" aria-hidden />{t('common.loading')}
            </p>
          ) : kind === 'pdf' ? (
            <iframe src={url} title={name} className="h-full w-full border-0" />
          ) : kind === 'image' ? (
            <img src={url} alt={name} className="max-h-full max-w-full object-contain" />
          ) : (
            // Neither a PDF nor an image. Saying so beats an empty frame.
            <div className="px-6 py-10 text-center">
              <p className="text-sm font-medium text-brand-near-black dark:text-white">
                {t('contractorDocs.cannotPreview')}
              </p>
              <a
                href={url} download={name} target="_blank" rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-near-black px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-brand-near-black"
              >
                <Download className="size-4" aria-hidden />{t('contractorDocs.download')}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
