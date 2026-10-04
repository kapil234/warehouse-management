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
export const ACCOUNT_REF_TYPES = ["Invoice", "Other (Accounts)"];
// Older entries may still hold an "E-way Bill" reference: it stays account-owned but is no longer offered.
const ACCOUNT_REF_OWNED = [...ACCOUNT_REF_TYPES, "E-way Bill"];
export const MANAGER_REF_TYPES = ["Delivery Challan", "Return Note", "Other"];
export const ACCOUNT_REQUIRED_DOCUMENTS = ["Invoice"];
export const ACCOUNT_DOC_PREFIX = "Accounts other - ";

const sameText = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
export const isAccountRef = (ref) => ACCOUNT_REF_OWNED.some((t) => sameText(t, ref?.refDocType));
export const isManagerRef = (ref) => !isAccountRef(ref);
export const isAccountDocCategory = (category) => /^(invoice|e-?way|accounts other)/i.test(String(category || "").trim());
// "Accounts other - GST certificate" -> "Other - GST certificate"
export const docLabel = (category) => String(category || "Document").replace(/^accounts other/i, "Other");

// Account may add / replace / delete its documents until the entry is dispatched.
export const ACCOUNT_EDIT_STATUSES = ["PENDING_APPROVAL", "REJECTED", "PENDING_DISPATCH"];

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
    refDocType: outward.refDocType || outward.ref_doc_type || "",
    refDocNumber: outward.refDocNumber || outward.ref_doc_number || "",
    refDocDate: outward.refDocDate || outward.ref_doc_date || "",
    ewayBillNumber: outward.ewayBillNumber || outward.eway_bill_number || "",
    dispatchMode: outward.dispatchMode || outward.dispatch_mode || "",
    vehicleNumber: outward.vehicleNumber || outward.vehicle_number || "",
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

export const costStatusLabel = (value) =>
  COST_STATUS_OPTIONS.find((o) => o.value === value)?.label || "-";

export const WORKFLOW_STATUS = {
  PENDING_APPROVAL: { label: "Pending approval", cls: "bg-amber-100 text-amber-700" },
  PENDING_DISPATCH: { label: "Pending dispatch", cls: "bg-blue-100 text-blue-700" },
  DISPATCHED: { label: "Dispatched", cls: "bg-green-100 text-green-700" },
  REJECTED: { label: "Rejected", cls: "bg-red-100 text-red-600" },
};

// The warehouse manager never receives the real workflow status - only
// "Pending" / "Dispatched" (dispatchState).
export const DISPATCH_STATE = {
  Pending: { label: "Pending dispatch", cls: "bg-blue-100 text-blue-700" },
  Dispatched: { label: "Dispatched", cls: "bg-green-100 text-green-700" },
};

export const isPlaceholder = (value) => !value || String(value).trim().toLowerCase() === "pending";

export const formatMoney = (value) =>
  value === null || value === undefined || value === ""
    ? "-"
    : `\u20B9${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const totalCost = (items = []) =>
  items.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);
