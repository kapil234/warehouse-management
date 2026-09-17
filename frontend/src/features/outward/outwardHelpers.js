import {
  formatDateTime,
  getQuantity,
  getSerialCount,
  getDocumentStatus,
} from "../shared/formatters";

// -------------------------------------------------
// REQUIRED_DOCUMENTS
// -------------------------------------------------

export const REQUIRED_DOCUMENTS = [
  "Delivery challan",
  "E-way bill",
  "Dispatch photo",
];

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
