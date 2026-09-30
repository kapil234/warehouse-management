import { useRef, useState } from "react";
import { Download, Trash2, Upload, FileText, Loader2, Plus, RefreshCw } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  uploadOutwardDocument,
  downloadOutwardDocument,
  deleteOutwardDocument,
  selectOutwardDocActionStatus,
  selectOutwardUploadingDocs,
} from "../features/outward/outwardSlice";
import { REQUIRED_DOCUMENTS } from "../features/outward/outwardHelpers";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

const sameCategory = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/**
 * Documents section used on the outward detail page AND the dispatch page,
 * so it looks and works the same everywhere.
 *
 *   canManage = true  -> Add document, Upload, Replace, Delete, Download
 *   canManage = false -> Download only (uploaded documents only)
 */
export default function OutwardDocuments({ outwardId, documents = [], canManage = false }) {
  const dispatch = useDispatch();
  const docActionStatus = useSelector(selectOutwardDocActionStatus);
  const uploadingDocs = useSelector(selectOutwardUploadingDocs);

  const [showDocumentMenu, setShowDocumentMenu] = useState(false);
  const pendingCategoryRef = useRef(null);
  const addDocInputRef = useRef(null);

  const validFile = (file, event) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Only PDF, JPG, PNG and WEBP files are allowed.");
      event.target.value = "";
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Maximum file size is 10 MB.");
      event.target.value = "";
      return false;
    }
    return true;
  };

  const handleUpload = (event, docCategory) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!validFile(file, event)) return;

    dispatch(uploadOutwardDocument({ outwardId, file, docCategory })).then((result) => {
      if (uploadOutwardDocument.fulfilled.match(result)) {
        toast.success(`${docCategory} uploaded successfully.`);
      } else {
        toast.error(result.payload?.message || "Upload failed.");
      }
    });
    event.target.value = "";
  };

  // Replace = upload the new file first, then remove the old one, so a failed
  // upload never leaves the row empty.
  const handleReplace = (event, docCategory, oldDocument) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!validFile(file, event)) return;

    dispatch(uploadOutwardDocument({ outwardId, file, docCategory })).then(async (result) => {
      if (!uploadOutwardDocument.fulfilled.match(result)) {
        toast.error(result.payload?.message || "Upload failed.");
        return;
      }
      const removed = await dispatch(deleteOutwardDocument({ documentId: oldDocument.id }));
      if (deleteOutwardDocument.fulfilled.match(removed)) {
        toast.success(`${docCategory} replaced successfully.`);
      } else {
        toast.error("New file uploaded, but the old one could not be removed. Please delete it manually.");
      }
    });
    event.target.value = "";
  };

  // Add document menu: pick one of the three known types (to attach another
  // copy) or "Other" for a custom-named document.
  const handleAddDocumentClick = (type) => {
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
    if (!documentId) return toast.error("Document ID is missing.");
    dispatch(downloadOutwardDocument({ documentId })).then((result) => {
      if (downloadOutwardDocument.rejected.match(result)) {
        toast.error(result.payload?.message || "Unable to download file.");
      }
    });
  };

  const handleDelete = (documentId) => {
    if (!documentId) return toast.error("Document ID is missing.");
    if (!window.confirm("Are you sure you want to delete this document?")) return;

    dispatch(deleteOutwardDocument({ documentId })).then((result) => {
      if (deleteOutwardDocument.fulfilled.match(result)) {
        toast.success("Document deleted successfully.");
      } else {
        toast.error(result.payload?.message || "Delete failed.");
      }
    });
  };

  // Required types always show first (uploaded or not), then extra copies / custom ones.
  const requiredLower = REQUIRED_DOCUMENTS.map((label) => label.toLowerCase());
  const extraDocuments = documents.filter(
    (doc) => !requiredLower.includes(String(doc.docCategory || "").trim().toLowerCase())
  );
  const documentRows = [
    ...REQUIRED_DOCUMENTS.map((label) => ({
      key: label,
      label,
      document: documents.find((doc) => sameCategory(doc.docCategory, label)),
      required: true,
    })),
    ...extraDocuments.map((doc) => ({
      key: doc.id,
      label: doc.docCategory || "Document",
      document: doc,
      required: false,
    })),
  ];

  const uploadedCategories = documents.map((doc) => String(doc.docCategory || "").trim().toLowerCase());
  const allUploaded = REQUIRED_DOCUMENTS.every((label) => {
    const required = label.toLowerCase();
    return uploadedCategories.some((v) => v === required || v.startsWith(`${required} #`) || v.startsWith(`${required} `));
  });

  const rows = canManage ? documentRows : documentRows.filter((row) => row.document);

  return (
    <div className="bg-white rounded-xl border p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Documents</h2>
          <p className="text-sm text-gray-500 mt-1">
            {canManage ? "Upload, download, replace or delete required documents" : "Dispatch documents"}
          </p>
        </div>

        {canManage && (
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
                    onClick={() => handleAddDocumentClick(type)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <FileText size={16} className="text-gray-400" />
                    {type}
                  </button>
                ))}
              </div>
            )}

            {/* Hidden input driven by the menu above; the chosen category is
                kept in a ref so it is never a stale closure value. */}
            <input
              ref={addDocInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={handlePendingUpload}
            />
          </div>
        )}
      </div>

      <div className="space-y-3">
        {rows.length === 0 && (
          <p className="rounded-lg border border-dashed py-6 text-center text-sm text-gray-500">No documents uploaded yet.</p>
        )}
        {rows.map(({ label, document, required, key }) => {
          const isUploadingThis = uploadingDocs[label] === true;
          const isDownloading = document && docActionStatus[document.id] === "downloading";
          const isDeleting = document && docActionStatus[document.id] === "deleting";
          const busy = isUploadingThis || isDownloading || isDeleting;

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

                <div className="flex flex-wrap items-center gap-2">
                  {document ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleDownload(document.id)}
                        disabled={busy}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border hover:bg-gray-50 disabled:opacity-50 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
                        title="Download"
                      >
                        {isDownloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                        <span className="hidden sm:inline">Download</span>
                      </button>

                      {canManage && (
                        <>
                          <label
                            className={`cursor-pointer flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border hover:bg-gray-50 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm ${
                              busy ? "opacity-50 pointer-events-none" : ""
                            }`}
                            title="Replace"
                          >
                            {isUploadingThis ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                            <span className="hidden sm:inline">Replace</span>
                            <input
                              type="file"
                              className="hidden"
                              accept=".pdf,.jpg,.jpeg,.png,.webp"
                              onChange={(event) => handleReplace(event, label, document)}
                              disabled={busy}
                            />
                          </label>

                          <button
                            type="button"
                            onClick={() => handleDelete(document.id)}
                            disabled={busy}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
                            title="Delete"
                          >
                            {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            <span className="hidden sm:inline">Delete</span>
                          </button>
                        </>
                      )}
                    </>
                  ) : required && canManage ? (
                    <label
                      className={`cursor-pointer flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-black text-white hover:bg-gray-800 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm ${
                        isUploadingThis ? "opacity-50 pointer-events-none" : ""
                      }`}
                    >
                      {isUploadingThis ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
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

      {canManage && (
        <div className="mt-5 pt-4 border-t">
          {allUploaded ? (
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
      )}
    </div>
  );
}
