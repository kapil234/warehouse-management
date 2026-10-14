// Serial numbers of an outward entry (filled by the warehouse manager at dispatch).
// Only countable items (UOM "Pcs") carry serials: an item of 4 Pcs needs exactly 4 serial numbers.
// Serials belong to category + SKU (rows with the same SKU are added up), never to a row id.

export const SERIAL_UOM = "Pcs";
export const needsSerials = (item) => String(item?.uom || "").trim().toLowerCase() === SERIAL_UOM.toLowerCase();
export const serialKey = (category, sku) => `${String(category || "").trim().toLowerCase()}||${String(sku || "").trim().toLowerCase()}`;
export const cleanSerialInput = (value) => String(value ?? "").replace(/\s+/g, "");

/** [{ key, category, sku, quantity }] - one entry per category + SKU that needs serials. */
export function buildSerialLines(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!needsSerials(item)) continue;
    const key = serialKey(item.category, item.sku);
    const line = map.get(key) || { key, category: item.category, sku: item.sku, quantity: 0 };
    line.quantity += Number(item.quantity) || 0;
    map.set(key, line);
  }
  return [...map.values()];
}

/** { [key]: [{ serialNo, source }] } - always exactly `quantity` slots per line, saved serials first. */
export function initialSerialValues(lines, saved = []) {
  const values = {};
  for (const line of lines) {
    const mine = saved.filter((s) => serialKey(s.category, s.sku) === line.key).slice(0, line.quantity);
    values[line.key] = Array.from({ length: line.quantity }, (_, i) => ({
      serialNo: mine[i]?.serialNo || "",
      source: mine[i]?.source || "MANUAL",
    }));
  }
  return values;
}

export const countFilled = (values, key) => (values[key] || []).filter((s) => s.serialNo.trim()).length;

/** Rows to send to the server (blank slots left out). */
export function serialPayload(lines, values) {
  const rows = [];
  for (const line of lines) {
    for (const s of values[line.key] || []) {
      const serialNo = cleanSerialInput(s.serialNo);
      if (serialNo) rows.push({ category: line.category, sku: line.sku, serialNo, source: s.source || "MANUAL" });
    }
  }
  return rows;
}

/** Error message, or null when every Pcs unit has its own serial number. */
export function serialProblem(lines, values) {
  const seen = new Set();
  for (const line of lines) {
    const slots = values[line.key] || [];
    const filled = slots.filter((s) => cleanSerialInput(s.serialNo));
    for (const s of filled) {
      const k = cleanSerialInput(s.serialNo).toLowerCase();
      if (seen.has(k)) return `Serial number "${cleanSerialInput(s.serialNo)}" is entered more than once`;
      seen.add(k);
    }
    if (filled.length !== line.quantity) {
      return `${line.sku}: ${line.quantity} serial number${line.quantity === 1 ? "" : "s"} needed, ${filled.length} entered`;
    }
  }
  return null;
}
