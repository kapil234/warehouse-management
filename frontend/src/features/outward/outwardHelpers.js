import {
  formatDateTime,
  getQuantity,
  getSerialCount,
  getDocumentStatus,
} from "../shared/formatters";

// -------------------------------------------------
// REQUIRED_DOCUMENTS
// -------------------------------------------------

// Warehouse manager's documents. Invoice / E-way bill now belong to the account team.
export const REQUIRED_DOCUMENTS = [
  "Delivery challan",
  "Dispatch photo",
];

// -------------------------------------------------
// Account team's side: reference documents + documents
// -------------------------------------------------
// Shown to the user as: Invoice / E-way Bill / DC Challan / Other ("Other (Accounts)" is stored under that
// name so it never clashes with the warehouse manager's "Other").
export const ACCOUNT_REF_TYPES = ["Invoice", "E-way Bill", "DC Challan", "Other (Accounts)"];
const ACCOUNT_REF_OWNED = ACCOUNT_REF_TYPES;
export const MANAGER_REF_TYPES = ["Delivery Challan", "Return Note", "Bilty", "Other"];
// No account document is compulsory to upload: each reference type chosen just gets its own (optional)
// row in the Documents section. Only the e-way bill is needed above EWAY_BILL_THRESHOLD (number OR document).
export const ACCOUNT_REQUIRED_DOCUMENTS = [];
export const refTypeLabel = (type) => (type === "Other (Accounts)" ? "Other" : type);
// The document row each reference type opens in the Documents section.
// Warehouse manager types open their own row too: choose Bilty -> a Bilty row to upload, and so on.
const REF_TYPE_DOCUMENT = {
  Invoice: "Invoice",
  "E-way Bill": "E-way bill",
  "DC Challan": "DC challan",
  // Account's "Other" is stored as "Accounts other" (shown as "Other") so it never clashes with the manager's "Other".
  "Other (Accounts)": "Accounts other",
  "Delivery Challan": "Delivery challan",
  "Return Note": "Return note",
  Bilty: "Bilty",
  Other: "Other",
};
export const refTypeDocument = (type) => REF_TYPE_DOCUMENT[type] || null;
export const refNumberLabel = (type) =>
  type === "Invoice" ? "Invoice no." : type === "E-way Bill" ? "E-way bill no." : type === "DC Challan" ? "Challan no." : "Reference doc no.";

// Above this PI amount (Rs.) an e-way bill number or the e-way bill document is required before approval.
export const EWAY_BILL_THRESHOLD = 100000;
export const isAboveEwayLimit = (piAmount) => Number(piAmount) > EWAY_BILL_THRESHOLD;
const isEwayCategory = (category) => /^e-?way/i.test(String(category || "").trim());
// True when an e-way bill DOCUMENT (uploaded or picked) exists - the e-way bill number alone is not enough.
export const hasEwayDocument = (docs = [], staged = []) => [...docs, ...staged].some((d) => isEwayCategory(d.docCategory));
// refs = rows being edited ({ refDocType, refDocNumber, ewayBillNumber }); docs / staged = uploaded and picked files.
export const hasEwayBill = (refs = [], docs = [], staged = []) =>
  refs.some((r) => (/e-?way/i.test(String(r.refDocType || "")) && String(r.refDocNumber || "").trim()) || String(r.ewayBillNumber || "").trim()) ||
  [...docs, ...staged].some((d) => isEwayCategory(d.docCategory));
// Receiving details (filled by the warehouse manager after dispatch).
export const RECEIVING_REQUIRED_DOCUMENT = "Receiving copy";
export const RECEIVING_ADD_MENU = ["Receiving photo", "Other"];
export const RECEIVING_DOC_PREFIX = "Receiving ";
export const isReceivingDocCategory = (category) => /^receiving/i.test(String(category || "").trim());
export const isReceived = (outward) => Boolean(outward?.receivedAt || outward?.receivedDate);
export const ACCOUNT_DOC_PREFIX = "Accounts other - ";

const sameText = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
export const isAccountRef = (ref) => ACCOUNT_REF_OWNED.some((t) => sameText(t, ref?.refDocType));
export const isManagerRef = (ref) => !isAccountRef(ref);
export const isAccountDocCategory = (category) => /^(invoice|e-?way|dc[ -]?challan|accounts other)/i.test(String(category || "").trim());
// "Accounts other - GST certificate" -> "Other - GST certificate"
export const docLabel = (category) => String(category || "Document").replace(/^accounts other/i, "Other");

// Account may add / replace / delete its documents until the entry is dispatched.
export const ACCOUNT_EDIT_STATUSES = ["PENDING_APPROVAL", "REJECTED", "ON_HOLD", "PENDING_DISPATCH"];

const totalCostOf = (items) => items.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);

export function formatOutwardType(type) {
  if (!type) return "-";

  const value = String(type).trim();
  const lower = value.toLowerCase();

  if (lower.includes("sale")) {
    return "Sale - Stock Out";
  }
  if (lower.includes("service") && lower.includes("customer")) {
    return "Service - Stock Out to Customer";
  }
  if (lower.includes("service")) {
    return "Service - Stock Out";
  }
  if (lower.includes("return") && lower.includes("vendor")) {
    return "Return to Vendor";
  }
  if (lower.includes("return")) {
    return "Return to Vendor";
  }
  if (lower.includes("damage") || lower.includes("scrap")) {
    return "Damage / Scrap Out";
  }

  return value;
}

export function getStatus(outward) {
  return getDocumentStatus(outward, REQUIRED_DOCUMENTS);
}

// Maps a raw outward/dispatch object from the API into
// the flat shape the list page renders.
export function formatOutwardEntry(outward, index) {
  const items = Array.isArray(outward.items) ? outward.items : [];

  const outwardNumber =
    outward.outwardNumber ||
    outward.outward_number ||
    outward.dcNumber ||
    outward.dc_number ||
    outward.number ||
    outward.outward ||
    `MIN-${index + 1}`;

  const outwardType = outward.outwardType || outward.outward_type || outward.type || "-";

  const party =
    outward.customerName ||
    outward.customer_name ||
    outward.partyName ||
    outward.party_name ||
    outward.recipientName ||
    outward.recipient_name ||
    outward.customer?.name ||
    outward.vendor?.name ||
    "-";

  const createdAt =
    outward.createdAt ||
    outward.created_at ||
    outward.outwardDate ||
    outward.outward_date ||
    outward.date ||
    outward.createdOn ||
    outward.created_on;

  const { date, time } = formatDateTime(createdAt);
  const quantity = getQuantity(items);
  const serials = getSerialCount(items);
  const statusData = getStatus(outward);

  const documents = Array.isArray(outward.documents)
    ? outward.documents
    : Array.isArray(outward.document)
    ? outward.document
    : [];

  return {
    id: outward.id,
    outwardNumber,
    outward: outwardNumber,
    type: formatOutwardType(outwardType),
    party,
    time,
    date,
    quantity,
    serials,
    status: statusData.status,
    statusType: statusData.statusType,
    pendingDocuments: statusData.pendingDocuments,
    uploadedDocuments: statusData.uploadedDocuments,
    requiredDocuments: statusData.requiredDocuments,
    items,
    workflowStatus: outward.workflowStatus || null,
    dispatchState: outward.dispatchState || null,
    totalCost: totalCostOf(items),
    piNumber: outward.piNumber || "",
    piAmount: outward.piAmount ?? null,
    shipToContactPerson: outward.shipToContactPerson || "",
    shipToContactNo: outward.shipToContactNo || "",
    shipToLocation: outward.shipToLocation || "",
    billToContactPerson: outward.billToContactPerson || "",
    billToContactNo: outward.billToContactNo || "",
    billToEmail: outward.billToEmail || "",
    refDocType: outward.refDocType || outward.ref_doc_type || "",
    refDocNumber: outward.refDocNumber || outward.ref_doc_number || "",
    refDocDate: outward.refDocDate || outward.ref_doc_date || "",
    ewayBillNumber: outward.ewayBillNumber || outward.eway_bill_number || "",
    dispatchMode: outward.dispatchMode || outward.dispatch_mode || "",
    vehicleNumber: outward.vehicleNumber || outward.vehicle_number || "",
    driverName: outward.driverName || "",
    driverContact: outward.driverContact || "",
    receivedDate: outward.receivedDate || null,
    receivedAt: outward.receivedAt || null,
    remarks: outward.remarks || "",
    documents,
    createdAt,
  };
}


// -------------------------------------------------
// Approval workflow (Sales -> Account -> Warehouse)
// -------------------------------------------------

export const COST_STATUS_OPTIONS = [
  { value: "COMPLETED", label: "Completed" },
  { value: "PARTIALLY_COMPLETED", label: "Partially completed" },
  { value: "PENDING", label: "Pending" },
];

export const paymentStatusLabel = (value) =>
  COST_STATUS_OPTIONS.find((o) => o.value === value)?.label || "-";

export const WORKFLOW_STATUS = {
  PENDING_APPROVAL: { label: "Pending approval", cls: "bg-amber-100 text-amber-700" },
  PENDING_DISPATCH: { label: "Pending dispatch", cls: "bg-blue-100 text-blue-700" },
  DISPATCHED: { label: "Dispatched", cls: "bg-green-100 text-green-700" },
  REJECTED: { label: "Rejected", cls: "bg-red-100 text-red-600" },
  ON_HOLD: { label: "On hold", cls: "bg-purple-100 text-purple-700" },
};

// The warehouse manager never receives the real workflow status - only
// "Pending" / "Dispatched" (dispatchState).
export const DISPATCH_STATE = {
  Pending: { label: "Pending dispatch", cls: "bg-blue-100 text-blue-700" },
  Dispatched: { label: "Dispatched", cls: "bg-green-100 text-green-700" },
};

// Once dispatched, EVERY role sees the receiving state instead of plain "Dispatched":
// "Receiving pending" until the receiving form is filled, then "Receiving completed".
export const RECEIVING_STATE = {
  pending: { label: "Receiving pending", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "Receiving completed", cls: "bg-green-100 text-green-700" },
};

export const getStatusStyle = (outward) => {
  if (!outward) return null;
  const dispatched = outward.workflowStatus
    ? outward.workflowStatus === "DISPATCHED"
    : outward.dispatchState === "Dispatched";
  if (dispatched) return isReceived(outward) ? RECEIVING_STATE.completed : RECEIVING_STATE.pending;
  return outward.workflowStatus ? WORKFLOW_STATUS[outward.workflowStatus] : DISPATCH_STATE[outward.dispatchState];
};

export const isPlaceholder = (value) => !value || String(value).trim().toLowerCase() === "pending";

export const formatMoney = (value) =>
  value === null || value === undefined || value === ""
    ? "-"
    : `\u20B9${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const totalCost = (items = []) =>
  items.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);
