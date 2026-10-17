// Barcode engine for serial numbers: ZXing (zxing-cpp compiled to WebAssembly). It is much stronger than the
// old JavaScript reader on small, dense Code 128 labels, and it reads camera frames and image files the same way.
import { readBarcodes } from "zxing-wasm/reader";

// All formats, tried hard, also rotated / mirrored / inverted, so a crooked or upside-down label still reads.
const OPTIONS = { tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 1 };

const pick = (results) => (results || []).find((r) => r?.text && r.isValid !== false)?.text || "";

/** Text of the first barcode in an ImageData, or "". */
export async function readImageData(imageData) {
  return pick(await readBarcodes(imageData, OPTIONS));
}

const MAX_SIDE = 4096;

function drawToCanvas(source, width, height, scale) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/** Current picture of a <video>, at most `maxWidth` wide (keeps every pixel the camera gives up to that). */
export async function readVideoFrame(video, scratch, maxWidth = 2560) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return "";
  const scale = Math.min(1, maxWidth / vw);
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);
  if (scratch.canvas.width !== w || scratch.canvas.height !== h) {
    scratch.canvas.width = w;
    scratch.canvas.height = h;
  }
  scratch.ctx.drawImage(video, 0, 0, w, h);
  return readImageData(scratch.ctx.getImageData(0, 0, w, h));
}

export function createFrameScratch() {
  const canvas = document.createElement("canvas");
  return { canvas, ctx: canvas.getContext("2d", { willReadFrequently: true }) };
}

/** Text of the first barcode in an image file (photo, screenshot, gallery picture), or "". */
export async function readImageFile(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const big = Math.max(bitmap.width, bitmap.height);
    // Full size first (capped), then a smaller and a bigger copy: some pictures only decode at another scale.
    const first = Math.min(1, MAX_SIDE / big);
    for (const scale of [first, first * 0.6, Math.min(2, MAX_SIDE / big) > first ? Math.min(2, MAX_SIDE / big) : 0]) {
      if (!scale) continue;
      const { canvas, ctx } = drawToCanvas(bitmap, bitmap.width, bitmap.height, scale);
      const text = await readImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (text) return text;
    }
    return "";
  } finally {
    bitmap.close?.();
  }
}
