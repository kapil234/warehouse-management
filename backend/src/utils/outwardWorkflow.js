import prisma from "../config/prisma.js";

/**
 * =========================================================
 * OUTWARD WORKFLOW HELPERS
 * =========================================================
 *
 *   SALES   --create-->  PENDING_APPROVAL
 *   ACCOUNT --approve--> PENDING_DISPATCH
 *   ACCOUNT --reject-->  REJECTED  (allowed until dispatch; Sales edits + resubmits,
 *                                    or Account approves it again directly)
 *   ACCOUNT --hold-->    ON_HOLD   (allowed until dispatch, with a reason; stock stays reserved.
 *                                    Account can approve / reject it later, Sales can edit + resubmit.
 *                                    The warehouse manager never sees it.)
 *   SALES   --edit-->    allowed until dispatch. Changing PI / payment or item details
 *                        sends the entry back to PENDING_APPROVAL; changing only
 *                        header fields (customer, type ...) keeps PENDING_DISPATCH.
 *   WAREHOUSE_MANAGER --dispatch (details + documents)--> DISPATCHED
 *
 * Warehouse only sees PENDING_DISPATCH / DISPATCHED entries.
 * Dispatch documents are visible to Sales / Account only once DISPATCHED.
 * After DISPATCHED Sales / Account are locked out; the WAREHOUSE_MANAGER can still update the dispatch
 * details (reference documents, mode, vehicle no., remarks) and add / delete documents.
 * SUPER_ADMIN changes everything through Update (PI details, items, payment, dispatch details).
 * SUPER_ADMIN can change everything.
 * =========================================================
 */

export const STATUS = {
  PENDING_APPROVAL: "PENDING_APPROVAL",
  PENDING_DISPATCH: "PENDING_DISPATCH",
  DISPATCHED: "DISPATCHED",
  REJECTED: "REJECTED",
  ON_HOLD: "ON_HOLD",
};

export const PAYMENT_STATUSES = ["COMPLETED", "PARTIALLY_COMPLETED", "PENDING"];

// Statuses the warehouse manager is allowed to see at all.
export const WAREHOUSE_VISIBLE_STATUSES = [STATUS.PENDING_DISPATCH, STATUS.DISPATCHED];

// Sales may edit until dispatch; Account may reject until dispatch.
export const SALES_EDITABLE_STATUSES = [STATUS.PENDING_APPROVAL, STATUS.REJECTED, STATUS.ON_HOLD, STATUS.PENDING_DISPATCH];
export const REJECTABLE_STATUSES = [STATUS.PENDING_APPROVAL, STATUS.ON_HOLD, STATUS.PENDING_DISPATCH];
// Account can put a pending / approved entry on hold until it is dispatched.
export const HOLDABLE_STATUSES = [STATUS.PENDING_APPROVAL, STATUS.PENDING_DISPATCH];
// Account can approve a pending entry, or change its mind and approve a rejected / held one.
export const APPROVABLE_STATUSES = [STATUS.PENDING_APPROVAL, STATUS.REJECTED, STATUS.ON_HOLD];

// Audit-log actions the warehouse manager must NOT see (PI / payment / approval side).
// COST_UPDATED is kept so older history rows stay hidden.
export const HIDDEN_FROM_WAREHOUSE_ACTIONS = ["SUBMITTED", "RESUBMITTED", "APPROVED", "REJECTED", "COST_UPDATED", "PAYMENT_UPDATED", "PI_UPDATED", "PARTY_UPDATED", "ON_HOLD"];

export const isFinanceSide = (role) => role === "SALES" || role === "ACCOUNT";

/** Company ids the user belongs to (join table + primary company). */
export async function getUserCompanyIds(user) {
  const links = await prisma.userCompany.findMany({
    where: { userId: user.id },
    select: { companyId: true },
  });
  return [...new Set([...links.map((l) => l.companyId), ...(user.companyId ? [user.companyId] : [])])];
}

/**
 * Warehouse ids a SALES / ACCOUNT user can see, through the companies they
 * belong to. Used for the view-only inward list / detail / reports / dashboard.
 */
export async function getFinanceWarehouseIds(user) {
  const companyIds = await getUserCompanyIds(user);
  if (!companyIds.length) return [];
  const rows = await prisma.warehouse.findMany({
    where: { companyId: { in: companyIds } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Removes everything the warehouse manager must not see from an outward
 * entry: PI details, payment status, UTR, proof, approval info, workflow status.
 * Items keep only category / model (sku) / quantity / uom.
 */
export function sanitizeForWarehouse(entry) {
  if (!entry) return entry;
  const {
    approvedById, approvedByName, approvedAt, approvalRemarks, status,
    piNumber, piDate, piAmount, piFileKey, piFileName, piFileType,
    shipToContactPerson, shipToContactNo, shipToLocation,
    billToContactPerson, billToContactNo, billToEmail,
    ...rest
  } = entry;
  return {
    ...rest,
    dispatchState: status === STATUS.DISPATCHED ? "Dispatched" : "Pending",
    items: (entry.items || []).map((i) => ({
      id: i.id,
      category: i.category,
      companyName: i.companyName,
      sku: i.sku,
      quantity: i.quantity,
      uom: i.uom,
    })),
  };
}

/** Sales / Account / Super admin view. The storage key stays server-side; a flag is sent instead. */
export function shapeItemForFinance(i) {
  const { proofFileKey, ...rest } = i;
  return {
    ...rest,
    hasProof: Boolean(proofFileKey),
  };
}

export function shapeForFinance(entry) {
  if (!entry) return entry;
  const { piFileKey, ...rest } = entry;
  return {
    ...rest,
    piAmount: entry.piAmount === null || entry.piAmount === undefined ? null : Number(entry.piAmount),
    hasPiFile: Boolean(piFileKey),
    items: (entry.items || []).map(shapeItemForFinance),
  };
}

/** Returns an error message, or null when the PI (proforma invoice) fields are valid. */
export function validatePi(data) {
  if (!String(data.piNumber || "").trim()) return "PI number is required";
  if (!data.piDate || Number.isNaN(new Date(data.piDate).getTime())) return "PI date is required";
  const amount = data.piAmount === "" || data.piAmount === null || data.piAmount === undefined ? NaN : Number(data.piAmount);
  if (!Number.isFinite(amount) || amount < 0) return "PI amount is required and must be 0 or more";
  if (data.piFileKey && !/^(min|uploads)\//.test(String(data.piFileKey))) return "Invalid PI file";
  return null;
}

/** Returns an error message, or null when the Ship to / Bill to details are valid (all optional). */
export function validateParty(data) {
  const email = String(data.billToEmail || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Bill to email is not a valid email address";
  for (const [key, label] of [["shipToContactNo", "Ship to contact no."], ["billToContactNo", "Bill to contact no."]]) {
    const v = String(data[key] || "").trim();
    if (v && !/^[0-9+()\-\s]{6,20}$/.test(v)) return `${label} is not valid`;
  }
  return null;
}

/** Ship to / Bill to columns as stored in Min. */
export function toPartyColumns(data) {
  const t = (v) => (String(v ?? "").trim() || null);
  return {
    shipToContactPerson: t(data.shipToContactPerson),
    shipToContactNo: t(data.shipToContactNo),
    shipToLocation: t(data.shipToLocation),
    billToContactPerson: t(data.billToContactPerson),
    billToContactNo: t(data.billToContactNo),
    billToEmail: t(data.billToEmail),
  };
}

/** PI columns as stored in Min. `previous` = the saved entry (to keep its PI file on edit). */
export function toPiColumns(data, previous) {
  const keep = data.keepPiFile === true && previous?.piFileKey && !data.piFileKey;
  return {
    piNumber: String(data.piNumber).trim(),
    piDate: new Date(data.piDate),
    piAmount: Number(data.piAmount),
    piFileKey: keep ? previous.piFileKey : data.piFileKey || null,
    piFileName: keep ? previous.piFileName : data.piFileKey ? data.piFileName || null : null,
    piFileType: keep ? previous.piFileType : data.piFileKey ? data.piFileType || null : null,
  };
}

/** Returns an error message, or null when the item's payment fields are valid. */
export function validateItemPayment(item, label) {
  if (!PAYMENT_STATUSES.includes(item.paymentStatus)) {
    return `${label}: payment status must be Completed, Partially Completed or Pending`;
  }
  // Approve By is needed while the payment is still Pending / Partially completed.
  if (item.paymentStatus !== "COMPLETED" && !String(item.approvedBy || "").trim()) {
    return `${label}: Approve By is required when payment status is ${item.paymentStatus === "PENDING" ? "Pending" : "Partially Completed"}`;
  }
  if (item.paymentStatus !== "PENDING") {
    const hasUtr = Boolean(String(item.utrNumber || "").trim());
    const hasProof = Boolean(item.proofFileKey) || item.keepProof === true;
    if (!hasUtr && !hasProof) {
      return `${label}: UTR number or a payment proof (image / file) is required when payment status is ${
        item.paymentStatus === "COMPLETED" ? "Completed" : "Partially Completed"
      }`;
    }
  }
  if (item.proofFileKey && !/^(min|uploads)\//.test(String(item.proofFileKey))) {
    return `${label}: invalid proof file`;
  }
  return null;
}

/** Item row as stored in MinItem. `previous` = the row being replaced on edit (to keep its proof). */
export function toItemRow(item, previous) {
  const paid = item.paymentStatus !== "PENDING";
  const keep = paid && item.keepProof === true && previous?.proofFileKey;
  return {
    category: item.category,
    companyName: item.companyName ? String(item.companyName).trim() || null : null,
    sku: String(item.sku).trim(),
    quantity: Number(item.quantity),
    uom: item.uom,
    paymentStatus: item.paymentStatus,
    utrNumber: paid ? String(item.utrNumber || "").trim() || null : null,
    approvedBy: item.paymentStatus !== "COMPLETED" ? String(item.approvedBy || "").trim() || null : null,
    proofFileKey: paid ? (keep ? previous.proofFileKey : item.proofFileKey || null) : null,
    proofFileName: paid ? (keep ? previous.proofFileName : item.proofFileName || null) : null,
    proofFileType: paid ? (keep ? previous.proofFileType : item.proofFileType || null) : null,
  };
}

/**
 * Fingerprint of everything Account approves: item identity, quantity, UOM and
 * all payment fields. If it changes on an already-approved entry, approval is needed again.
 */
export function itemsFingerprint(items = []) {
  return JSON.stringify(
    items
      .map((i) => [
        String(i.category || "").toLowerCase(),
        String(i.companyName || "").trim().toLowerCase(),
        String(i.sku || "").trim().toLowerCase(),
        Number(i.quantity),
        String(i.uom || "").toLowerCase(),
        i.paymentStatus || null,
        i.utrNumber || null,
        i.approvedBy || null,
        Boolean(i.proofFileKey),
      ])
      .map((row) => JSON.stringify(row))
      .sort()
  );
}

/**
 * Storage layout (bucket warehouse-documents):
 *
 *   min/<outward number>/   payment proofs + delivery challan / e-way bill / photos ...
 *
 * A new entry has no outward number until it is saved, so a proof picked on the create form waits in
 * uploads/<outward id>/ and is moved into min/<outward number>/ as soon as the entry is created.
 */
export const outwardFolder = (outwardNumber) => `min/${String(outwardNumber).replace(/[^a-zA-Z0-9._-]/g, "_")}/`;
export const tempProofFolder = (minId) => `uploads/${String(minId).toLowerCase()}/`;

/** A proof / PI file key must sit in this entry's own folder (final or temporary) - never in someone else's. */
export function proofKeyProblem(items = [], minId, outwardNumber, piFileKey) {
  const allowed = [tempProofFolder(minId), ...(outwardNumber ? [outwardFolder(outwardNumber)] : [])];
  const inFolder = (key) => allowed.some((f) => String(key).startsWith(f));
  const bad = items.find((i) => i.proofFileKey && !inFolder(i.proofFileKey));
  if (bad) return "A payment proof does not belong to this entry. Please remove it and attach the file again.";
  if (piFileKey && !inFolder(piFileKey)) return "The PI file does not belong to this entry. Please remove it and attach the file again.";
  return null;
}


/**
 * Who owns which reference document / document.
 *
 *   ACCOUNT            Invoice, E-way Bill, Other (Accounts)          (documents: Invoice, E-way bill, Accounts other - <name>)
 *   WAREHOUSE_MANAGER  Delivery Challan, Return Note, Other           (documents: Delivery challan, Dispatch photo, ...)
 *
 * Ownership is decided by the type / category name, so no extra database column is needed.
 * Each side only ever replaces its own rows, so Account and the warehouse never overwrite each other.
 */
export const ACCOUNT_REF_TYPES = ["Invoice", "E-way Bill", "DC Challan", "Other (Accounts)"]; // shown to the user as Invoice / E-way Bill / DC Challan / Other
export const MANAGER_REF_TYPES = ["Delivery Challan", "Return Note", "Other"];

export const canonicalAccountRefType = (type) =>
  ACCOUNT_REF_TYPES.find((t) => t.toLowerCase() === String(type || "").trim().toLowerCase()) || null;
export const isAccountRefType = (type) => Boolean(canonicalAccountRefType(type));

export const ACCOUNT_DOC_PREFIX = "Accounts other - ";
export const isAccountDocCategory = (category) => /^(invoice|e-?way|dc[ -]?challan|accounts other)/i.test(String(category || "").trim());

// Account can add / replace / delete its own reference documents and files until the entry is dispatched.
export const ACCOUNT_DOC_STATUSES = [STATUS.PENDING_APPROVAL, STATUS.REJECTED, STATUS.ON_HOLD, STATUS.PENDING_DISPATCH];

/**
 * Above this PI amount (Rs.) an e-way bill is needed: either an e-way bill number
 * (an "E-way Bill" reference with its number) or the e-way bill document itself.
 */
export const EWAY_BILL_THRESHOLD = 100000;

export function ewayBillProblem({ piAmount, referenceDocuments = [], documents = [] }) {
  if (!(Number(piAmount) > EWAY_BILL_THRESHOLD)) return null;
  const hasNumber = referenceDocuments.some(
    (r) => (/e-?way/i.test(String(r.refDocType || "")) && String(r.refDocNumber || "").trim()) || String(r.ewayBillNumber || "").trim()
  );
  const hasDocument = documents.some((d) => /^e-?way/i.test(String(d.docCategory || "").trim()));
  return hasNumber || hasDocument
    ? null
    : "The PI amount is above Rs. 1,00,000: add the e-way bill number (reference type E-way Bill) or upload the e-way bill document before approving.";
}
