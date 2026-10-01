import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Loader2, Paperclip, Plus, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  fetchOutwardById,
  dispatchOutward,
  rejectOutward,
  downloadItemProof,
  clearCurrentOutward,
  selectCurrentOutward,
  selectOutwardDetailStatus,
  selectOutwardDetailError,
} from "../features/outward/outwardSlice";
import { isPlaceholder, costStatusLabel, formatMoney } from "../features/outward/outwardHelpers";
import OutwardDocuments from "../components/OutwardDocuments";

/**
 * =========================================================
 * DISPATCH DETAILS  (Warehouse manager, Super admin)
 * =========================================================
 * Opens right after the entry is approved. Filled once; after dispatch the Super admin
 * changes everything (dispatch details included) with Update. The manager only
 * sees the item details (category, model, quantity, UOM) and fills the
 * dispatch side: reference documents, dispatch mode, vehicle / AWB number
 * and remarks. Cost, UTR and approval details are never sent to them.
 * =========================================================
 */

const isSuperAdminUser = () => {
  try { return JSON.parse(localStorage.getItem("user"))?.role === "SUPER_ADMIN"; } catch { return false; }
};

const makeId = () => crypto.randomUUID();
const newReference = () => ({ id: makeId(), refDocType: "Invoice", refDocNumber: "", ewayBillNumber: "" });
const toLocalInput = (value) => {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return toLocalInput();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function OutwardDispatch() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { id } = useParams();

  const outward = useSelector(selectCurrentOutward);
  const detailStatus = useSelector(selectOutwardDetailStatus);
  const detailError = useSelector(selectOutwardDetailError);

  const [dispatchDateTime, setDispatchDateTime] = useState(() => toLocalInput());
  const [references, setReferences] = useState([newReference()]);
  const [dispatchMode, setDispatchMode] = useState("By Road");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  // Documents picked here are sent together with the dispatch details when the form is saved.
  const [stagedDocs, setStagedDocs] = useState([]);
  const submittingRef = useRef(false); // stops the "already dispatched" redirect firing during our own save
  const [filled, setFilled] = useState(false);
  // Super admin can reject from here (reason required); it then shows Approve again on the details page.
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400";
  const labelCls = "block text-xs font-medium text-gray-500 mb-1.5";

  useEffect(() => {
    if (id) dispatch(fetchOutwardById(id));
    return () => dispatch(clearCurrentOutward());
  }, [dispatch, id]);

  // Prefill once the entry is loaded (editing details that were already saved).
  useEffect(() => {
    if (!outward || filled) return;
    setFilled(true);

    const saved = Array.isArray(outward.referenceDocuments) ? outward.referenceDocuments : [];
    if (saved.length) {
      setReferences(
        saved.map((r) => ({
          ...newReference(),
          refDocType: r.refDocType || "Invoice",
          refDocNumber: isPlaceholder(r.refDocNumber) ? "" : r.refDocNumber,
          ewayBillNumber: r.ewayBillNumber || "",
        }))
      );
    }
    if (outward.dispatchMode && !isPlaceholder(outward.dispatchMode)) setDispatchMode(outward.dispatchMode);
    setVehicleNumber(outward.vehicleNumber || "");
    setRemarks(outward.remarks || "");
    if (outward.dispatchState === "Dispatched" || outward.workflowStatus === "DISPATCHED") {
      setDispatchDateTime(toLocalInput(outward.refDocDate));
    }
  }, [outward, filled]);

  const updateReference = (rid, field, value) => setReferences((p) => p.map((r) => (r.id === rid ? { ...r, [field]: value } : r)));
  const addReference = () => setReferences((p) => [...p, newReference()]);
  const removeReference = (rid) => setReferences((p) => (p.length === 1 ? p : p.filter((r) => r.id !== rid)));

  const alreadyDispatched = outward?.dispatchState === "Dispatched" || outward?.workflowStatus === "DISPATCHED";
  const superAdmin = isSuperAdminUser();

  // After dispatch the Super admin uses Update (the full edit form, dispatch details included).
  // The warehouse manager stays here and can keep updating the dispatch details.
  useEffect(() => {
    if (!submittingRef.current && detailStatus === "succeeded" && outward && outward.id === id && alreadyDispatched && superAdmin) {
      navigate(`/outward/${id}/edit`, { replace: true });
    }
  }, [outward, id, detailStatus, alreadyDispatched, superAdmin, navigate]);

  // Dispatch details only exist once the entry is approved.
  useEffect(() => {
    // Only trust a freshly loaded entry (detailStatus "succeeded"), never a leftover copy from the
    // page the admin just came from - right after approving, the old copy still says "pending approval".
    if (detailStatus === "succeeded" && outward && outward.id === id && superAdmin && ["PENDING_APPROVAL", "REJECTED"].includes(outward.workflowStatus)) {
      toast.info("Approve this entry first, then fill the dispatch details.");
      navigate(`/outward/${id}`, { replace: true });
    }
  }, [outward, id, superAdmin, navigate, detailStatus]);

  const submitReject = async () => {
    if (!rejectReason.trim()) return toast.error("Please give a reason for rejecting.");
    setRejecting(true);
    const result = await dispatch(rejectOutward({ id, remarks: rejectReason.trim() }));
    setRejecting(false);
    if (rejectOutward.rejected.match(result)) return toast.error(result.payload || "Failed to reject.");
    toast.success(result.payload?.message || "Rejected.");
    setRejectOpen(false);
    navigate(`/outward/${id}`, { replace: true });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const refs = references
      .filter((r) => r.refDocNumber.trim() || r.ewayBillNumber.trim())
      .map((r) => ({
        refDocType: r.refDocType,
        refDocNumber: r.refDocNumber.trim(),
        ewayBillNumber: r.ewayBillNumber.trim() || undefined,
      }));
    if (!refs.length) return toast.error("Please enter at least one reference document number or E-way bill number.");
    if (!dispatchMode) return toast.error("Please select the dispatch mode.");

    setSaving(true);
    submittingRef.current = true;

    const result = await dispatch(
      dispatchOutward({
        id,
        files: stagedDocs.map((d) => ({ file: d.file, docCategory: d.docCategory })),
        payload: {
          outwardDateTime: dispatchDateTime,
          dispatchMode,
          vehicleNumber: vehicleNumber.trim() || undefined,
          remarks: remarks.trim() || undefined,
          referenceDocuments: refs,
        },
      })
    );
    setSaving(false);

    if (dispatchOutward.rejected.match(result)) {
      submittingRef.current = false;
      return toast.error(result.payload || "Failed to save dispatch details.");
    }
    toast.success(alreadyDispatched ? "Dispatch details updated." : "Dispatched successfully.");
    navigate("/outward", { replace: true });
  };

  if (detailStatus === "loading" || (detailStatus === "idle" && !outward) || (outward && outward.id !== id)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading outward entry...
      </div>
    );
  }

  // Approval stage (waiting for approval / rejected): no dispatch fields or documents yet.
  if (detailStatus === "succeeded" && superAdmin && ["PENDING_APPROVAL", "REJECTED"].includes(outward?.workflowStatus)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Opening approval...
      </div>
    );
  }

  if (detailError || !outward) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-2 text-gray-600"><ArrowLeft size={20} />Back</button>
        <div className="rounded-xl border border-red-200 bg-white p-6 text-red-600">{detailError || "Outward entry not found."}</div>
      </div>
    );
  }

  const items = outward.items || [];
  // Super admin also sees the sales side (cost, cost status, UTR, proof, approval) and can update it.
  const showCost = superAdmin;

  const handleViewProof = (itemId) => {
    dispatch(downloadItemProof({ outwardId: id, itemId })).then((result) => {
      if (downloadItemProof.rejected.match(result)) toast.error(result.payload || "Unable to open the proof file.");
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 md:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800"><ArrowLeft size={22} /></button>
            <div>
              <h1 className="text-base font-semibold text-gray-900 md:text-lg">{superAdmin ? "Outward details" : alreadyDispatched ? "Update dispatch details" : "Dispatch details"}</h1>
              <p className="text-xs text-gray-400">{outward.outwardNumber}</p>
            </div>
          </div>
          {superAdmin && (
            <div className="flex items-center gap-2">
              {!alreadyDispatched && (
                <button type="button" onClick={() => { setRejectReason(""); setRejectOpen(true); }} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 sm:text-sm">Reject</button>
              )}
              <button type="button" onClick={() => navigate(`/outward/${id}/edit`)} className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black sm:text-sm">Update</button>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Outward information</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <InfoField label="Outward number" value={outward.outwardNumber} />
              <InfoField label="Customer / Recipient" value={outward.customerName} />
              <InfoField label="Company" value={outward.companyName || outward.warehouse?.company?.name} />
              <InfoField label="Outward type" value={outward.outwardType} />
              <InfoField label="Warehouse" value={outward.warehouse?.name} />
              <InfoField label="Created by" value={outward.createdBy?.name || outward.createdBy?.email} />
              {showCost && <InfoField label="Approved by" value={outward.approvedByName} />}
              {showCost && <InfoField label="Approved on" value={outward.approvedAt ? new Date(outward.approvedAt).toLocaleString("en-IN") : "-"} />}
              {showCost && outward.approvalRemarks && <InfoField label="Approval remarks" value={outward.approvalRemarks} />}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Dispatch details</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div><label className={labelCls}>Dispatch date and time</label><input type="datetime-local" value={dispatchDateTime} onChange={(e) => setDispatchDateTime(e.target.value)} className={inputCls} /></div>
              <div>
                <label className={labelCls}>Dispatch mode</label>
                <div className="relative">
                  <select value={dispatchMode} onChange={(e) => setDispatchMode(e.target.value)} className={`${inputCls} appearance-none`}>
                    <option>By Road</option><option>Courier</option><option>Customer Pickup</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                </div>
              </div>
              <div><label className={labelCls}>Vehicle / AWB number</label><input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} placeholder="If applicable" className={inputCls} /></div>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700">Reference documents</span>
              <button type="button" onClick={addReference} className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"><Plus size={13} />Add document</button>
            </div>
            <div className="mt-2 space-y-4">
              {references.map((r, index) => (
                <div key={r.id} className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                  {references.length > 1 && (
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500">Reference document {index + 1}</span>
                      <button type="button" onClick={() => removeReference(r.id)} className="flex items-center gap-1 text-xs text-red-500"><Trash2 size={13} />Remove</button>
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <label className={labelCls}>Reference doc type</label>
                      <div className="relative">
                        <select value={r.refDocType} onChange={(e) => updateReference(r.id, "refDocType", e.target.value)} className={`${inputCls} appearance-none`}>
                          <option>Invoice</option><option>E-way Bill</option><option>Delivery Challan</option><option>Return Note</option><option>Other</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                      </div>
                    </div>
                    <div><label className={labelCls}>Reference doc no.</label><input value={r.refDocNumber} onChange={(e) => updateReference(r.id, "refDocNumber", e.target.value)} placeholder="Enter document number" className={inputCls} /></div>
                    <div><label className={labelCls}>E-way bill number</label><input value={r.ewayBillNumber} onChange={(e) => updateReference(r.id, "ewayBillNumber", e.target.value)} placeholder="If above threshold" className={inputCls} /></div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Item details</h2>
            <div className="overflow-x-auto rounded-lg border">
              <table className={`w-full text-[11px] sm:text-sm ${showCost ? "min-w-[760px]" : ""}`}>
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-gray-500">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Model</th>
                    <th className="px-3 py-2">Quantity</th>
                    <th className="px-3 py-2">UOM</th>
                    {showCost && (
                      <>
                        <th className="px-3 py-2">Cost</th>
                        <th className="px-3 py-2">Cost status</th>
                        <th className="px-3 py-2">UTR</th>
                        <th className="px-3 py-2">Proof</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={item.id || index} className="border-b last:border-0">
                      <td className="px-3 py-2">{index + 1}</td>
                      <td className="px-3 py-2">{item.category || "-"}</td>
                      <td className="px-3 py-2 font-medium">{item.sku || "-"}</td>
                      <td className="px-3 py-2">{item.quantity}</td>
                      <td className="px-3 py-2">{item.uom || "-"}</td>
                      {showCost && (
                        <>
                          <td className="px-3 py-2 font-medium">{formatMoney(item.cost)}</td>
                          <td className="px-3 py-2">{costStatusLabel(item.costStatus)}</td>
                          <td className="px-3 py-2 break-all">{item.utrNumber || "-"}</td>
                          <td className="px-3 py-2">
                            {item.hasProof ? (
                              <button type="button" onClick={() => handleViewProof(item.id)} className="inline-flex items-center gap-1 text-blue-700 hover:underline"><Paperclip size={13} /> View</button>
                            ) : "-"}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                  {showCost && items.length > 0 && (
                    <tr className="border-t bg-gray-50 font-semibold text-gray-900">
                      <td colSpan={5} className="px-3 py-2 text-right">Total cost</td>
                      <td className="px-3 py-2">{formatMoney(items.reduce((sum, i) => sum + (Number(i.cost) || 0), 0))}</td>
                      <td colSpan={3}></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <OutwardDocuments outwardId={id} documents={outward.documents || []} canManage deferred={!alreadyDispatched} stagedFiles={stagedDocs} onStagedChange={setStagedDocs} />

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <label className={labelCls}>Dispatch remarks</label>
            <textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Package condition, dispatch notes, etc." className={`${inputCls} resize-none`} />
          </section>

          <button type="submit" disabled={saving} className="w-full rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">
            {saving ? "Saving..." : alreadyDispatched ? "Update dispatch details" : "Save and mark as dispatched"}
          </button>
        </form>
      </div>

      {rejectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">Reject this outward entry?</h3>
            <p className="mt-1 text-sm text-gray-500">It becomes Rejected. You can approve it again, or Sales can fix the details and send it again.</p>
            <label className="mt-4 mb-1.5 block text-xs font-medium text-gray-500">Reason for rejecting</label>
            <textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Tell Sales what needs to be corrected" className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={rejecting} onClick={() => setRejectOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
              <button type="button" disabled={rejecting} onClick={submitReject} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">{rejecting ? "Please wait..." : "Reject"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoField({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs text-gray-500">{label}</div>
      <div className="break-words text-sm font-medium text-gray-900">{value || "-"}</div>
    </div>
  );
}
