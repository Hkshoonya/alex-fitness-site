// Browser-side image preprocessing for admin uploads. Runs entirely in
// the admin's browser — the worker only ever sees the compressed result,
// never the raw multi-MB original.
//
// Used by every admin-managed image surface (coaches, studio photos,
// client success photos, transformations) so all media flows through
// one consistent compression + validation path.
//
// Output: data URL string, ready to POST as JSON.
//
// Defaults are tuned for ~150KB output from typical 5MB iPhone photos:
//   - max 800px on the longest side (more than enough for retina display
//     at typical card sizes; halved by the browser DPI scaling)
//   - JPEG quality 0.85 (visually lossless for photographs)
//
// Callers can override per-feature — e.g. coach headshots use 600px,
// studio cycling photos use 1200px (full-width display).

export interface CompressOptions {
  /** Max pixels on the longest edge. Default 800. */
  maxEdge?: number;
  /** JPEG quality 0..1. Default 0.85. */
  quality?: number;
  /** Output mime type. Default image/jpeg. */
  mimeType?: 'image/jpeg' | 'image/webp';
  /** Hard cap on output size in bytes. If exceeded, retries with lower
   *  quality. Default 500_000 (matches worker's MAX_COACH_PHOTO_BYTES). */
  maxBytes?: number;
}

export interface CompressResult {
  dataUrl: string;
  /** Final width in pixels (after resize). */
  width: number;
  /** Final height in pixels. */
  height: number;
  /** Output size in bytes (data URL length, including base64 overhead). */
  bytes: number;
  /** JPEG quality used (may be lower than requested if size capping kicked in). */
  qualityUsed: number;
}

/**
 * Read a File into a HTMLImageElement that can be drawn onto a canvas.
 * Throws on invalid file or unsupported type.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error(`Not an image file (got "${file.type}"). Use JPG, PNG, or WebP.`));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image — file may be corrupted.'));
    };
    img.src = url;
  });
}

/**
 * Compress an image File to a base64 data URL.
 *
 * Behavior:
 *   - Resizes so the longest edge is ≤ maxEdge (preserves aspect ratio)
 *   - Encodes as JPEG at the requested quality
 *   - If output exceeds maxBytes, retries with lower quality (down to 0.5)
 *   - Throws if it can't fit even at min quality
 *
 * Why a single function (not a class): every admin form needs one
 * compress→preview→upload step. Keeping this stateless avoids leaking
 * canvas references across tabs.
 */
export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<CompressResult> {
  const {
    maxEdge = 800,
    quality = 0.85,
    mimeType = 'image/jpeg',
    maxBytes = 500_000,
  } = options;

  const img = await loadImage(file);

  // Compute target dimensions. Don't upscale — if image is already smaller
  // than maxEdge, keep its native size (avoids blur from synthetic upscale).
  const longestSrc = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longestSrc > maxEdge ? maxEdge / longestSrc : 1;
  const targetW = Math.round(img.naturalWidth * scale);
  const targetH = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable in this browser.');
  // imageSmoothingQuality 'high' uses bicubic on most engines — important
  // when scaling down a 4000px DSLR raw to 800px.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetW, targetH);

  // Try the requested quality first. If output is too big, ratchet down.
  // We never go below 0.5 — beyond that the artifacts become visible.
  const QUALITY_FLOOR = 0.5;
  const QUALITY_STEP = 0.1;
  let q = quality;
  let dataUrl = canvas.toDataURL(mimeType, q);
  while (dataUrl.length > maxBytes && q > QUALITY_FLOOR) {
    q = Math.max(QUALITY_FLOOR, q - QUALITY_STEP);
    dataUrl = canvas.toDataURL(mimeType, q);
  }
  if (dataUrl.length > maxBytes) {
    throw new Error(
      `Image too large even at minimum quality (${Math.round(dataUrl.length / 1024)}KB). ` +
      `Try a smaller source image or crop before upload.`,
    );
  }

  return {
    dataUrl,
    width: targetW,
    height: targetH,
    bytes: dataUrl.length,
    qualityUsed: q,
  };
}
