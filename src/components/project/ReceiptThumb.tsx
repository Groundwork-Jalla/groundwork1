import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { signedUrlIn } from '@/lib/supabase/documents';
import { cn } from '@/lib/utils';

// =========================================================
// A receipt you can see before you open it (18 Nov).
//
// Favour: the contractor reading the payment history, and the homeowner, should see a
// small preview of each receipt, and a tap opens it large on the same page. The large
// view is the DocumentViewer the caller already owns; this is only the tile.
//
// A photograph is fetched resized by the storage image transform, falling back to the
// original where the add-on is off (the same rule as EvidenceThumbs). A PDF has no
// picture to fetch, so its first page is drawn small with pdf.js, once per receipt per
// page view, and only when the tile scrolls into sight: a long history is not a reason
// to download every PDF on the project.
// =========================================================

const IMAGE = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif)$/i;
const PDF = /\.pdf$/i;
const EDGE = 160;

const pdfPreviews = new Map<string, Promise<string | null>>();

async function drawFirstPage(path: string, edge: number): Promise<string | null> {
  const url = await signedUrlIn('evidence', path);
  if (!url) return null;
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const doc = await pdfjs.getDocument({ url }).promise;
  try {
    const page = await doc.getPage(1);
    const nominal = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (edge * 2) / Math.max(nominal.width, nominal.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }
}

/** One preview per receipt for the life of the page; a failure is remembered as "no preview". */
function pdfPreview(path: string, edge: number): Promise<string | null> {
  const key = `${edge}:${path}`;
  let preview = pdfPreviews.get(key);
  if (!preview) { preview = drawFirstPage(path, edge).catch(() => null); pdfPreviews.set(key, preview); }
  return preview;
}

export function ReceiptThumb({ path, label, onOpen, muted = false, className, size = 'sm' }: {
  path: string;
  /** What a screen reader hears, and the tooltip: "View receipt". */
  label: string;
  onOpen: () => void;
  /** A replaced receipt is shown, but quieter. */
  muted?: boolean;
  className?: string;
  /** `lg` fills its container: the receipt beside the contractor's "Did this payment arrive?" question. */
  size?: 'sm' | 'lg';
}) {
  const edge = size === 'lg' ? 480 : EDGE;
  const tile = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState<{ path: string; url: string } | null>(null);
  const [visible, setVisible] = useState(false);
  const image = IMAGE.test(path), pdf = PDF.test(path);

  useEffect(() => {
    if (visible || (!image && !pdf)) return;
    const node = tile.current;
    if (!node || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, image, pdf]);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    const load = image ? signedUrlIn('evidence', path, size === 'lg' ? { width: edge, height: Math.round(edge * 4 / 3) } : { width: edge, height: edge }) : pdf ? pdfPreview(path, edge) : Promise.resolve(null);
    void load.then(url => { if (live && url) setSrc({ path, url }); }, () => {});
    return () => { live = false; };
  }, [visible, path, image, pdf, size, edge]);

  const url = src?.path === path ? src.url : null;
  return (
    <button ref={tile} type="button" onClick={onOpen} title={label} aria-label={label} data-receipt-thumb={path}
      className={cn('group relative block shrink-0 overflow-hidden border', size === 'lg' ? 'aspect-[3/4] w-full rounded-xl bg-white' : 'size-12 rounded-lg md:size-14', 'border border-brand-border-grey bg-brand-off-white transition-colors hover:border-brand-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green dark:border-[#444] dark:bg-[#2c2c2c] dark:hover:border-white',
        muted && 'opacity-60', className)}>
      {url
        ? <img src={url} alt="" loading="lazy" draggable={false}
            onError={event => {
              // The transform add-on may be off: fall back to the original photograph.
              const element = event.currentTarget;
              if (!image || element.dataset.full) return;
              element.dataset.full = '1';
              void signedUrlIn('evidence', path).then(full => { if (full) element.src = full; });
            }}
            className={cn('size-full select-none', size === 'lg' ? 'object-contain' : 'object-cover', pdf && 'object-top')} />
        : <span className="flex size-full flex-col items-center justify-center gap-0.5 text-brand-mid-grey">
            <FileText className={size === 'lg' ? 'size-8' : 'size-4'} aria-hidden />
            {pdf && <span className="text-[9px] font-semibold uppercase tracking-wide">PDF</span>}
          </span>}
    </button>
  );
}
