import { createPdfDocument } from "../shared/pdfExport";

// Builds and downloads a table-formatted PDF for a single outward
// (dispatch) record: outward info, every reference document (invoice /
// e-way bill / etc, one row each), items, and the full document
// checklist (required + any extra uploads) with upload status.
export function downloadOutwardPdf(outward, items, documentRows, currentStatus) {
  const doc = createPdfDocument();

  doc.heading("OUTWARD DETAILS");
  doc.paragraph(`Dispatch Number: ${outward.outwardNumber || outward.id || "-"}   |   Status: ${currentStatus}`, {
    size: 10,
    gap: 20,
  });

  doc.subheading("Outward Information");
  doc.keyValueGrid([
    ["Dispatch Number", outward.outwardNumber || "-"],
    ["Customer", outward.customerName || "-"],
    ["Company", outward.companyName || outward.warehouse?.company?.name || "-"],
    ["Outward Type", outward.outwardType || "-"],
    ["Dispatch Mode", outward.dispatchMode || "-"],
    ["Vehicle / AWB Number", outward.vehicleNumber || "-"],
    [
      "Reference Date",
      outward.refDocDate ? new Date(outward.refDocDate).toLocaleDateString("en-IN") : "-",
    ],
    ["Created By", outward.createdBy?.name || outward.createdBy?.email || "-"],
  ]);
  doc.spacer(4);

  doc.subheading("Reference Documents");
  const referenceRows =
    Array.isArray(outward.referenceDocuments) && outward.referenceDocuments.length
      ? outward.referenceDocuments.map((d) => [d.refDocType || "-", d.refDocNumber || "-", d.ewayBillNumber || "-"])
      : outward.refDocNumber
      ? [[outward.refDocType || "-", outward.refDocNumber || "-", outward.ewayBillNumber || "-"]]
      : [];
  doc.table({
    columns: [
      { header: "Document Type", width: 150 },
      { header: "Reference No.", width: 200 },
      { header: "E-way Bill No.", width: 165 },
    ],
    rows: referenceRows,
  });

  doc.subheading("Items");
  doc.table({
    columns: [
      { header: "#", width: 30 },
      { header: "Category", width: 110 },
      { header: "Company", width: 110 },
      { header: "SKU / Model", width: 140 },
      { header: "Qty", width: 65 },
      { header: "UOM", width: 80 },
    ],
    rows: items.map((item, index) => [
      String(index + 1),
      item.category || "-",
      item.companyName || "-",
      item.sku || "-",
      String(item.quantity || 0),
      item.uom || "-",
    ]),
  });

  doc.subheading("Documents");
  doc.table({
    columns: [
      { header: "Document", width: 150 },
      { header: "File Name", width: 170 },
      { header: "Status", width: 75 },
      { header: "Type", width: 60 },
      { header: "Size (KB)", width: 60 },
    ],
    rows: documentRows.map((row) => [
      row.label,
      row.document?.fileName || (row.document?.fileKey ? String(row.document.fileKey).split("/").pop() : "-"),
      row.document ? "Uploaded" : "Pending",
      row.document?.fileType || "-",
      row.document ? (Number(row.document.fileSize || 0) / 1024).toFixed(1) : "-",
    ]),
  });

  doc.spacer(4);
  doc.paragraph(`Remarks: ${outward.remarks || "-"}`, { size: 9.5 });

  doc.save(outward.outwardNumber || "outward-details");
}
