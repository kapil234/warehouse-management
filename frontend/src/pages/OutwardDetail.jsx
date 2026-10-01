import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Download,
  Loader2,
  Truck,
  Calendar,
  User,
  Hash,
  Route,
  Check,
  X,
  Paperclip,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  fetchOutwardById,
  approveOutward,
  rejectOutward,
  downloadItemProof,
  clearCurrentOutward,
  selectCurrentOutward,
  selectOutwardDetailStatus,
  selectOutwardDetailError,
} from "../features/outward/outwardSlice";
import {
  REQUIRED_DOCUMENTS,
  WORKFLOW_STATUS,
  DISPATCH_STATE,
  costStatusLabel,
  formatMoney,
  isPlaceholder,
} from "../features/outward/outwardHelpers";
import { downloadOutwardPdf } from "../features/outward/outwardPdf";
import OutwardDocuments from "../components/OutwardDocuments";

export default function OutwardDetail() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { id } = useParams();

  const outward = useSelector(selectCurrentOutward);
  const detailStatus = useSelector(selectOutwardDetailStatus);
  const error = useSelector(selectOutwardDetailError);

  const loading = detailStatus === "loading" || detailStatus === "idle";

  const user = (() => { try { return JSON.parse(localStorage.getItem("user")); } catch { return null; } })();
  const role = user?.role;
  const isSuperAdmin = role === "SUPER_ADMIN";
  const isSales = role === "SALES";
  const isAccount = role === "ACCOUNT";
  const isWarehouse = role === "WAREHOUSE_MANAGER";

  // Account's approve / reject dialog: null | "approve" | "reject"
  const [decision, setDecision] = useState(null);
  const [decisionRemarks, setDecisionRemarks] = useState("");
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    if (id) dispatch(fetchOutwardById(id));
    return () => dispatch(clearCurrentOutward());
  }, [dispatch, id]);

  // Super admin never stays on this page for an approved entry that is waiting for dispatch:
  // it goes straight to the dispatch form (sales info, Update, Reject and the dispatch fields).
  useEffect(() => {
    if (
      isSuperAdmin &&
      detailStatus === "succeeded" &&
      outward?.id === id &&
      outward.workflowStatus === "PENDING_DISPATCH"
    ) {
      navigate(`/outward/${id}/dispatch`, { replace: true });
    }
  }, [isSuperAdmin, detailStatus, outward, id, navigate]);

  const openDecision = (type) => {
    setDecisionRemarks("");
    setDecision(type);
  };

  const submitDecision = async () => {
    if (decision === "reject" && !decisionRemarks.trim()) {
      toast.error("Please give a reason for rejecting.");
      return;
    }
    setDeciding(true);
    const action = decision === "approve" ? approveOutward : rejectOutward;
    const result = await dispatch(action({ id, remarks: decisionRemarks.trim() || undefined }));
    setDeciding(false);
    if (action.fulfilled.match(result)) {
      toast.success(result.payload?.message || (decision === "approve" ? "Approved." : "Rejected."));
      setDecision(null);
      // Super admin: after approving, go straight on to the dispatch details.
      if (decision === "approve" && isSuperAdmin) {
        navigate(`/outward/${id}/dispatch`, { replace: true });
        return;
      }
      dispatch(fetchOutwardById(id));
    } else {
      toast.error(result.payload || "Something went wrong.");
    }
  };

  const handleViewProof = (itemId) => {
    dispatch(downloadItemProof({ outwardId: id, itemId })).then((result) => {
      if (downloadItemProof.rejected.match(result)) toast.error(result.payload || "Unable to open the proof file.");
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

  // Super admin + approved entry waiting for dispatch: the redirect to the dispatch form is on its
  // way (see the effect above). Show the same loader instead of flashing this page for a moment.
  if (isSuperAdmin && outward?.workflowStatus === "PENDING_DISPATCH") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading outward entry...
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

  // Warehouse managers only get "Pending" / "Dispatched" (dispatchState);
  // everyone else gets the real workflow status.
  const workflow = outward.workflowStatus;
  const dispatched = isWarehouse ? outward.dispatchState === "Dispatched" : workflow === "DISPATCHED";
  const awaitingDispatch = isWarehouse ? outward.dispatchState === "Pending" : workflow === "PENDING_DISPATCH";
  const showCost = !isWarehouse;
  // Until dispatch: Sales can edit, Account can reject. After dispatch Sales / Account / Warehouse are locked out;
  // the Super admin's Update button does everything (sales info, cost, items and dispatch details);
  // the warehouse manager can still update the dispatch details, documents and vehicle number.
  // Sales can view entries the super admin created for their company, but only edit their own.
  const canEdit = isSuperAdmin || (isSales && ["PENDING_APPROVAL", "REJECTED", "PENDING_DISPATCH"].includes(workflow));
  const canApprove = (isAccount || isSuperAdmin) && ["PENDING_APPROVAL", "REJECTED"].includes(workflow);
  const canReject = (isAccount || isSuperAdmin) && ["PENDING_APPROVAL", "PENDING_DISPATCH"].includes(workflow);
  const canDispatch = (isSuperAdmin && awaitingDispatch) || (isWarehouse && (awaitingDispatch || dispatched));
  // Documents: add / upload / replace / delete for the warehouse manager (before and after dispatch)
  // and for the Super admin. Sales / Account never see the section for editing.
  const canManageDocs = isSuperAdmin || isWarehouse;
  // The super admin does not see the documents section at the approval stage;
  // it appears with the dispatch details and stays after dispatch.
  const docsStage = !isSuperAdmin || awaitingDispatch || dispatched;
  // The documents section is always on the detail page (empty state when nothing is uploaded).
  // Sales / Account get it once dispatched; the admin from dispatch details onwards; the warehouse manager always.
  // Sales / Account only see their own part, never the documents or dispatch details.
  const showDocuments = docsStage && (isSuperAdmin || isWarehouse);
  const showDispatchInfo = isWarehouse || (isSuperAdmin && dispatched);
  const statusStyle = isWarehouse ? DISPATCH_STATE[outward.dispatchState] : WORKFLOW_STATUS[workflow];

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
      : !isPlaceholder(outward.refDocNumber)
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

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {canApprove && (
                <button type="button" onClick={() => openDecision("approve")} className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 sm:text-sm"><Check size={15} /> Approve</button>
              )}
              {canReject && (
                <button type="button" onClick={() => openDecision("reject")} className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 sm:text-sm"><X size={15} /> Reject</button>
              )}
              {canDispatch && (
                <Link to={`/outward/${id}/dispatch`} className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black sm:text-sm">
                  <Truck size={15} /> {dispatched ? "Update dispatch details" : "Fill dispatch details"}
                </Link>
              )}
              {canEdit && (
                <button type="button" onClick={() => navigate(`/outward/${id}/edit`)} className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black sm:text-sm">Update</button>
              )}
              {/* Download: only once the entry is fully dispatched, and only for the admin / warehouse manager. Sales and Account never get it. */}
              {dispatched && (isSuperAdmin || isWarehouse) && (
                <button type="button" onClick={() => downloadOutwardPdf(outward, items, docsStage && showDocuments ? documentRows : [], currentStatus, { includeDispatch: showDispatchInfo || showDocuments, includeCost: showCost })} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 sm:text-sm"><Download size={15} /> Download</button>
              )}
            </div>

            {statusStyle && (
              <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium sm:px-4 sm:py-2 sm:text-sm ${statusStyle.cls}`}>
                {statusStyle.label}
              </span>
            )}
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
            <Info
              icon={<Calendar size={18} />}
              label={dispatched && (isSuperAdmin || isWarehouse) ? "Dispatch Date" : "Outward Date"}
              value={outward.refDocDate ? new Date(outward.refDocDate).toLocaleDateString("en-IN") : "-"}
            />
            {showDispatchInfo && (
              <>
                <Info icon={<Route size={18} />} label="Dispatch Mode" value={isPlaceholder(outward.dispatchMode) ? "-" : outward.dispatchMode} />
                <Info icon={<Truck size={18} />} label="Vehicle / AWB Number" value={outward.vehicleNumber || "-"} />
              </>
            )}
            <Info label="Created By" value={outward.createdBy?.name || outward.createdBy?.email || "-"} />
            {showDispatchInfo && <Info label="Remarks" value={outward.remarks || "-"} />}
          </div>

          {/* Reference documents — one row per invoice/e-way bill/etc the
              user added on the form. Falls back to the single refDoc*
              fields for older records saved before referenceDocuments
              existed. */}
          {showDispatchInfo && (
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
          )}
        </div>

        {/* Approval details - Sales / Account / Super admin only. Never sent to the warehouse. */}
        {showCost && (workflow === "REJECTED" || outward.approvedByName || dispatched) && (
          <div className={`rounded-xl border p-4 sm:p-6 ${workflow === "REJECTED" ? "border-red-200 bg-red-50" : "bg-white"}`}>
            <h2 className="text-base font-semibold text-gray-900 mb-4 sm:text-lg">Approval</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5">
              <Info label={workflow === "REJECTED" ? "Rejected By" : "Approved By"} value={outward.approvedByName || "-"} />
              <Info label={workflow === "REJECTED" ? "Rejected On" : "Approved On"} value={outward.approvedAt ? new Date(outward.approvedAt).toLocaleString("en-IN") : "-"} />
              <Info label={workflow === "REJECTED" ? "Reason" : "Remarks"} value={outward.approvalRemarks || "-"} />
              {dispatched && isSuperAdmin && <Info label="Dispatched By" value={outward.dispatchedByName || "-"} />}
              {dispatched && isSuperAdmin && <Info label="Dispatched On" value={outward.dispatchedAt ? new Date(outward.dispatchedAt).toLocaleString("en-IN") : "-"} />}
            </div>
            {workflow === "REJECTED" && (
              <p className="mt-3 text-xs text-red-600">Sales can edit this entry and send it for approval again, or Account can approve it again.</p>
            )}
          </div>
        )}

        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">Items</h2>

          <div className={showCost ? "overflow-x-auto" : ""}>
          <table className={`w-full text-[11px] sm:text-sm ${showCost ? "min-w-[760px]" : "table-fixed"}`}>
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 px-1 w-6 sm:py-3 sm:px-3 sm:w-auto">#</th>
                <th className="py-2 px-1 sm:py-3 sm:px-3">Category</th>
                <th className="py-2 px-1 sm:py-3 sm:px-3">{isWarehouse ? "Model" : "SKU"}</th>
                <th className="py-2 px-1 sm:py-3 sm:px-3">Qty</th>
                <th className="py-2 px-1 sm:py-3 sm:px-3">UOM</th>
                {showCost && (
                  <>
                    <th className="py-2 px-1 sm:py-3 sm:px-3">Cost</th>
                    <th className="py-2 px-1 sm:py-3 sm:px-3">Cost status</th>
                    <th className="py-2 px-1 sm:py-3 sm:px-3">UTR</th>
                    <th className="py-2 px-1 sm:py-3 sm:px-3">Proof</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={item.id || index} className="border-b last:border-0">
                  <td className="py-2 px-1 sm:py-4 sm:px-3">{index + 1}</td>
                  <td className="py-2 px-1 truncate sm:py-4 sm:px-3">{item.category || "-"}</td>
                  <td className="py-2 px-1 truncate font-medium sm:py-4 sm:px-3">{item.sku || "-"}</td>
                  <td className="py-2 px-1 sm:py-4 sm:px-3">{item.quantity || 0}</td>
                  <td className="py-2 px-1 truncate sm:py-4 sm:px-3">{item.uom || "-"}</td>
                  {showCost && (
                    <>
                      <td className="py-2 px-1 font-medium sm:py-4 sm:px-3">{formatMoney(item.cost)}</td>
                      <td className="py-2 px-1 sm:py-4 sm:px-3">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold sm:text-xs ${
                            item.costStatus === "COMPLETED"
                              ? "bg-green-100 text-green-700"
                              : item.costStatus === "PARTIALLY_COMPLETED"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {costStatusLabel(item.costStatus)}
                        </span>
                      </td>
                      <td className="py-2 px-1 break-all sm:py-4 sm:px-3">{item.utrNumber || "-"}</td>
                      <td className="py-2 px-1 sm:py-4 sm:px-3">
                        {item.hasProof ? (
                          <button type="button" onClick={() => handleViewProof(item.id)} className="inline-flex items-center gap-1 text-blue-700 hover:underline">
                            <Paperclip size={13} /> View
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={showCost ? 9 : 5} className="text-center py-8 text-gray-500">
                    No items found
                  </td>
                </tr>
              )}
              {showCost && items.length > 0 && (
                <tr className="border-t bg-gray-50 font-semibold text-gray-900">
                  <td colSpan="5" className="py-3 px-1 text-right sm:px-3">Total cost</td>
                  <td className="py-3 px-1 sm:px-3">{formatMoney(items.reduce((sum, i) => sum + (Number(i.cost) || 0), 0))}</td>
                  <td colSpan="3"></td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        {showDocuments && <OutwardDocuments outwardId={id} documents={documents} canManage={canManageDocs} />}
      </div>


      {/* Approve / reject dialog (Account, Super admin) */}
      {decision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">
              {decision === "approve" ? "Approve this outward entry?" : "Reject this outward entry?"}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {decision === "approve"
                ? "The cost details will be marked approved and the entry goes to the warehouse manager for dispatch."
                : "It goes back to Sales, who can fix the details and send it again."}
            </p>
            <label className="mt-4 mb-1.5 block text-xs font-medium text-gray-500">
              {decision === "approve" ? "Remarks (optional)" : "Reason for rejecting"}
            </label>
            <textarea
              rows={3}
              value={decisionRemarks}
              onChange={(e) => setDecisionRemarks(e.target.value)}
              placeholder={decision === "approve" ? "Any note for the record" : "Tell Sales what needs to be corrected"}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={deciding} onClick={() => setDecision(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
              <button
                type="button"
                disabled={deciding}
                onClick={submitDecision}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${decision === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}
              >
                {deciding ? "Please wait..." : decision === "approve" ? "Approve" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
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