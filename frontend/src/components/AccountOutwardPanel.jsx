import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Pause, Plus, Trash2, X } from "lucide-react";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";
import { saveAccountDocuments } from "../features/outward/outwardSlice";
import {
  ACCOUNT_REF_TYPES,
  ACCOUNT_DOC_PREFIX,
  EWAY_BILL_THRESHOLD,
  isAccountRef,
  isAccountDocCategory,
  isAboveEwayLimit,
  hasEwayBill,
  isPlaceholder,
  refTypeLabel,
  refTypeDocument,
  refNumberLabel,
} from "../features/outward/outwardHelpers";
import OutwardDocuments from "./OutwardDocuments";

/**
 * =========================================================
 * ACCOUNT: reference documents + documents  (Account team)
 * =========================================================
 * Account adds the reference documents - Invoice, E-way Bill, DC Challan (challan no. + vehicle no.) or
 * Other - and, if it wants, uploads the matching document. Every reference type that is chosen gets its own
 * row in the Documents section, but uploading is never compulsory.
 *
 * One exception: when the PI amount is above Rs. 1,00,000 the e-way bill is needed - either the e-way bill
 * number (reference type "E-way Bill") or the e-way bill document - before the entry can be approved.
 *
 * Approve / Reject / Hold: whatever is typed or picked is saved first. Only until dispatch.
 * The warehouse manager has its own reference documents (delivery challan, return note, other)
 * and sees these ones read-only.
 * =========================================================
 */

const newReference = () => ({ id: crypto.randomUUID(), refDocType: "Invoice", refDocNumber: "", ewayBillNumber: "", vehicleNumber: "" });

const fromServer = (outward) => {
  const saved = (Array.isArray(outward?.referenceDocuments) ? outward.referenceDocuments : []).filter(isAccountRef);
  return saved.length
    ? saved.map((r) => ({
        ...newReference(),
        refDocType: ACCOUNT_REF_TYPES.includes(r.refDocType) ? r.refDocType : "Invoice",
        refDocNumber: isPlaceholder(r.refDocNumber) ? "" : r.refDocNumber,
        ewayBillNumber: r.ewayBillNumber || "", // older entries: kept as saved
        vehicleNumber: r.vehicleNumber || "",
      }))
    : [newReference()];
};

// Comparable form of the rows (ignores empty rows), used to know if anything is unsaved.
const signature = (rows) =>
  JSON.stringify(
    rows
      .filter((r) => String(r.refDocNumber || "").trim() || String(r.ewayBillNumber || "").trim())
      .map((r) => [
        r.refDocType,
        String(r.refDocNumber || "").trim(),
        String(r.ewayBillNumber || "").trim(),
        r.refDocType === "DC Challan" ? String(r.vehicleNumber || "").trim() : "",
      ])
  );

export default function AccountOutwardPanel({ outwardId, outward, editable, canApprove = false, canReject = false, canHold = false, onDecision }) {
  const dispatch = useDispatch();
  const [references, setReferences] = useState(() => fromServer(outward));
  const [stagedDocs, setStagedDocs] = useState([]);
  const [saving, setSaving] = useState(false);
  const loadedForRef = useRef(outwardId);

  const serverSignature = useMemo(
    () => signature(fromServer(outward)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outward?.referenceDocuments]
  );

  // A different entry was opened: start again from what the server holds.
  useEffect(() => {
    if (loadedForRef.current === outwardId) return;
    loadedForRef.current = outwardId;
    setReferences(fromServer(outward));
    setStagedDocs([]);
  }, [outwardId, outward]);

  const dirty = editable && (stagedDocs.length > 0 || signature(references) !== serverSignature);
  const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400";
  const labelCls = "block text-sm font-semibold text-black mb-1.5";

  const updateReference = (rid, field, value) => setReferences((p) => p.map((r) => (r.id === rid ? { ...r, [field]: value } : r)));
  const addReference = () => setReferences((p) => [...p, newReference()]);
  const removeReference = (rid) => setReferences((p) => (p.length === 1 ? [newReference()] : p.filter((r) => r.id !== rid)));

  const accountDocs = (outward?.documents || []).filter((d) => isAccountDocCategory(d.docCategory));
  const readOnlyRefs = (Array.isArray(outward?.referenceDocuments) ? outward.referenceDocuments : []).filter(isAccountRef);

  // The Documents section shows one (optional) row for each reference type that is chosen.
  const aboveLimit = isAboveEwayLimit(outward?.piAmount);
  const documentSlots = useMemo(() => {
    const slots = [];
    for (const r of references) {
      const slot = refTypeDocument(r.refDocType);
      if (slot && !slots.includes(slot)) slots.push(slot);
    }
    if (aboveLimit && !slots.includes("E-way bill")) slots.push("E-way bill");
    return slots;
  }, [references, aboveLimit]);

  const ewayProvided = hasEwayBill(references, accountDocs, stagedDocs);
  const EWAY_MESSAGE = `The PI amount is above ₹${EWAY_BILL_THRESHOLD.toLocaleString("en-IN")}: add the e-way bill number (reference type E-way Bill) or upload the e-way bill document before approving.`;

  const handleSave = async () => {
    if (saving) return false;
    const refs = references
      .filter((r) => r.refDocNumber.trim() || r.ewayBillNumber.trim())
      .map((r) => ({
        refDocType: r.refDocType,
        refDocNumber: r.refDocNumber.trim(),
        ewayBillNumber: r.ewayBillNumber.trim() || undefined,
        vehicleNumber: r.refDocType === "DC Challan" ? r.vehicleNumber.trim() || undefined : undefined,
      }));

    setSaving(true);
    const result = await dispatch(
      saveAccountDocuments({
        id: outwardId,
        files: stagedDocs.map((d) => ({ file: d.file, docCategory: d.docCategory })),
        payload: { referenceDocuments: refs },
      })
    );
    setSaving(false);

    if (saveAccountDocuments.rejected.match(result)) {
      toast.error(result.payload || "Failed to save documents.");
      return false;
    }
    const saved = result.payload?.data;
    setStagedDocs([]);
    setReferences(fromServer(saved));
    return true;
  };

  // Approve / Reject / Hold: anything typed or picked above is saved first.
  const handleDecision = async (type) => {
    if (type === "approve" && aboveLimit && !ewayProvided) return toast.error(EWAY_MESSAGE);
    if (dirty && !(await handleSave())) return;
    onDecision?.(type);
  };

  // ---------------- read-only (after dispatch) ----------------
  if (!editable) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl border p-4 sm:p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4 sm:text-lg">Reference documents</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-gray-500">
                  <th className="py-2 px-3">Document type</th>
                  <th className="py-2 px-3">Reference no.</th>
                  <th className="py-2 px-3">Vehicle no.</th>
                  <th className="py-2 px-3">E-way bill no.</th>
                </tr>
              </thead>
              <tbody>
                {readOnlyRefs.map((r, i) => (
                  <tr key={r.id || i} className="border-b last:border-0">
                    <td className="py-2 px-3">{refTypeLabel(r.refDocType)}</td>
                    <td className="py-2 px-3">{r.refDocNumber || "-"}</td>
                    <td className="py-2 px-3">{r.vehicleNumber || "-"}</td>
                    <td className="py-2 px-3">{r.ewayBillNumber || "-"}</td>
                  </tr>
                ))}
                {readOnlyRefs.length === 0 && (
                  <tr><td colSpan={4} className="py-4 text-center text-gray-500">No reference documents</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <OutwardDocuments
          outwardId={outwardId}
          documents={accountDocs}
          requiredDocuments={[]}
          title="Documents"
          subtitle="Invoice, e-way bill, DC challan and other account documents"
        />
      </div>
    );
  }

  // ---------------- editable (until dispatch) ----------------
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900 sm:text-lg">Reference documents</h2>
            <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">Invoice, e-way bill, DC challan or other references added by the account team</p>
          </div>
          <button
            type="button"
            onClick={addReference}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
          >
            <Plus size={13} />Add document
          </button>
        </div>

        {aboveLimit && (
          <div
            className={`mb-4 rounded-lg border px-3 py-2.5 text-xs sm:text-sm ${
              ewayProvided ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {ewayProvided
              ? "E-way bill provided (the PI amount is above ₹1,00,000)."
              : `${EWAY_MESSAGE.replace(" before approving.", ".")} Required before approving.`}
          </div>
        )}

        <div className="space-y-4">
          {references.map((r, index) => (
            <div key={r.id} className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
              {references.length > 1 && (
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-black">Reference document {index + 1}</span>
                  <button type="button" onClick={() => removeReference(r.id)} className="flex items-center gap-1 text-xs text-red-500"><Trash2 size={13} />Remove</button>
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className={labelCls}>Reference doc type</label>
                  <div className="relative">
                    <select value={r.refDocType} onChange={(e) => updateReference(r.id, "refDocType", e.target.value)} className={`${inputCls} appearance-none`}>
                      {ACCOUNT_REF_TYPES.map((t) => <option key={t} value={t}>{refTypeLabel(t)}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>{refNumberLabel(r.refDocType)}</label>
                  <input value={r.refDocNumber} onChange={(e) => updateReference(r.id, "refDocNumber", e.target.value)} placeholder="Enter document number" className={inputCls} />
                </div>
                {r.refDocType === "DC Challan" && (
                  <div>
                    <label className={labelCls}>Vehicle no.</label>
                    <input value={r.vehicleNumber} onChange={(e) => updateReference(r.id, "vehicleNumber", e.target.value)} placeholder="Enter vehicle number" className={inputCls} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <OutwardDocuments
        outwardId={outwardId}
        documents={accountDocs}
        canManage
        deferred
        stagedFiles={stagedDocs}
        onStagedChange={setStagedDocs}
        requiredDocuments={[]}
        optionalDocuments={documentSlots}
        addMenuTypes={["Invoice", "E-way bill", "DC challan", "Other"]}
        otherPrefix={ACCOUNT_DOC_PREFIX}
        showSummary={false}
        title="Documents"
        subtitle="One row for each reference document above. Uploading is optional. Files are saved when you approve, hold or reject."
      />

      <div className="flex flex-wrap items-center justify-end gap-3">
        {dirty && !canApprove && (
          <button
            type="button"
            onClick={async () => { if (await handleSave()) toast.success("Documents saved."); }}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            {saving && <Loader2 size={16} className="animate-spin" />} Save documents
          </button>
        )}
        {canReject && (
          <button
            type="button"
            onClick={() => handleDecision("reject")}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-5 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <X size={16} /> Reject
          </button>
        )}
        {canHold && (
          <button
            type="button"
            onClick={() => handleDecision("hold")}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-purple-200 bg-white px-5 py-2.5 text-sm font-semibold text-purple-700 hover:bg-purple-50 disabled:opacity-50"
          >
            <Pause size={16} /> Hold
          </button>
        )}
        {canApprove && (
          <button
            type="button"
            onClick={() => handleDecision("approve")}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Approve
          </button>
        )}
      </div>
    </div>
  );
}
