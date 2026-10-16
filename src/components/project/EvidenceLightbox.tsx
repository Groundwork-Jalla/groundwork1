import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { signedUrlIn } from '@/lib/supabase/documents';
import { useT } from '@/lib/i18n';

/**
 * Evidence, viewed inside Groundwork.
 *
 * ── Why not a new tab ───────────────────────────────────────────────────────────────
 * Opening a signed URL in a tab hands the browser a bare file: Chrome renders a PDF in
 * its own viewer with a download button, and an image becomes a right-click away from
 * the desktop. It also puts the signed URL in the address bar, where it can be copied
 * and sent to anybody for the hour it lives. Reported as "clicking files currently
 * triggers downloads instead of in-app previews".
 *
 * ── What this can and cannot enforce ────────────────────────────────────────────────
 * It removes the easy paths out: no download control, no URL in the address bar, no
 * context menu, no dragging the image to the desktop, and the signed URL is minted when
 * the viewer opens rather than sitting in the page.
 *
 * It CANNOT stop a screenshot. Nothing a web page does can — the key is handled by the
 * operating system, long before any JavaScript runs, and a phone pointed at the monitor
 * defeats every version of this anyway. Treat the deterrents here as friction, not
 * protection, and do not promise a client that their photographs cannot leave.
 */

export interface EvidenceItem {
  /** Storage path inside the bucket. */
  path: string;
  label: string;
  bucket?: 'evidence' | 'documents';
}

const IMAGE = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v|ogg)$/i;

export function EvidenceLightbox({ items, index, onClose, onIndex }: {
  items: EvidenceItem[];
  index: number;
  onClose: () => void;
  onIndex: (next: number) => void;
}) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const touchX = useRef<number | null>(null);
  const item = items[index];

  const go = useCallback((delta: number) => {
    if (items.length < 2) return;
    // Wraps, so swiping past the end returns to the start rather than dead-ending.
    onIndex((index + delta + items.length) % items.length);
  }, [index, items.length, onIndex]);

  // One signed URL at a time: the file being looked at, minted when it is reached.
  useEffect(() => {
    let live = true;
    setUrl(null); setFailed(false);
    if (!item) return;
    void signedUrlIn(item.bucket ?? 'evidence', item.path)
      .then(u => { if (live) { if (u) setUrl(u); else setFailed(true); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [item?.path, item?.bucket]);

  // Keyboard: the arrows people already expect, and Escape to leave.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    }
    document.addEventListener('keydown', onKey);
    // The page behind must not scroll while a full-screen viewer is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [go, onClose]);

  if (!item) return null;
  const isVideo = VIDEO.test(item.path);
  const isImage = IMAGE.test(item.path);

  return (
    <div
      role="dialog" aria-modal="true" aria-label={item.label}
      className="fixed inset-0 z-[100] flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={onClose}
      // Swipe, because on a phone this is how everybody already moves through photos.
      onTouchStart={e => { touchX.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={e => {
        const start = touchX.current;
        touchX.current = null;
        if (start === null) return;
        const dx = (e.changedTouches[0]?.clientX ?? start) - start;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <span className="min-w-0 truncate text-sm">{item.label}</span>
        <span className="shrink-0 text-xs text-white/60 tabular-nums">
          {index + 1} / {items.length}
        </span>
        <button type="button" onClick={onClose} aria-label={t('common.close')}
          className="shrink-0 rounded-lg p-1.5 text-white/80 hover:bg-white/10 hover:text-white">
          <X className="size-5" />
        </button>
      </div>

      {/* Stop clicks on the content itself from closing the viewer. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6"
           onClick={e => e.stopPropagation()}>
        {items.length > 1 && (
          <button type="button" onClick={() => go(-1)} aria-label={t('project.evidence.previous')}
            className="absolute left-2 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70">
            <ChevronLeft className="size-5" />
          </button>
        )}

        {failed ? (
          <p role="alert" className="text-sm text-white/80">{t('project.evidence.cannotOpen')}</p>
        ) : !url ? (
          <Loader2 className="size-6 animate-spin text-white/70" />
        ) : isImage ? (
          <img
            src={url} alt={item.label}
            // The easy ways out, closed. Not protection — see the note at the top.
            onContextMenu={e => e.preventDefault()}
            onDragStart={e => e.preventDefault()}
            className="max-h-full max-w-full select-none object-contain"
          />
        ) : isVideo ? (
          <video
            src={url} controls autoPlay playsInline
            onContextMenu={e => e.preventDefault()}
            controlsList="nodownload noplaybackrate"
            disablePictureInPicture
            className="max-h-full max-w-full select-none"
          />
        ) : (
          // A PDF or document: rendered in a frame rather than handed to the browser's
          // own viewer, which comes with a download button attached.
          <iframe
            src={`${url}#toolbar=0&navpanes=0`}
            title={item.label}
            className="h-full w-full rounded-lg bg-white"
          />
        )}

        {items.length > 1 && (
          <button type="button" onClick={() => go(1)} aria-label={t('project.evidence.next')}
            className="absolute right-2 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70">
            <ChevronRight className="size-5" />
          </button>
        )}
      </div>
    </div>
  );
}
