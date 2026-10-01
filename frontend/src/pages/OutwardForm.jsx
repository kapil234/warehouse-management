import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, Paperclip, Plus, Trash2, Loader2, X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  createOutward,
  updateOutward,
  fetchOutwardById,
  uploadOutwardProof,
  resetOutwardCreateStatus,
  selectOutwardCreateStatus,
  selectCurrentOutward,
} from "../features/outward/outwardSlice";
import { fetchWarehouses, selectWarehouses } from "../features/warehouse/warehouseSlice";
import { getWarehousePermissions } from "../features/warehouse/warehousePermissions";
import { fetchCompanies, selectAllCompanies } from "../features/company/companySlice";
import { COST_STATUS_OPTIONS, formatMoney, isPlaceholder } from "../features/outward/outwardHelpers";
import useProducts from "../features/product/useProducts";
import useOutwardStock, { stockKey } from "../features/outward/useOutwardStock";
import ItemProductFields, { ItemProductNotice } from "../components/ItemProductFields";
import PartyNameField from "../components/PartyNameField";
import OutwardDocuments from "../components/OutwardDocuments";

/**
 * =========================================================
 * OUTWARD FORM  (Sales, Super admin)
 * =========================================================
 * Sales fills the customer details and the item details, including the
 * cost of every item:
 *
 *   Cost status  Completed / Partially completed  -> UTR number OR a payment
 *                                                    proof (image / file) is required
 *                Pending                          -> no payment details needed
 *
 * On submit the entry goes to the Account team. After Account approves
 * it, it goes to the warehouse manager, who fills the vehicle / dispatch
 * details. (The warehouse manager never sees cost, UTR or approval.)
 * =========================================================
 */

const makeId = () => crypto.randomUUID();
const getDateTimeLocal = (value) => {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return getDateTimeLocal();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const newItem = () => ({
  id: makeId(),
  serverId: undefined,
  category: "",
  companyName: "",
  sku: "",
  quantity: "",
  uom: "Pcs",
  cost: "",
  costStatus: "PENDING",
  utrNumber: "",
  proof: null, // a file uploaded now: { fileKey, fileName, fileType }
  keepProof: false, // editing: the proof saved earlier is still attached
  savedProofName: "",
});

const newReference = () => ({ id: makeId(), refDocType: "Invoice", refDocNumber: "", ewayBillNumber: "" });

const PROOF_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export default function OutwardForm() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { id: editId } = useParams();
  const isEdit = Boolean(editId);

  const warehouses = useSelector(selectWarehouses);
  const companies = useSelector(selectAllCompanies);
  const createStatus = useSelector(selectOutwardCreateStatus);
  const products = useProducts();

  const user = (() => { try { return JSON.parse(localStorage.getItem("user")); } catch { return null; } })();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const [outwardDateTime, setOutwardDateTime] = useState(() => getDateTimeLocal());
  const [outwardType, setOutwardType] = useState("Sale - Stock Out");
  const [customerName, setCustomerName] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [pickedWarehouseId, setPickedWarehouseId] = useState("");
  const [entryWarehouse, setEntryWarehouse] = useState(null); // edit mode: the entry's own warehouse
  const [items, setItems] = useState([newItem()]);
  // Edit mode: what this entry already held when it was opened (see availableFor).
  const [originalItems, setOriginalItems] = useState([]);
  const [rejection, setRejection] = useState(null); // { by, remarks } when Account sent it back
  const [proofUploadingId, setProofUploadingId] = useState(null);
  const [loadingEntry, setLoadingEntry] = useState(isEdit);
  // Workflow status of the entry being edited (approved entries can still be edited before dispatch).
  const [entryStatus, setEntryStatus] = useState(null);
  const alreadyApproved = isEdit && entryStatus === "PENDING_DISPATCH";

  // Before dispatch the form only holds the sales information (customer, items, cost); after
  // approving again the dispatch details are filled on the dispatch page. Once an entry is
  // dispatched, the super admin gets the whole form: sales + dispatch details + documents.
  const currentOutward = useSelector(selectCurrentOutward);
  const showDispatchSection = isEdit && isSuperAdmin && entryStatus === "DISPATCHED";
  const [dispatchMode, setDispatchMode] = useState("By Road");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [dispatchRemarks, setDispatchRemarks] = useState("");
  const [references, setReferences] = useState([newReference()]);
  const updateReference = (rid, field, value) => setReferences((p) => p.map((r) => (r.id === rid ? { ...r, [field]: value } : r)));
  const addReference = () => setReferences((p) => [...p, newReference()]);
  const removeReference = (rid) => setReferences((p) => (p.length === 1 ? p : p.filter((r) => r.id !== rid)));

  const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400";
  const labelCls = "block text-xs font-medium text-gray-500 mb-1.5";

  // ---- Companies / warehouses this user can pick from ----------------------
  useEffect(() => {
    if (isSuperAdmin) dispatch(fetchCompanies());
    dispatch(fetchWarehouses({}));
  }, [dispatch, isSuperAdmin]);

  const companyOptions = useMemo(() => {
    if (isSuperAdmin) return companies.filter((c) => c.status !== "Inactive");
    const seen = new Map();
    warehouses.forEach((w) => {
      if (w.company?.id && w.company?.name && !seen.has(w.company.id)) {
        seen.set(w.company.id, { id: w.company.id, name: w.company.name, status: w.company.status });
      }
    });
    return Array.from(seen.values()).filter((c) => c.status !== "Inactive");
  }, [companies, warehouses, isSuperAdmin]);

  const companyWarehouses = useMemo(() => {
    if (!selectedCompanyId) return [];
    return warehouses.filter((w) => (w.companyId || w.company?.id) === selectedCompanyId);
  }, [warehouses, selectedCompanyId]);

  // Only one choice? Pick it for them.
  useEffect(() => {
    if (isEdit || selectedCompanyId || companyOptions.length !== 1) return;
    setSelectedCompanyId(companyOptions[0].id);
  }, [isEdit, selectedCompanyId, companyOptions]);

  useEffect(() => {
    if (isEdit || pickedWarehouseId || companyWarehouses.length !== 1) return;
    setPickedWarehouseId(companyWarehouses[0].id);
  }, [isEdit, pickedWarehouseId, companyWarehouses]);

  const selectedWarehouse = isEdit
    ? entryWarehouse
    : companyWarehouses.find((w) => w.id === pickedWarehouseId) || null;
  const warehouseId = selectedWarehouse?.id || "";
  const companyName =
    selectedWarehouse?.company?.name || companyOptions.find((c) => c.id === selectedCompanyId)?.name || "";

  // ---- Load the entry when editing ----------------------------------------
  useEffect(() => {
    if (!editId) return;
    dispatch(fetchOutwardById(editId)).then((result) => {
      if (!fetchOutwardById.fulfilled.match(result)) {
        toast.error(result.payload || "Unable to load outward entry.");
        navigate("/outward");
        return;
      }
      const x = result.payload;
      if (!isSuperAdmin && !["PENDING_APPROVAL", "REJECTED", "PENDING_DISPATCH"].includes(x.workflowStatus)) {
        toast.error("This entry has already been dispatched and can't be edited.");
        navigate(`/outward/${editId}`, { replace: true });
        return;
      }
      if (x.warehouse) {
        setEntryWarehouse(x.warehouse);
        setSelectedCompanyId(x.warehouse.companyId || x.warehouse.company?.id || "");
        setPickedWarehouseId(x.warehouse.id);
      }
      setOutwardDateTime(getDateTimeLocal(x.refDocDate || x.createdAt));
      setOutwardType(x.outwardType || "Sale - Stock Out");
      setCustomerName(x.customerName || "");
      setItems(
        (x.items || []).map((i) => ({
          ...newItem(),
          serverId: i.id,
          category: i.category || "",
          companyName: i.companyName || "",
          sku: i.sku || "",
          quantity: String(i.quantity ?? ""),
          uom: i.uom || "Pcs",
          cost: i.cost === null || i.cost === undefined ? "" : String(i.cost),
          costStatus: i.costStatus || "PENDING",
          utrNumber: i.utrNumber || "",
          keepProof: Boolean(i.hasProof),
          savedProofName: i.proofFileName || "",
        }))
      );
      setOriginalItems(x.items || []);
      setEntryStatus(x.workflowStatus || null);
      // Prefill what the warehouse already filled (vehicle, mode, reference documents, remarks).
      if (x.dispatchMode && !isPlaceholder(x.dispatchMode)) setDispatchMode(x.dispatchMode);
      setVehicleNumber(x.vehicleNumber || "");
      setDispatchRemarks(x.remarks || "");
      const savedRefs = Array.isArray(x.referenceDocuments) ? x.referenceDocuments : [];
      if (savedRefs.length) {
        setReferences(savedRefs.map((r) => ({
          ...newReference(),
          refDocType: r.refDocType || "Invoice",
          refDocNumber: isPlaceholder(r.refDocNumber) ? "" : r.refDocNumber,
          ewayBillNumber: r.ewayBillNumber || "",
        })));
      }
      if (x.workflowStatus === "REJECTED") {
        setRejection({ by: x.approvedByName, remarks: x.approvalRemarks });
      }
      setLoadingEntry(false);
    });
  }, [dispatch, editId, navigate, isSuperAdmin]);

  // ---- Stock in the selected warehouse -------------------------------------
  // Editing: this entry's own quantities count as available again (server-side).
  const { rows: stockRows, status: stockStatus, reload: reloadStock } = useOutwardStock(warehouseId, editId);
  const stockByKey = useMemo(() => new Map(stockRows.map((r) => [stockKey(r.category, r.sku), r])), [stockRows]);
  const originalQtyByKey = useMemo(() => {
    const totals = new Map();
    for (const i of originalItems) {
      const key = stockKey(i.category, i.sku);
      totals.set(key, (totals.get(key) || 0) + (Number(i.quantity) || 0));
    }
    return totals;
  }, [originalItems]);

  // How many of this model ONE item row can still take: what the warehouse has,
  // minus what the OTHER rows on this form already take (so two rows of the same
  // model can't add up to more than the stock). An entry being edited may keep
  // the quantity it already reserved, even if stock has dropped since.
  const availableFor = (itemId, category, sku) => {
    const key = stockKey(category, sku);
    const row = stockByKey.get(key);
    const base = Math.max(row?.available || 0, originalQtyByKey.get(key) || 0);
    const takenByOthers = items.reduce(
      (sum, i) => (i.id !== itemId && stockKey(i.category, i.sku) === key ? sum + (Number(i.quantity) || 0) : sum),
      0
    );
    return { available: Math.max(base - takenByOthers, 0), uom: row?.uom || "" };
  };

  const stockBlockReason = !warehouseId
    ? "Select warehouse first"
    : stockStatus === "failed"
      ? "Couldn't load stock"
      : stockStatus !== "succeeded"
        ? "Loading stock..."
        : "";

  const permissions = getWarehousePermissions(user, selectedWarehouse || warehouseId);
  const operationBlocked =
    !selectedWarehouse || selectedWarehouse.company?.status === "Inactive" || selectedWarehouse.Outward !== "Active";

  // ---- Items ---------------------------------------------------------------
  const updateItem = (id, field, value) => setItems((p) => p.map((i) => {
    if (i.id !== id) return i;
    // Picking a different category / SKU means a different product, so the
    // (hidden) company carried over from an older entry no longer applies.
    // The quantity is cleared too: it was typed against the previous model's stock limit.
    if (field === "category") return { ...i, category: value, sku: "", companyName: "", quantity: "" };
    if (field === "sku") return { ...i, sku: value, companyName: "", quantity: "" };
    return { ...i, [field]: value };
  }));
  const patchItem = (id, patch) => setItems((p) => p.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const addItem = () => setItems((p) => [...p, newItem()]);
  const removeItem = (id) => setItems((p) => (p.length === 1 ? p : p.filter((i) => i.id !== id)));

  const handleProofPick = async (itemId, file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error("File size must be less than 10 MB.");
    if (!PROOF_TYPES.includes(file.type)) return toast.error("Only PDF, JPG, PNG and WEBP files are allowed.");

    setProofUploadingId(itemId);
    const result = await dispatch(uploadOutwardProof({ file }));
    setProofUploadingId(null);
    if (uploadOutwardProof.fulfilled.match(result)) {
      patchItem(itemId, { proof: result.payload, keepProof: false });
    } else {
      toast.error(result.payload || "Failed to upload the file.");
    }
  };

  const removeProof = (itemId) => patchItem(itemId, { proof: null, keepProof: false, savedProofName: "" });

  const total = items.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCompanyId) return toast.error("Please select a company.");
    if (!warehouseId) return toast.error("Please select a warehouse.");
    if (operationBlocked || !permissions.canOutward) return toast.error("Outward is not available for this warehouse.");
    if (!customerName.trim()) return toast.error("Please enter customer / recipient name.");
    if (!companyName.trim()) return toast.error("Company name is missing.");

    for (const [index, item] of items.entries()) {
      const label = `Item ${index + 1}`;
      if (!item.category) return toast.error(`${label}: please select a category.`);
      if (!item.sku.trim()) return toast.error(`${label}: please select SKU / model.`);
      if (Number(item.quantity) <= 0) return toast.error(`${label}: please enter a valid quantity.`);
      if (!item.uom) return toast.error(`${label}: please select UOM.`);
      if (item.cost === "" || !Number.isFinite(Number(item.cost)) || Number(item.cost) < 0) {
        return toast.error(`${label}: please enter the cost.`);
      }
      if (!item.costStatus) return toast.error(`${label}: please select the cost status.`);
      if (item.costStatus !== "PENDING" && !item.utrNumber.trim() && !item.proof && !item.keepProof) {
        return toast.error(`${label}: enter the UTR number or attach a payment proof (image / file).`);
      }
    }

    // Can't dispatch more than is in stock. (The server checks again when saving.)
    if (stockStatus !== "succeeded") return toast.error("Available stock hasn't loaded yet. Please wait a moment (or reload the page) and try again.");
    for (const item of items) {
      const { available, uom } = availableFor(item.id, item.category, item.sku);
      if (Number(item.quantity) > available) {
        return toast.error(
          available <= 0
            ? `"${item.sku}" is out of stock in this warehouse.`
            : `Not enough stock for "${item.sku}": only ${available}${uom ? ` ${uom}` : ""} available for this item.`
        );
      }
    }

    const payload = {
      warehouseId,
      companyId: selectedCompanyId,
      outwardType,
      outwardDateTime,
      customerName: customerName.trim(),
      companyName: companyName.trim(),
      items: items.map((i) => {
        const paid = i.costStatus !== "PENDING";
        return {
          serverId: i.serverId,
          category: i.category,
          companyName: i.companyName?.trim() || undefined,
          sku: i.sku.trim(),
          quantity: Number(i.quantity),
          uom: i.uom,
          cost: Number(i.cost),
          costStatus: i.costStatus,
          utrNumber: paid ? i.utrNumber.trim() || undefined : undefined,
          proofFileKey: paid ? i.proof?.fileKey : undefined,
          proofFileName: paid ? i.proof?.fileName : undefined,
          proofFileType: paid ? i.proof?.fileType : undefined,
          keepProof: paid && !i.proof && i.keepProof,
        };
      }),
    };

    if (showDispatchSection) {
      const refs = references
        .filter((r) => r.refDocNumber.trim() || r.ewayBillNumber.trim())
        .map((r) => ({ refDocType: r.refDocType, refDocNumber: r.refDocNumber.trim(), ewayBillNumber: r.ewayBillNumber.trim() || undefined }));
      if (entryStatus === "DISPATCHED") {
        if (!refs.length) return toast.error("Please enter at least one reference document number or E-way bill number.");
        if (!dispatchMode) return toast.error("Please select the dispatch mode.");
      }
      payload.dispatch = {
        dispatchMode,
        vehicleNumber: vehicleNumber.trim() || undefined,
        remarks: dispatchRemarks.trim() || undefined,
        referenceDocuments: refs,
      };
    }

    const result = isEdit
      ? await dispatch(updateOutward({ id: editId, payload }))
      : await dispatch(createOutward(payload));
    const failed = isEdit ? updateOutward.rejected.match(result) : createOutward.rejected.match(result);
    if (failed) return toast.error(result.payload?.message || "Failed to save outward entry.");

    toast.success(result.payload?.message || "Outward entry submitted for account approval.");
    dispatch(resetOutwardCreateStatus());
    // replace (not push) so a successful save doesn't leave the form in browser history.
    const savedStatus = result.payload?.data?.workflowStatus;
    // Super admin + an approved entry waiting for dispatch goes straight to the dispatch form.
    const target = isEdit ? (isSuperAdmin && savedStatus === "PENDING_DISPATCH" ? `/outward/${editId}/dispatch` : `/outward/${editId}`) : "/outward";
    navigate(target, { replace: true });
  };

  const saving = createStatus === "loading";

  if (loadingEntry) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading outward entry...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 md:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800"><ArrowLeft size={22} /></button>
          <div>
            <h1 className="text-base font-semibold text-gray-900 md:text-lg">{isEdit ? "Edit outward entry" : "New outward entry"}</h1>
            <p className="text-xs text-gray-400">
              {isEdit
                ? "Update the details and send them for approval again"
                : "Fill the customer and item details. It goes to the Account team for approval."}
            </p>
          </div>
        </div>

        {alreadyApproved && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            This entry is approved and waiting for dispatch. Saving any change sends it back to the Account team for approval, and the warehouse will not see it until it is approved again.
          </div>
        )}
        {rejection && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-semibold">Rejected by Account{rejection.by ? ` (${rejection.by})` : ""}</p>
            {rejection.remarks && <p className="mt-1">Reason: {rejection.remarks}</p>}
            <p className="mt-1 text-xs text-red-600">Fix the details below and save to send it for approval again.</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Company & Warehouse</h2>
            {isEdit ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div><label className={labelCls}>Company</label><div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">{companyName || "-"}</div></div>
                <div><label className={labelCls}>Warehouse</label><div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">{selectedWarehouse?.name || "-"}</div></div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelCls}>Company</label>
                  <div className="relative">
                    <select
                      value={selectedCompanyId}
                      onChange={(e) => { setSelectedCompanyId(e.target.value); setPickedWarehouseId(""); }}
                      className={`${inputCls} appearance-none bg-white`}
                    >
                      <option value="">Select company</option>
                      {companyOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Warehouse</label>
                  <div className="relative">
                    <select
                      value={pickedWarehouseId}
                      disabled={!selectedCompanyId}
                      onChange={(e) => setPickedWarehouseId(e.target.value)}
                      className={`${inputCls} appearance-none bg-white disabled:bg-gray-100 disabled:text-gray-400`}
                    >
                      <option value="">{selectedCompanyId ? "Select warehouse" : "Select company first"}</option>
                      {companyWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  </div>
                </div>
              </div>
            )}
            {selectedWarehouse && operationBlocked && (
              <p className="mt-3 text-xs text-red-600">Outward is disabled for this warehouse or its company.</p>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Customer details</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div><label className={labelCls}>Outward date and time</label><input type="datetime-local" value={outwardDateTime} onChange={(e) => setOutwardDateTime(e.target.value)} className={inputCls} /></div>
              <div>
                <label className={labelCls}>Outward type</label>
                <div className="relative">
                  <select value={outwardType} onChange={(e) => setOutwardType(e.target.value)} className={`${inputCls} appearance-none`}>
                    <option>Sale - Stock Out</option><option>Service - Stock Out</option><option>Return to Vendor</option><option>Damage / Scrap Out</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                </div>
              </div>
            </div>
            <div className="mt-4">
              <PartyNameField value={customerName} onChange={setCustomerName} storageKey="outward-customer-names" label="Customer / Recipient name" labelCls={labelCls} inputCls={inputCls} placeholder="Enter customer / recipient name" addLabel="+ Add new customer / recipient" />
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Item details</h2>
              <button type="button" onClick={addItem} className="flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700"><Plus size={14} />Add item</button>
            </div>
            <ItemProductNotice isAdmin={isSuperAdmin} />
            {warehouseId && stockStatus === "failed" ? (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <span>Couldn't load the available stock for this warehouse.</span>
                <button type="button" onClick={reloadStock} className="font-semibold underline">Retry</button>
              </div>
            ) : (
              <p className="mb-3 text-xs text-gray-500">Only models that are in stock in the selected warehouse can be sent out, and the quantity can't be more than what is available.</p>
            )}

            <div className="space-y-4">
              {items.map((item, index) => {
                const stockInfo = item.sku ? availableFor(item.id, item.category, item.sku) : null;
                const overLimit = stockInfo && Number(item.quantity) > stockInfo.available;
                const paid = item.costStatus !== "PENDING";
                const hasProof = Boolean(item.proof) || item.keepProof;
                const proofName = item.proof?.fileName || item.savedProofName || "Payment proof";
                const uploading = proofUploadingId === item.id;

                return (
                  <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500">Item {index + 1}</span>
                      {items.length > 1 && <button type="button" onClick={() => removeItem(item.id)} className="flex items-center gap-1 text-xs text-red-500"><Trash2 size={13} />Delete item</button>}
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-12">
                      <ItemProductFields item={item} products={products} onChange={(field, value) => updateItem(item.id, field, value)} inputCls={inputCls} labelCls={labelCls} categoryClass="md:col-span-3" skuClass="md:col-span-5" getStock={(category, sku) => availableFor(item.id, category, sku)} stockBlockReason={stockBlockReason} />
                      <div className="md:col-span-2">
                        <label className={labelCls}>Quantity</label>
                        <input
                          type="number"
                          min="1"
                          max={stockInfo ? stockInfo.available : undefined}
                          value={item.quantity}
                          onChange={(e) => {
                            let value = e.target.value;
                            // Never let the quantity go above what is available.
                            if (stockInfo && value !== "" && Number(value) > stockInfo.available) value = String(stockInfo.available);
                            updateItem(item.id, "quantity", value);
                          }}
                          placeholder="0"
                          className={`${inputCls} ${overLimit ? "border-red-400" : ""}`}
                        />
                        {stockInfo && stockStatus === "succeeded" && (
                          <p className={`mt-1 text-[11px] ${overLimit || stockInfo.available <= 0 ? "text-red-600" : "text-gray-400"}`}>
                            {stockInfo.available <= 0 ? "Out of stock" : overLimit ? `Only ${stockInfo.available} available` : `Max ${stockInfo.available}${stockInfo.uom ? ` ${stockInfo.uom}` : ""}`}
                          </p>
                        )}
                      </div>
                      <div className="md:col-span-2">
                        <label className={labelCls}>UOM</label>
                        <select value={item.uom} onChange={(e) => updateItem(item.id, "uom", e.target.value)} className={`${inputCls} appearance-none`}>
                          <option>Pcs</option><option>Meters</option><option>Bundles</option>
                        </select>
                      </div>
                    </div>

                    {/* Cost side - this part is never shown to the warehouse manager. */}
                    <div className="mt-4 border-t border-gray-100 pt-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className={labelCls}>Cost (₹)</label>
                          <input type="number" min="0" step="0.01" value={item.cost} onChange={(e) => updateItem(item.id, "cost", e.target.value)} placeholder="0.00" className={inputCls} />
                        </div>
                        <div>
                          <label className={labelCls}>Cost status</label>
                          <div className="relative">
                            <select value={item.costStatus} onChange={(e) => updateItem(item.id, "costStatus", e.target.value)} className={`${inputCls} appearance-none`}>
                              {COST_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                          </div>
                        </div>
                      </div>

                      {paid && (
                        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div>
                            <label className={labelCls}>UTR number</label>
                            <input value={item.utrNumber} onChange={(e) => updateItem(item.id, "utrNumber", e.target.value)} placeholder="Enter UTR number" className={inputCls} />
                          </div>
                          <div>
                            <label className={labelCls}>Payment proof (image / file)</label>
                            {hasProof ? (
                              <div className="flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700">
                                <span className="flex min-w-0 items-center gap-2"><Paperclip size={15} className="shrink-0" /><span className="truncate">{proofName}</span></span>
                                <button type="button" onClick={() => removeProof(item.id)} title="Remove" className="shrink-0 text-green-700 hover:text-red-600"><X size={16} /></button>
                              </div>
                            ) : (
                              <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-blue-300 bg-white px-3 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-50 ${uploading ? "pointer-events-none opacity-60" : ""}`}>
                                {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
                                {uploading ? "Uploading..." : "Attach file"}
                                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={uploading} onChange={(e) => { handleProofPick(item.id, e.target.files?.[0]); e.target.value = ""; }} />
                              </label>
                            )}
                          </div>
                          <p className="text-[11px] text-gray-500 sm:col-span-2">
                            {item.costStatus === "COMPLETED" ? "Completed" : "Partially completed"} needs the UTR number or a payment proof (either one is enough).
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 text-sm">
              <span className="font-medium text-gray-600">Total cost</span>
              <span className="font-semibold text-gray-900">{formatMoney(total)}</span>
            </div>
          </section>

          {showDispatchSection && (
            <>
              <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
                <h2 className="mb-4 text-sm font-semibold text-gray-900">Dispatch details</h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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

              <OutwardDocuments outwardId={editId} documents={currentOutward?.documents || []} canManage />

              <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
                <label className={labelCls}>Dispatch remarks</label>
                <textarea rows={3} value={dispatchRemarks} onChange={(e) => setDispatchRemarks(e.target.value)} placeholder="Package condition, dispatch notes, etc." className={`${inputCls} resize-none`} />
              </section>
            </>
          )}

          <button type="submit" disabled={saving || proofUploadingId !== null} className="w-full rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">
            {saving ? "Saving..." : isEdit ? "Save and send for approval" : "Submit for approval"}
          </button>
        </form>
      </div>
    </div>
  );
}
