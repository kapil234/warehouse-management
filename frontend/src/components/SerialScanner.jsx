import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, ImageUp, Plus, X, Zap, ZapOff } from "lucide-react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { toast } from "react-toastify";
import { cleanSerialInput, countFilled, serialKey, needsSerials } from "../features/outward/serialHelpers";

/**
 * Serial numbers inside the Item details table.
 *
 * Every Pcs item row has ONE input (SR.NO + Scan button): type the serial no. and press Enter / Add, or tap the camera
 * icon to scan, or scan with a connected Bluetooth / USB / Wi-Fi scanner (it "types" the code + Enter,
 * so nothing has to be set up). Each serial that is entered or scanned is listed (no numbering) in a row under that item.
 * An item of 4 Pcs needs 4 serial numbers; when they are all added the input is replaced by a tick.
 *
 * const serial = useSerialScanner({ items, lines, values, onChange });
 *   serial.inputCell(item, rowIndex)      -> SR.NO input + Scan button (cell on the item's row)
 *   serial.listRow(item, rowIndex, cols)  -> <tr> under the item listing its serial numbers
 *   serial.badge                 -> "Serial no. x / y" badge for the table heading
 *   serial.camera                -> camera pop-up, render once in the page
 */

const READER_ID = "serial-camera-reader";
const FILE_READER_ID = "serial-file-reader";

// Product labels carry dense 1D barcodes (Code 128). Telling the reader which formats to look for makes it
// faster and far more reliable than trying every format on every frame.
const FORMATS = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
];
const READER_OPTIONS = { formatsToSupport: FORMATS, useBarCodeDetectorIfSupported: true, verbose: false };

// The scan box is the part of the picture that is read. A long barcode needs a WIDE box (almost the full width of the
// camera view); the old fixed 300 px box cut a long barcode in half, so it could never be read.
const qrbox = (viewW, viewH) => ({
  width: Math.max(150, Math.floor(viewW * 0.94)),
  height: Math.max(80, Math.min(180, Math.floor(viewH * 0.5))),
});

const cameraErrorMessage = (err) => {
  const name = err?.name || String(err || "");
  if (!window.isSecureContext) return "Camera needs a secure (https) page. Open the site with https, or type / use a scanner instead.";
  if (/NotAllowed|Permission/i.test(name)) return "Camera permission is blocked. Allow camera access for this site in the browser settings, then tap Scan again.";
  if (/NotFound|DevicesNotFound/i.test(name)) return "No camera found on this device.";
  if (/NotReadable|TrackStart|AbortError/i.test(name)) return "Camera is busy in another app / tab. Close it and try again.";
  return "Camera could not be opened. Allow camera access, or type / use a scanner instead.";
};
const SCAN_MAX_GAP_MS = 35; // a scanner types far faster than a person
const SCAN_MIN_LENGTH = 4;

const isTypingTarget = (el) => {
  const tag = el?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable;
};

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      osc.frequency.value = 880;
      osc.connect(ctx.destination);
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 90);
    }
  } catch { /* sound is optional */ }
  navigator.vibrate?.(60);
}

const SOURCE_LABEL = { CAMERA: "camera", SCANNER: "scanner", MANUAL: "typed" };

export default function useSerialScanner({ items = [], lines = [], values = {}, onChange, disabled = false }) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lastScan, setLastScan] = useState("");
  const [drafts, setDrafts] = useState({}); // rowIndex -> text in the input
  const [camTools, setCamTools] = useState({ torch: false, torchOn: false, zoom: null, zoomValue: 1 });

  const inputRefs = useRef({}); // rowIndex -> input element
  const keyStats = useRef({ start: 0, last: 0, count: 0 });
  const lastDecoded = useRef({ text: "", at: 0 });
  const activeRow = useRef(0);
  const trackRef = useRef(null);

  // Rows that need serials: where their serials sit inside the line's slots (rows with the same SKU share one line).
  const rows = useMemo(() => {
    const used = {};
    return items.map((item) => {
      if (!needsSerials(item)) return null;
      const key = serialKey(item.category, item.sku);
      const quantity = Number(item.quantity) || 0;
      const offset = used[key] || 0;
      used[key] = offset + quantity;
      return { key, offset, quantity };
    });
  }, [items]);

  const live = useRef({});
  live.current = { lines, values, onChange, rows };

  const total = lines.reduce((n, l) => n + l.quantity, 0);
  const filled = lines.reduce((n, l) => n + countFilled(values, l.key), 0);
  const allDone = total > 0 && filled === total;

  const rowSlots = (row, vals = values) => (vals[row.key] || []).slice(row.offset, row.offset + row.quantity);
  const rowFilled = (row, vals = values) => rowSlots(row, vals).filter((s) => cleanSerialInput(s.serialNo)).length;

  /**
   * Adds a serial no. to the first empty place. Starts at `startRow` (the item the person is working
   * on), goes on to the next items when that one is full - unless `onlyRow` is set (typed into one item).
   */
  const addSerial = (raw, source, startRow = activeRow.current, onlyRow = false) => {
    const { lines: L, values: V, onChange: change, rows: R } = live.current;
    const serialNo = cleanSerialInput(raw);
    if (!serialNo) return false;
    const exists = L.some((l) => (V[l.key] || []).some((s) => cleanSerialInput(s.serialNo).toLowerCase() === serialNo.toLowerCase()));
    if (exists) {
      toast.warn(`${serialNo} is already entered.`);
      return false;
    }
    const valid = R.map((r, i) => (r ? i : -1)).filter((i) => i !== -1);
    if (!valid.length) return false;
    const at = Math.max(0, valid.indexOf(valid.includes(startRow) ? startRow : valid[0]));
    const order = onlyRow ? [startRow] : [...valid.slice(at), ...valid.slice(0, at)];
    for (const i of order) {
      const row = R[i];
      if (!row) continue;
      const slots = [...(V[row.key] || [])];
      const idx = slots.slice(row.offset, row.offset + row.quantity).findIndex((s) => !cleanSerialInput(s.serialNo));
      if (idx === -1) continue;
      slots[row.offset + idx] = { serialNo, source };
      change({ ...V, [row.key]: slots });
      activeRow.current = i;
      setLastScan(serialNo);
      return true;
    }
    toast.info(onlyRow ? "All serial numbers of this item are already added." : "All serial numbers are already added.");
    return false;
  };
  const addSerialRef = useRef(addSerial);
  addSerialRef.current = addSerial;

  const removeSerial = (row, i) => {
    const slots = [...(values[row.key] || [])];
    slots[row.offset + i] = { serialNo: "", source: "MANUAL" };
    // keep the filled ones at the front of this item so new entries fill the gap
    const mine = slots.slice(row.offset, row.offset + row.quantity).filter((s) => cleanSerialInput(s.serialNo));
    for (let k = 0; k < row.quantity; k += 1) slots[row.offset + k] = mine[k] || { serialNo: "", source: "MANUAL" };
    onChange({ ...values, [row.key]: slots });
  };

  const focusInput = (rowIndex) => setTimeout(() => inputRefs.current[rowIndex]?.focus(), 0);

  const submitDraft = (rowIndex, source) => {
    const text = drafts[rowIndex] || "";
    if (!cleanSerialInput(text)) return;
    if (addSerial(text, source, rowIndex, true)) setDrafts((d) => ({ ...d, [rowIndex]: "" }));
    focusInput(rowIndex);
  };

  const handleKeyDown = (e, rowIndex) => {
    if (e.key === "Enter") {
      e.preventDefault(); // Enter (also sent by scanners) must never submit the form
      const { start, last, count } = keyStats.current;
      const gap = count > 1 ? (last - start) / (count - 1) : Infinity;
      keyStats.current = { start: 0, last: 0, count: 0 };
      submitDraft(rowIndex, count >= SCAN_MIN_LENGTH && gap <= SCAN_MAX_GAP_MS ? "SCANNER" : "MANUAL");
      return;
    }
    if (e.key.length === 1) {
      const now = Date.now();
      const s = keyStats.current;
      keyStats.current = now - s.last > 100 ? { start: now, last: now, count: 1 } : { start: s.start, last: now, count: s.count + 1 };
    }
  };

  // Hardware scanner with nothing focused: catch the fast keystroke burst that ends with Enter.
  useEffect(() => {
    if (disabled || !lines.length) return undefined;
    let buffer = "";
    let start = 0;
    let last = 0;
    const onKeyDown = (e) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const now = Date.now();
      if (e.key === "Enter") {
        const gap = buffer.length > 1 ? (last - start) / (buffer.length - 1) : Infinity;
        if (buffer.length >= SCAN_MIN_LENGTH && gap <= SCAN_MAX_GAP_MS) {
          e.preventDefault(); // do not "click" a focused button
          e.stopPropagation();
          addSerialRef.current(buffer, "SCANNER");
        }
        buffer = "";
        return;
      }
      if (e.key.length !== 1) return;
      if (now - last > 100) { buffer = ""; start = now; }
      buffer += e.key;
      last = now;
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [disabled, lines.length]);

  // Cursor goes to the first item that still needs serials, so a connected scanner works straight away.
  useEffect(() => {
    if (disabled || !lines.length) return undefined;
    const t = setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const i = rows.findIndex((r) => r && rowFilled(r) < r.quantity);
      if (i !== -1) inputRefs.current[i]?.focus({ preventScroll: true });
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length, disabled]);

  // Camera (continuous): each code is added; closes when everything is filled.
  useEffect(() => {
    if (!cameraOpen) return undefined;
    let cancelled = false;
    let reader = null;
    let running = false;

    const onDecoded = (text) => {
      const now = Date.now();
      if (text === lastDecoded.current.text && now - lastDecoded.current.at < 2000) return;
      lastDecoded.current = { text, at: now };
      if (addSerialRef.current(text, "CAMERA")) beep();
    };

    // Picks up focus / torch / zoom of the running camera track.
    const setupTrack = async () => {
      const video = document.querySelector(`#${READER_ID} video`);
      const track = video?.srcObject?.getVideoTracks?.()[0];
      if (!track) return;
      trackRef.current = track;
      const caps = track.getCapabilities?.() || {};
      try {
        if (caps.focusMode?.includes?.("continuous")) await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      } catch { /* focus control is optional */ }
      const zoom = caps.zoom ? { min: caps.zoom.min, max: Math.min(caps.zoom.max, 5), step: caps.zoom.step || 0.1 } : null;
      if (!cancelled) setCamTools({ torch: !!caps.torch, torchOn: false, zoom, zoomValue: zoom ? Math.max(zoom.min, 1) : 1 });
    };

    const attempts = [
      // 1) HD picture: a dense barcode needs the detail (the default 640x480 picture is too blurry to read it)
      () => ({
        camera: { facingMode: "environment" },
        config: { fps: 15, qrbox, disableFlip: true, videoConstraints: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } },
      }),
      // 2) back camera with the device's default picture size
      () => ({ camera: { facingMode: "environment" }, config: { fps: 10, qrbox, disableFlip: true } }),
      // 3) any camera (some devices / laptops have no back camera)
      () => ({ camera: { facingMode: "user" }, config: { fps: 10, qrbox, disableFlip: true } }),
    ];

    const run = async () => {
      let lastError = null;
      for (const make of attempts) {
        if (cancelled) return;
        const { camera, config } = make();
        try {
          reader = new Html5Qrcode(READER_ID, READER_OPTIONS);
          await reader.start(camera, config, onDecoded, () => {});
          running = true;
          if (cancelled) { await reader.stop().catch(() => {}); reader.clear?.(); return; }
          await setupTrack();
          return;
        } catch (err) {
          lastError = err;
          try { await reader?.stop(); } catch { /* not running */ }
          try { reader?.clear?.(); } catch { /* ignore */ }
          reader = null;
          // permission / secure-context problems will not be fixed by another attempt
          if (/NotAllowed|Permission/i.test(err?.name || String(err))) break;
        }
      }
      if (!cancelled) {
        toast.error(cameraErrorMessage(lastError));
        setCameraOpen(false);
      }
    };
    run();

    return () => {
      cancelled = true;
      trackRef.current = null;
      setCamTools({ torch: false, torchOn: false, zoom: null, zoomValue: 1 });
      if (reader && running) {
        reader.stop().then(() => reader.clear?.()).catch(() => {});
      }
    };
  }, [cameraOpen]);

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !camTools.torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setCamTools((t) => ({ ...t, torchOn: next }));
    } catch { toast.info("Flash is not available on this camera."); }
  };

  const changeZoom = async (value) => {
    const track = trackRef.current;
    setCamTools((t) => ({ ...t, zoomValue: value }));
    try { await track?.applyConstraints({ advanced: [{ zoom: value }] }); } catch { /* zoom is optional */ }
  };

  // Fallback: take / pick a photo of the label and read the barcode from that picture (full camera quality).
  const scanPhoto = async (file) => {
    if (!file) return;
    const toastId = toast.loading("Reading barcode...");
    const fileReader = new Html5Qrcode(FILE_READER_ID, READER_OPTIONS);
    try {
      const text = await fileReader.scanFile(file, false);
      toast.dismiss(toastId);
      if (text) {
        if (addSerialRef.current(text, "CAMERA")) beep();
      }
    } catch {
      toast.dismiss(toastId);
      toast.error("Could not read a barcode from that photo. Get closer, keep the barcode flat and well lit, then try again.");
    } finally {
      try { fileReader.clear(); } catch { /* ignore */ }
    }
  };

  useEffect(() => {
    if (cameraOpen && allDone) {
      setCameraOpen(false);
      toast.success("All serial numbers scanned.");
    }
  }, [cameraOpen, allDone]);

  const openCamera = (rowIndex) => {
    activeRow.current = rowIndex;
    lastDecoded.current = { text: "", at: 0 };
    setLastScan("");
    setCameraOpen(true);
  };

  /** Table cell on the item's own row: SR.NO input + Scan button. */
  const inputCell = (item, rowIndex, mobile = false) => {
    const row = rows[rowIndex];
    if (!row) return <span className="text-xs text-gray-400">Not needed</span>;
    const count = rowFilled(row);
    if (count >= row.quantity) {
      return <span className="flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-green-700"><CheckCircle2 size={14} />{count} / {row.quantity} added</span>;
    }
    if (disabled) return <span className="text-xs text-gray-400">-</span>;
    return (
      <div className={`flex items-center ${mobile ? "w-full gap-1.5 py-0" : "min-w-[330px] gap-2 py-1"}`}>
        <input
          ref={(el) => { inputRefs.current[rowIndex] = el; }}
          value={drafts[rowIndex] || ""}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="SR. No"
          onFocus={() => { activeRow.current = rowIndex; }}
          onChange={(e) => setDrafts((d) => ({ ...d, [rowIndex]: cleanSerialInput(e.target.value) }))}
          onKeyDown={(e) => handleKeyDown(e, rowIndex)}
          className={`w-full min-w-0 flex-1 rounded-lg border border-gray-300 bg-white outline-none focus:ring-2 focus:ring-blue-500 ${mobile ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm"}`}
        />
        <button type="button" title="Add" onClick={() => submitDraft(rowIndex, "MANUAL")} className={`flex shrink-0 items-center gap-1 rounded-lg bg-gray-900 font-semibold text-white hover:bg-black ${mobile ? "h-7 px-2 text-[11px]" : "h-9 px-3 text-xs"}`}>
          <Plus size={mobile ? 12 : 14} />Add
        </button>
        <button type="button" onClick={() => openCamera(rowIndex)} className={`flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 font-semibold text-white hover:bg-blue-700 ${mobile ? "h-7 px-2 text-[11px]" : "h-9 px-3 text-xs"}`}>
          <Camera size={mobile ? 13 : 15} />Scan
        </button>
      </div>
    );
  };

  /** Full-width table row right under the item: every serial no. entered / scanned, side by side (no numbering). */
  const listRow = (item, rowIndex, colSpan) => {
    const row = rows[rowIndex];
    if (!row) return null;
    const slots = rowSlots(row).filter((s) => cleanSerialInput(s.serialNo));
    if (!slots.length) return null;
    const dupCount = (text) => lines.reduce((n, l) => n + (values[l.key] || []).filter((x) => cleanSerialInput(x.serialNo).toLowerCase() === text).length, 0);
    return (
      <tr className="border-b last:border-0">
        <td colSpan={colSpan} className="px-2 pb-3 pt-1 sm:px-3 sm:pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {slots.map((s, i) => {
              const dup = dupCount(cleanSerialInput(s.serialNo).toLowerCase()) > 1;
              return (
                <span key={`${s.serialNo}-${i}`} title={SOURCE_LABEL[s.source] || "typed"} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs ${dup ? "border-red-300 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
                  {s.serialNo}
                  {!disabled && <button type="button" title="Remove" onClick={() => removeSerial(row, i)} className="text-blue-400 hover:text-red-500"><X size={13} /></button>}
                </span>
              );
            })}
          </div>
        </td>
      </tr>
    );
  };

  /** Mobile only: full-width row under the item (2nd row): SR. No input + Add + Scan. The entered serials
   *  show in the next row (3rd row) via listRow. */
  const mobileInputRow = (item, rowIndex, colSpan) => {
    if (!rows[rowIndex]) return null;
    const hasChips = rowSlots(rows[rowIndex]).some((s) => cleanSerialInput(s.serialNo));
    return (
      <tr className={`sm:hidden ${hasChips ? "" : "border-b last:border-0"}`}>
        <td colSpan={colSpan} className="px-2 pb-2 pt-0">{inputCell(item, rowIndex, true)}</td>
      </tr>
    );
  };

  const badge = total > 0 && (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${allDone ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
      {allDone && <CheckCircle2 size={13} />}Serial no. {filled} / {total}
    </span>
  );

  const camera = cameraOpen && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3">
      <div className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Scan serial number</h3>
            <p className="text-xs text-gray-500">{filled} / {total} added</p>
          </div>
          <button type="button" onClick={() => setCameraOpen(false)} className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50"><X size={16} /></button>
        </div>
        <div id={READER_ID} className="overflow-hidden rounded-lg bg-black" />
        <div id={FILE_READER_ID} className="hidden" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {camTools.torch && (
            <button type="button" onClick={toggleTorch} className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${camTools.torchOn ? "border-amber-300 bg-amber-50 text-amber-800" : "border-gray-300 bg-white text-gray-700"}`}>
              {camTools.torchOn ? <Zap size={14} /> : <ZapOff size={14} />}Flash
            </button>
          )}
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">
            <ImageUp size={14} />Take photo
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { scanPhoto(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </div>
        {camTools.zoom && (
          <label className="mt-3 flex items-center gap-2 text-xs text-gray-600">
            Zoom
            <input type="range" min={camTools.zoom.min} max={camTools.zoom.max} step={camTools.zoom.step} value={camTools.zoomValue} onChange={(e) => changeZoom(Number(e.target.value))} className="flex-1" />
          </label>
        )}
        <p className="mt-3 min-h-5 text-center text-sm font-medium text-green-700">{lastScan ? `Last scanned: ${lastScan}` : "Keep the whole barcode inside the box, 15-25 cm away and flat. If it does not read, use Flash / Zoom, or tap Take photo."}</p>
        <button type="button" onClick={() => setCameraOpen(false)} className="mt-3 w-full rounded-lg bg-gray-900 py-2.5 text-sm font-semibold text-white hover:bg-black">Done</button>
      </div>
    </div>
  );

  return { inputCell, mobileInputRow, listRow, badge, camera, hasSerials: lines.length > 0 };
}
