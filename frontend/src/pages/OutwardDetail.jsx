import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Trash2,
  Upload,
  FileText,
  Loader2,
  Truck,
  Calendar,
  User,
  Hash,
  Route,
  Plus,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  fetchOutwardById,
  uploadOutwardDocument,
  downloadOutwardDocument,
  deleteOutwardDocument,
  clearCurrentOutward,
  selectCurrentOutward,
  selectOutwardDetailStatus,
  selectOutwardDetailError,
  selectOutwardDocActionStatus,
  selectOutwardUploadingDocs,
} from "../features/outward/outwardSlice";
import { REQUIRED_DOCUMENTS } from "../features/outward/outwardHelpers";
import { downloadOutwardPdf } from "../features/outward/outwardPdf";

export default function OutwardDetail() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { id } = useParams();

  const outward = useSelector(selectCurrentOutward);
  const detailStatus = useSelector(selectOutwardDetailStatus);
  const error = useSelector(selectOutwardDetailError);
  const docActionStatus = useSelector(selectOutwardDocActionStatus);
  const uploadingDocs = useSelector(selectOutwardUploadingDocs);

  const loading = detailStatus === "loading";

  const [showDocumentMenu, setShowDocumentMenu] = useState(false);
  const pendingCategoryRef = useRef(null);
  const addDocInputRef = useRef(null);

  useEffect(() => {
    if (id) dispatch(fetchOutwardById(id));
    return () => dispatch(clearCurrentOutward());
  }, [dispatch, id]);

  const handleUpload = (event, docCategory) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      alert("Only PDF, JPG, PNG and WEBP files are allowed.");
      event.target.value = "";
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("Maximum file size is 10 MB.");
      event.target.value = "";
      return;
    }

    dispatch(uploadOutwardDocument({ outwardId: id, file, docCategory })).then((result) => {
      if (uploadOutwardDocument.fulfilled.match(result)) {
        alert(`${docCategory} uploaded successfully.`);
      } else {
        alert(result.payload?.message || "Upload failed.");
      }
    });

    event.target.value = "";
  };

  // Add document menu — lets the user pick one of the three known
  // document types (to attach a 2nd/3rd copy of it) or "Other" for a
  // custom-named document. Picking a type immediately opens the file
  // picker for it; the chosen file uploads as soon as it's selected,
  // landing in the unified document list below as its own row.
  const handleAddDocumentClick = (type, documents) => {
    setShowDocumentMenu(false);

    let label = type;
    if (type === "Other") {
      const name = window.prompt("Enter document name");
      if (!name?.trim()) return;
      label = name.trim();
    }

    const existingCount = documents.filter((doc) =>
      String(doc.docCategory || "").trim().toLowerCase().startsWith(label.toLowerCase())
    ).length;

    pendingCategoryRef.current = existingCount > 0 ? `${label} #${existingCount + 1}` : label;
    addDocInputRef.current?.click();
  };

  const handlePendingUpload = (event) => {
    const category = pendingCategoryRef.current;
    if (!category) return;
    handleUpload(event, category);
  };

  const handleDownload = (documentId) => {
    if (!documentId) {
      alert("Document ID is missing.");
      return;
    }
    dispatch(downloadOutwardDocument({ documentId })).then((result) => {
      if (downloadOutwardDocument.rejected.match(result)) {
        alert(result.payload?.message || "Unable to download file.");
      }
    });
  };

  const handleDelete = (documentId) => {
    if (!documentId) {
      alert("Document ID is missing.");
      return;
    }
    if (!window.confirm("Are you sure you want to delete this document?")) return;

    dispatch(deleteOutwardDocument({ documentId })).then((result) => {
      if (deleteOutwardDocument.fulfilled.match(result)) {
        alert("Document deleted successfully.");
      } else {
        alert(result.payload?.message || "Delete failed.");
      }
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-600">
          <Loader2 className="w-6 h-6 animate-spin" />
          Loading outward details...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 mb-6">
          <ArrowLeft size={20} />
          Back
        </button>
        <div className="bg-white border border-red-200 rounded-xl p-6 text-red-600">{error}</div>
      </div>
    );
  }

  if (!outward) return null;

  const documents = outward.documents || [];
  const items = outward.items || [];

  const uploadedCategories = documents.map((doc) => String(doc.docCategory || "").trim().toLowerCase());
  const allDocumentsUploaded = REQUIRED_DOCUMENTS.every((requiredDocument) => {
    const required = requiredDocument.toLowerCase();
    return uploadedCategories.some((value) => value === required || value.startsWith(`${required} #`) || value.startsWith(`${required} `));
  });

  const currentStatus = allDocumentsUploaded ? "Complete" : "Pending";

  // One unified list of document rows: the three required types always
  // appear first (uploaded or not), followed by anything else that's
  // been uploaded (duplicates of a required type, or custom "Other"
  // documents) — all rendered with the exact same row layout, so there's
  // no separate "Additional documents" section.
  const requiredLower = REQUIRED_DOCUMENTS.map((label) => label.toLowerCase());
  const extraDocuments = documents.filter(
    (doc) => !requiredLower.includes(String(doc.docCategory || "").trim().toLowerCase())
  );

  const documentRows = [
    ...REQUIRED_DOCUMENTS.map((label) => ({
      key: label,
      label,
      document: documents.find((doc) => String(doc.docCategory || "").trim().toLowerCase() === label.toLowerCase()),
      required: true,
    })),
    ...extraDocuments.map((doc) => ({
      key: doc.id,
      label: doc.docCategory || "Document",
      document: doc,
      required: false,
    })),
  ];

  // One row per reference document added on the form (invoice, e-way
  // bill, etc). Older records without a referenceDocuments array fall
  // back to the single refDoc*/ewayBillNumber fields as one row.
  const referenceDocumentRows =
    Array.isArray(outward.referenceDocuments) && outward.referenceDocuments.length
      ? outward.referenceDocuments
      : outward.refDocNumber
      ? [{ id: "ref-1", refDocType: outward.refDocType, refDocNumber: outward.refDocNumber, ewayBillNumber: outward.ewayBillNumber }]
      : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 sm:py-5">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-3 sm:gap-2 sm:text-base sm:mb-4">
            <ArrowLeft size={18} />
            Back
          </button>

          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-gray-900 sm:text-2xl">Outward Details</h1>
              <p className="text-xs text-gray-500 mt-0.5 sm:text-base sm:mt-1">{outward.outwardNumber || `Outward #${outward.id}`}</p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => navigate(`/outward/${id}/edit`)} className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black sm:text-sm">Update</button>
              <button type="button" onClick={() => downloadOutwardPdf(outward, items, documentRows, currentStatus)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 sm:text-sm"><Download size={15} /> Download</button>
            </div>

            <span
              className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium sm:px-4 sm:py-2 sm:text-sm ${
                currentStatus === "Complete" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {currentStatus}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4 space-y-4 sm:px-6 sm:py-6 sm:space-y-6">
        <div className="bg-white rounded-xl border p-4 sm:p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4 sm:text-lg sm:mb-5">Outward Information</h2>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5">
            <Info icon={<Hash size={18} />} label="Dispatch Number" value={outward.outwardNumber || "-"} />
            <Info icon={<User size={18} />} label="Customer" value={outward.customerName || "-"} />
            <Info icon={<User size={18} />} label="Company" value={outward.companyName || outward.warehouse?.company?.name || "-"} />
            <Info icon={<Truck size={18} />} label="Outward Type" value={outward.outwardType || "-"} />
            <Info icon={<Route size={18} />} label="Dispatch Mode" value={outward.dispatchMode || "-"} />
            <Info icon={<Truck size={18} />} label="Vehicle / AWB Number" value={outward.vehicleNumber || "-"} />
            <Info
              icon={<Calendar size={18} />}
              label="Reference Date"
              value={outward.refDocDate ? new Date(outward.refDocDate).toLocaleDateString("en-IN") : "-"}
            />
            <Info label="Created By" value={outward.createdBy?.name || outward.createdBy?.email || "-"} />
            <Info label="Remarks" value={outward.remarks || "-"} />
          </div>

          {/* Reference documents — one row per invoice/e-way bill/etc the
              user added on the form. Falls back to the single refDoc*
              fields for older records saved before referenceDocuments
              existed. */}
          <div className="mt-5 pt-5 border-t">
            <p className="text-sm font-medium text-gray-700 mb-3">Reference Documents</p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-[11px] sm:text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-gray-500">
                    <th className="py-2 px-3">Document Type</th>
                    <th className="py-2 px-3">Reference No.</th>
                    <th className="py-2 px-3">E-way Bill No.</th>
                  </tr>
                </thead>
                <tbody>
                  {referenceDocumentRows.map((ref, index) => (
                    <tr key={ref.id || index} className="border-b last:border-0">
                      <td className="py-2 px-3">{ref.refDocType || "-"}</td>
                      <td className="py-2 px-3">{ref.refDocNumber || "-"}</td>
                      <td className="py-2 px-3">{ref.ewayBillNumber || "-"}</td>
                    </tr>
                  ))}
                  {referenceDocumentRows.length === 0 && (
                    <tr>
                      <td colSpan="3" className="text-center py-4 text-gray-500">
                        No reference documents
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">Items</h2>

          <table className="w-full table-fixed text-[11px] sm:text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 px-1 w-6 sm:py-3 sm:px-3 sm:w-auto">#</th>
                <th className="py-2 px-1 sm:py-3 sm:px-3">Category</th>
                <th className="py-2 px-1 sm:py-3 sm:px-3">Company</th>
                <th className="py-2 px-1 sm:py-3 sm:px-3">SKU</th>
                <th className="py-2 px-1 sm:py-3 sm:px-3">Qty</th>
                <th className="py-2 px-1 sm:py-3 sm:px-3">UOM</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={item.id || index} className="border-b last:border-0">
                  <td className="py-2 px-1 sm:py-4 sm:px-3">{index + 1}</td>
                  <td className="py-2 px-1 truncate sm:py-4 sm:px-3">{item.category || "-"}</td>
                  <td className="py-2 px-1 truncate sm:py-4 sm:px-3">{item.companyName || "-"}</td>
                  <td className="py-2 px-1 truncate font-medium sm:py-4 sm:px-3">{item.sku || "-"}</td>
                  <td className="py-2 px-1 sm:py-4 sm:px-3">{item.quantity || 0}</td>
                  <td className="py-2 px-1 truncate sm:py-4 sm:px-3">{item.uom || "-"}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan="6" className="text-center py-8 text-gray-500">
                    No items found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl border p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Documents</h2>
              <p className="text-sm text-gray-500 mt-1">Upload, download or delete required documents</p>
            </div>

            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setShowDocumentMenu((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-2 text-xs font-medium text-white hover:bg-gray-800"
              >
                <Plus size={14} /> Add document
              </button>

              {showDocumentMenu && (
                <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                  {[...REQUIRED_DOCUMENTS, "Other"].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleAddDocumentClick(type, documents)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <FileText size={16} className="text-gray-400" />
                      {type}
                    </button>
                  ))}
                </div>
              )}

              {/* Hidden input driven by the menu above — the chosen
                  category is passed via pendingCategoryRef so it's
                  never a stale closure value by the time a file is picked. */}
              <input
                ref={addDocInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={handlePendingUpload}
              />
            </div>
          </div>

          <div className="space-y-3">
            {documentRows.map((row) => {
              const { label, document, required, key } = row;

              const isUploadingThis = uploadingDocs[label] === true;
              const isDownloading = document && docActionStatus[document.id] === "downloading";
              const isDeleting = document && docActionStatus[document.id] === "deleting";

              return (
                <div key={key} className="border rounded-xl p-3 sm:p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                    <div className="flex items-center gap-2.5 min-w-0 sm:gap-3">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 sm:w-10 sm:h-10 ${
                          document ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"
                        }`}
                      >
                        <FileText size={18} className="sm:hidden" />
                        <FileText size={20} className="hidden sm:block" />
                      </div>

                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 sm:text-base">{label}</p>

                        {document ? (
                          <p className="text-[11px] text-gray-500 truncate mt-1 sm:text-xs">
                            {document.fileName || (document.fileKey ? String(document.fileKey).split("/").pop() : "Document")} {" • "} {document.fileType || "File"} {" • "}
                            {(Number(document.fileSize || 0) / 1024).toFixed(1)} {" KB"}
                          </p>
                        ) : (
                          <p className="text-[11px] text-red-500 mt-1 sm:text-xs">Not uploaded</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {document ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleDownload(document.id)}
                            disabled={isDownloading || isDeleting}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border hover:bg-gray-50 disabled:opacity-50 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
                            title="Download"
                          >
                            {isDownloading ? <Loader2 size={16} className="animate-spin sm:hidden" /> : <Download size={16} className="sm:hidden" />}
                            {isDownloading ? <Loader2 size={18} className="hidden animate-spin sm:block" /> : <Download size={18} className="hidden sm:block" />}
                            <span className="hidden sm:inline">Download</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDelete(document.id)}
                            disabled={isDeleting || isDownloading}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
                            title="Delete"
                          >
                            {isDeleting ? <Loader2 size={16} className="animate-spin sm:hidden" /> : <Trash2 size={16} className="sm:hidden" />}
                            {isDeleting ? <Loader2 size={18} className="hidden animate-spin sm:block" /> : <Trash2 size={18} className="hidden sm:block" />}
                            <span className="hidden sm:inline">Delete</span>
                          </button>
                        </>
                      ) : required ? (
                        <label
                          className={`cursor-pointer flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-black text-white hover:bg-gray-800 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm ${
                            isUploadingThis ? "opacity-50 pointer-events-none" : ""
                          }`}
                        >
                          {isUploadingThis ? <Loader2 size={16} className="animate-spin sm:hidden" /> : <Upload size={16} className="sm:hidden" />}
                          {isUploadingThis ? <Loader2 size={18} className="hidden animate-spin sm:block" /> : <Upload size={18} className="hidden sm:block" />}
                          <span>Upload</span>
                          <input
                            type="file"
                            className="hidden"
                            accept=".pdf,.jpg,.jpeg,.png,.webp"
                            onChange={(event) => handleUpload(event, label)}
                            disabled={isUploadingThis}
                          />
                        </label>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 pt-4 border-t">
            {currentStatus === "Complete" ? (
              <div className="flex items-center gap-2 text-green-600 font-medium">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                All required documents uploaded
              </div>
            ) : (
              <div className="flex items-center gap-2 text-amber-600 font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Some required documents are still pending
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ icon, label, value }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1 sm:gap-2 sm:text-sm">
        {icon}
        {label}
      </div>
      <div className="text-sm font-medium text-gray-900 break-words sm:text-base">{value}</div>
    </div>
  );
}