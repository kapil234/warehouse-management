import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HTMLCanvasElementLuminanceSource,
  HybridBinarizer,
  MultiFormatReader,
} from "@zxing/library";

/**
 * Camera barcode engine - reads EVERY common barcode type (1D + 2D).
 *
 * Why the old reader missed dense labels (UPC-A, Code 128 ...): it looked at one downscaled frame with one
 * method. A dedicated Bluetooth scanner has a laser/imager and its own decoder, a camera does not. So this
 * engine gives the camera the best chance on every tick:
 *   1. the browser's NATIVE BarcodeDetector (Chrome / Edge / Android) on the full-resolution video frame
 *   2. ZXing with TRY_HARDER, on several views of the same frame: full frame, centre band, centre crop and
 *      rotated 90 degrees (vertical barcodes), with two different binarizers (+ inverted colours now and then)
 *   3. HD camera stream (up to 4K), continuous focus
 * and a "Photo" fallback (decodeImageFile) that decodes a picture taken with the phone's own camera app.
 */

const ZX_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.CODABAR,
  BarcodeFormat.ITF,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.RSS_14,
  BarcodeFormat.RSS_EXPANDED,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.AZTEC,
  BarcodeFormat.PDF_417,
  BarcodeFormat.MAXICODE,
];

const HINTS = new Map();
HINTS.set(DecodeHintType.POSSIBLE_FORMATS, ZX_FORMATS);
HINTS.set(DecodeHintType.TRY_HARDER, true);

const zxingReader = new MultiFormatReader();

// ---------- helpers ----------

const makeCanvas = (w, h) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas;
};

/** Copies a region (sx, sy, sw, sh) of an image / video into a new canvas of max side `maxSide`, optionally rotated 90 deg. */
function cropToCanvas(src, sx, sy, sw, sh, { maxSide = 1800, rotate = false } = {}) {
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);
  const canvas = rotate ? makeCanvas(h, w) : makeCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (rotate) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
  } else {
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  }
  return canvas;
}

/** ZXing on one canvas: two binarizers, optionally also inverted. Returns text or null. */
function decodeCanvas(canvas, tryInverted = false) {
  const source = new HTMLCanvasElementLuminanceSource(canvas);
  const variants = [() => new HybridBinarizer(source), () => new GlobalHistogramBinarizer(source)];
  if (tryInverted) {
    const inverted = source.invert();
    variants.push(() => new HybridBinarizer(inverted), () => new GlobalHistogramBinarizer(inverted));
  }
  for (const make of variants) {
    try {
      const result = zxingReader.decode(new BinaryBitmap(make()), HINTS);
      const text = result?.getText?.();
      if (text) return text;
    } catch { /* NotFoundException = nothing here, try the next variant */ }
  }
  return null;
}

// Views tried on every image: [x, y, w, h as fractions of the picture, rotate]
const VIEWS = [
  { x: 0, y: 0, w: 1, h: 1, rotate: false }, // whole picture
  { x: 0, y: 0.3, w: 1, h: 0.4, rotate: false }, // centre band (where the scan frame is)
  { x: 0, y: 0, w: 1, h: 1, rotate: true }, // whole picture, vertical barcode
  { x: 0.15, y: 0.25, w: 0.7, h: 0.5, rotate: false }, // centre crop, larger bars
  { x: 0.25, y: 0, w: 0.5, h: 1, rotate: true }, // centre column, vertical barcode
];

function decodeView(src, width, height, view, opts = {}) {
  const canvas = cropToCanvas(src, width * view.x, height * view.y, width * view.w, height * view.h, { rotate: view.rotate, ...opts });
  return decodeCanvas(canvas, opts.inverted);
}

// ---------- native BarcodeDetector ----------

let detectorPromise = null;
function getNativeDetector() {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    try {
      if (!("BarcodeDetector" in window)) return null;
      const supported = await window.BarcodeDetector.getSupportedFormats();
      return supported.length ? new window.BarcodeDetector({ formats: supported }) : new window.BarcodeDetector();
    } catch {
      return null;
    }
  })();
  return detectorPromise;
}

async function nativeDecode(src) {
  const detector = await getNativeDetector();
  if (!detector) return null;
  try {
    const codes = await detector.detect(src);
    return codes?.find((c) => c.rawValue)?.rawValue || null;
  } catch {
    return null;
  }
}

// ---------- live camera ----------

const CAMERA_ATTEMPTS = [
  { video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } } },
  { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
  { video: { facingMode: "environment" } },
  { video: true },
];

/**
 * Opens the camera inside `container` and keeps decoding until stop() is called.
 * Resolves { stop, track }. Rejects with the camera error (NotAllowedError etc.).
 */
export async function startScanner({ container, onDecoded }) {
  let stream = null;
  let lastError = null;
  for (const constraints of CAMERA_ATTEMPTS) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      break;
    } catch (err) {
      lastError = err;
      if (/NotAllowed|Permission|Security/i.test(err?.name || String(err))) break;
    }
  }
  if (!stream) throw lastError || new Error("Camera could not be opened");

  const video = document.createElement("video");
  video.setAttribute("playsinline", "true");
  video.muted = true;
  video.autoplay = true;
  video.style.cssText = "width:100%;height:100%;object-fit:cover;";
  video.srcObject = stream;
  container.appendChild(video);
  await video.play().catch(() => {});

  const track = stream.getVideoTracks()[0];
  let stopped = false;
  let tick = 0;
  let timer = null;

  const loop = async () => {
    if (stopped) return;
    try {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h && video.readyState >= 2) {
        // 1) native detector (fast, full resolution)
        let text = await nativeDecode(video);
        // 2) ZXing, one view per tick so the phone stays responsive
        if (!text && !stopped) {
          const view = VIEWS[tick % VIEWS.length];
          text = decodeView(video, w, h, view, { inverted: tick % 7 === 6 });
        }
        if (text && !stopped) onDecoded(text);
        tick += 1;
      }
    } catch { /* a bad frame is skipped */ }
    if (!stopped) timer = setTimeout(loop, 60);
  };
  timer = setTimeout(loop, 300);

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    video.remove();
  };

  return { stop, track };
}

// ---------- photo (still picture) ----------

/**
 * Decodes a barcode from a picture file (e.g. taken with the phone's own camera app, which has autofocus
 * and full resolution). Tries the native detector, then ZXing on several views and sizes. Returns text or null.
 */
export async function decodeImageFile(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const native = await nativeDecode(bitmap);
    if (native) return native;
    const { width, height } = bitmap;
    for (const maxSide of [2400, 1400, 900]) {
      for (const view of VIEWS) {
        const text = decodeView(bitmap, width, height, view, { maxSide });
        if (text) return text;
      }
    }
    for (const view of VIEWS) {
      const text = decodeView(bitmap, width, height, view, { maxSide: 1800, inverted: true });
      if (text) return text;
    }
    return null;
  } finally {
    bitmap.close?.();
  }
}
