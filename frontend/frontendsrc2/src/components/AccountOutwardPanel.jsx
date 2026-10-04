import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, Trash2, X } from "lucide-react";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";
import { saveAccountDocuments } from "../features/outward/outwardSlice";
import {
  ACCOUNT_REF_TYPES,
  ACCOUNT_REQUIRED_DOCUMENTS,
  ACCOUNT_DOC_PREFIX,
  isAccountRef,
  isAccountDocCategory,
  isPlaceholder,
} from "../features/outward/outwardHelpers";
import OutwardDocuments from "./OutwardDocuments";

/**
 * =========================================================
 * ACCOUNT: reference documents + documents  (Account team)
 * =========================================================
 * Account adds the invoice / e-way bill / other reference documents and uploads
 * the e-way bill (plus any other account document with "Add document").
 * Everything is saved together with the Save button, and only until dispatch.
 * The warehouse manager has its own reference documents (delivery challan, return
 * note, other) and sees these ones read-only.
 * =========================================================
 */

const newReference = () => ({ id: crypto.randomUUID(), refDocType: "Invoice", refDocNumber: "", ewayBillNumber: "" });

const fromServer = (outward) => {
  const saved = (Array.isArray(outward?.referenceDocuments) ? outward.referenceDocuments : []).filter(isAccountRef);
  return saved.length
    ? saved.map((r) => ({
        ...newReference(),
        // An old "E-way Bill" reference is shown as Invoice (its e-way bill number is kept).
        refDocType: ACCOUNT_REF_TYPES.includes(r.refDocType) ? r.refDocType : "Invoice",
        refDocNumber: isPlaceholder(r.refDocNumber) ? "" : r.refDocNumber,
        ewayBillNumber: r.ewayBillNumber || "",
      }))
    : [newReference()];
};

// Comparable form of the rows (ignores empty rows), used to know if anything is unsaved.
const signature = (rows) =>
  JSON.stringify(
    rows
      .filter((r) => String(r.refDocNumber || "").trim() || String(r.ewayBillNumber || "").trim())
      .map((r) => [r.refDocType, String(r.refDocNumber || "").trim(), String(r.ewayBillNumber || "").trim()])
  );

export default function AccountOutwardPanel({ outwardId, outward, editable, canApprove = false, canReject = false, onDecision }) {
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
  const labelCls = "block text-xs font-medium text-gray-500 mb-1.5";

  const updateReference = (rid, field, value) => setReferences((p) => p.map((r) => (r.id === rid ? { ...r, [field]: value } : r)));
  const addReference = () => setReferences((p) => [...p, newReference()]);
  const removeReference = (rid) => setReferences((p) => (p.length === 1 ? [newReference()] : p.filter((r) => r.id !== rid)));

  const accountDocs = (outward?.documents || []).filter((d) => isAccountDocCategory(d.docCategory));
  const readOnlyRefs = (Array.isArray(outward?.referenceDocuments) ? outward.referenceDocuments : []).filter(isAccountRef);

  const handleSave = async () => {
    if (saving) return false;
    const refs = references
      .filter((r) => r.refDocNumber.trim() || r.ewayBillNumber.trim())
      .map((r) => ({
        refDocType: r.refDocType,
        refDocNumber: r.refDocNumber.trim(),
        ewayBillNumber: r.ewayBillNumber.trim() || undefined,
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

  // Approve / Reject: anything typed or picked above is saved first, so Account can approve with or without an invoice.
  const handleDecision = async (type) => {
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
                  <th className="py-2 px-3">E-way bill no.</th>
                </tr>
              </thead>
              <tbody>
                {readOnlyRefs.map((r, i) => (
                  <tr key={r.id || i} className="border-b last:border-0">
                    <td className="py-2 px-3">{r.refDocType}</td>
                    <td className="py-2 px-3">{r.refDocNumber || "-"}</td>
                    <td className="py-2 px-3">{r.ewayBillNumber || "-"}</td>
                  </tr>
                ))}
                {readOnlyRefs.length === 0 && (
                  <tr><td colSpan={3} className="py-4 text-center text-gray-500">No reference documents</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <OutwardDocuments
          outwardId={outwardId}
          documents={accountDocs}
          requiredDocuments={ACCOUNT_REQUIRED_DOCUMENTS}
          title="Documents"
          subtitle="Invoice and other account documents"
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
            <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">Invoice and other references added by the account team</p>
          </div>
          <button
            type="button"
            onClick={addReference}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
          >
            <Plus size={13} />Add document
          </button>
        </div>

        <div className="space-y-4">
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
                      {ACCOUNT_REF_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Reference doc no.</label>
                  <input value={r.refDocNumber} onChange={(e) => updateReference(r.id, "refDocNumber", e.target.value)} placeholder="Enter document number" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>E-way bill number</label>
                  <input value={r.ewayBillNumber} onChange={(e) => updateReference(r.id, "ewayBillNumber", e.target.value)} placeholder="If above threshold" className={inputCls} />
                </div>
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
        requiredDocuments={ACCOUNT_REQUIRED_DOCUMENTS}
        addMenuTypes={["Invoice", "Other"]}
        otherPrefix={ACCOUNT_DOC_PREFIX}
        showSummary={false}
        title="Documents"
        subtitle="Upload the invoice, or use Add document for another invoice or other file. They are saved when you approve or reject."
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
