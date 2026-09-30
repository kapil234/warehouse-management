import { createPdfDocument } from "../shared/pdfExport";

// Builds and downloads a table-formatted PDF for a single outward
// (dispatch) record: outward info, every reference document (invoice /
// e-way bill / etc, one row each), items, and the full document
// checklist (required + any extra uploads) with upload status.
export function downloadOutwardPdf(outward, items, documentRows, currentStatus, { includeDispatch = true, includeCost = false } = {}) {
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
    ...(includeDispatch
      ? [
          ["Dispatch Mode", outward.dispatchMode || "-"],
          ["Vehicle / AWB Number", outward.vehicleNumber || "-"],
        ]
      : []),
    [
      includeDispatch ? "Reference Date" : "Outward Date",
      outward.refDocDate ? new Date(outward.refDocDate).toLocaleDateString("en-IN") : "-",
    ],
    ["Created By", outward.createdBy?.name || outward.createdBy?.email || "-"],
  ]);
  doc.spacer(4);

  if (includeDispatch) {
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
  }

  doc.subheading("Items");
  const money = (v) => (v === null || v === undefined || v === "" ? "-" : Number(v).toLocaleString("en-IN"));
  const costLabel = { COMPLETED: "Completed", PARTIALLY_COMPLETED: "Partially completed", PENDING: "Pending" };
  doc.table({
    columns: includeCost
      ? [
          { header: "#", width: 30 },
          { header: "Category", width: 105 },
          { header: "SKU / Model", width: 125 },
          { header: "Qty", width: 40 },
          { header: "UOM", width: 45 },
          { header: "Cost", width: 65 },
          { header: "Cost status", width: 105 },
        ]
      : [
          { header: "#", width: 30 },
          { header: "Category", width: 150 },
          { header: "SKU / Model", width: 190 },
          { header: "Qty", width: 65 },
          { header: "UOM", width: 80 },
        ],
    rows: items.map((item, index) => [
      String(index + 1),
      item.category || "-",
      item.sku || "-",
      String(item.quantity || 0),
      item.uom || "-",
      ...(includeCost ? [money(item.cost), costLabel[item.costStatus] || "-"] : []),
    ]),
  });

  if (includeDispatch) {
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
  }

  doc.save(outward.outwardNumber || "outward-details");
}
