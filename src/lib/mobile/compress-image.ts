/**
 * Client-side image compression for site photos and payment receipts on slow
 * mobile networks (3G/4G in Cameroon).
 *
 * Safety guarantees:
 * - Never touches PDFs, SVGs, GIFs, or files already below `minBytes`.
 * - Always falls back cleanly to the original `File` if Canvas decoding fails
 *   or if the compressed output is not smaller than the original.
 */

export interface CompressOptions {
  /** Max width or height in pixels. Default 1600 keeps receipts & rebar photos sharp. */
  maxDimension?: number;
  /** JPEG quality (0–1). Default 0.82 balances text sharpness and small payload (~250KB). */
  quality?: number;
  /** Skip files already smaller than this byte threshold. Default 350 KB. */
  minBytes?: number;
}

const COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

export async function compressImageForUpload(
  file: File,
  options: CompressOptions = {},
): Promise<File> {
  const maxDimension = options.maxDimension ?? 1600;
  const quality = options.quality ?? 0.82;
  const minBytes = options.minBytes ?? 350_000;

  if (!file || !COMPRESSIBLE_TYPES.has(file.type.toLowerCase()) || file.size <= minBytes) {
    return file;
  }
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Image === 'undefined') {
    return file;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image_decode_failed'));
      el.src = objectUrl;
    });

    const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    // White background prevents transparent PNGs from turning black in JPEG encoding.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;

    const nextName = file.name.replace(/\.(png|webp|jpeg|jpg)$/i, '') + '.jpg';
    return new File([blob], nextName, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
