import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Calendar, ChevronDown, Check, FileText, X, Upload, Plus, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  createOutward,
  updateOutward,
  fetchOutwardById,
  uploadOutwardDocument,
  resetOutwardCreateStatus,
  fetchOutwardModels,
  createOutwardModel,
  fetchOutwardCompanies,
  createOutwardCompany,
  selectOutwardCreateStatus,
  selectOutwardUploadingDocs,
} from "../features/outward/outwardSlice";
import { fetchWarehouses, selectWarehouses, selectSelectedWarehouse, setSelectedWarehouse } from "../features/warehouse/warehouseSlice";
import { getWarehousePermissions } from "../features/warehouse/warehousePermissions";
import { fetchCompanies, selectAllCompanies } from "../features/company/companySlice";

const makeId = () => crypto.randomUUID();
const getDateTimeLocal = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const newReference = () => ({ id: makeId(), refDocType: "Invoice", refDocNumber: "", ewayBillNumber: "" });
const helperKey = (category, companyName) => `${category}::${companyName || ""}`;
const newItem = () => ({ id: makeId(), category: "Inverters", companyName: "", sku: "", quantity: "", uom: "Pcs" });
const newDoc = (type = "Invoice", name = "") => ({ id: makeId(), type, name, file: null });

const DEFAULT_DOCS = [
  newDoc("Delivery challan", "Delivery challan"),
  newDoc("E-way bill", "E-way bill"),
  newDoc("Dispatch photo", "Dispatch photo"),
];

export default function OutwardForm() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { id: editId } = useParams();
  const isEdit = Boolean(editId);

  const warehouses = useSelector(selectWarehouses);
  const selectedWarehouse = useSelector(selectSelectedWarehouse);
  const companies = useSelector(selectAllCompanies);
  const createStatus = useSelector(selectOutwardCreateStatus);
  const uploadingDocs = useSelector(selectOutwardUploadingDocs);

  const user = (() => { try { return JSON.parse(localStorage.getItem("user")); } catch { return null; } })();
  const [outwardDateTime, setOutwardDateTime] = useState(getDateTimeLocal);
  const [outwardType, setOutwardType] = useState("Sale - Stock Out");
  const [customerName, setCustomerName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [references, setReferences] = useState([newReference()]);
  const [items, setItems] = useState([newItem()]);
  // Keyed as `${category}::${companyName}` -> array of model names,
  // same scoping the inward form uses: nothing shows until an item's
  // Company is selected.
  const [models, setModels] = useState({});
  const [newModelFor, setNewModelFor] = useState(null);
  const [newModelName, setNewModelName] = useState("");
  const [companyOptions, setCompanyOptions] = useState([]);
  const [newCompanyFor, setNewCompanyFor] = useState(null);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [dispatchMode, setDispatchMode] = useState("By Road");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [documents, setDocuments] = useState(DEFAULT_DOCS);
  const [showDocumentMenu, setShowDocumentMenu] = useState(false);
  const [remarks, setRemarks] = useState("");

  const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400";
  const labelCls = "block text-xs font-medium text-gray-500 mb-1.5";

  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  useEffect(() => {
    if (!isSuperAdmin) return;
    dispatch(fetchCompanies());
    dispatch(fetchWarehouses(selectedCompanyId ? { companyId: selectedCompanyId } : {}));
    if (!isEdit) dispatch(setSelectedWarehouse(null));
  }, [dispatch, selectedCompanyId, user?.role, isEdit]);

  useEffect(() => {
    if (!isSuperAdmin && selectedWarehouse) {
      const companyId = selectedWarehouse.companyId || selectedWarehouse.company?.id || "";
      setSelectedCompanyId(companyId);
      setCompanyName(selectedWarehouse.company?.name || "");
    }
  }, [isSuperAdmin, selectedWarehouse?.id]);

  const topCompanyOptions = useMemo(() => {
    if (user?.role === "SUPER_ADMIN") return companies.filter((c) => c.status !== "Inactive");
    const seen = new Map();
    warehouses.forEach((w) => {
      if (w.company?.id && w.company?.name && !seen.has(w.company.id)) seen.set(w.company.id, { id: w.company.id, name: w.company.name, status: w.company.status });
    });
    return Array.from(seen.values()).filter((c) => c.status !== "Inactive");
  }, [companies, warehouses, user?.role]);

  const companyWarehouses = useMemo(() => {
    if (!selectedCompanyId) return [];
    return warehouses.filter((w) => (w.companyId || w.company?.id) === selectedCompanyId);
  }, [warehouses, selectedCompanyId]);

  useEffect(() => {
    if (isSuperAdmin && !isEdit && selectedCompanyId) {
      if (!selectedWarehouse || (selectedWarehouse.companyId || selectedWarehouse.company?.id) !== selectedCompanyId) {
        dispatch(setSelectedWarehouse(null));
      }
    }
  }, [dispatch, isEdit, selectedCompanyId, isSuperAdmin]);
  useEffect(() => {
    if (!editId) return;
    dispatch(fetchOutwardById(editId)).then((result) => {
      if (!fetchOutwardById.fulfilled.match(result)) {
        alert(result.payload || "Unable to load outward entry.");
        navigate("/outward");
        return;
      }
      const x = result.payload;
      if (x.warehouse) {
        dispatch(setSelectedWarehouse(x.warehouse));
        setSelectedCompanyId(x.warehouse.companyId || x.warehouse.company?.id || "");
      }
      const dt = x.outwardDateTime || x.refDocDate || x.createdAt;
      if (dt) {
        const d = new Date(dt);
        if (!Number.isNaN(d.getTime())) {
          const p = (n) => String(n).padStart(2, "0");
          setOutwardDateTime(`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`);
        }
      }
      setOutwardType(x.outwardType || "Sale - Stock Out");
      setCustomerName(x.customerName || "");
      setCompanyName(x.warehouse?.company?.name || x.companyName || "");
      const refs = Array.isArray(x.referenceDocuments) && x.referenceDocuments.length
        ? x.referenceDocuments
        : [{ refDocType: x.refDocType || "Invoice", refDocNumber: x.refDocNumber || "", ewayBillNumber: x.ewayBillNumber || "" }];
      setReferences(refs.map((r) => ({ ...newReference(), refDocType: r.refDocType || "Invoice", refDocNumber: r.refDocNumber || "", ewayBillNumber: r.ewayBillNumber || "" })));
      setItems((x.items || []).map((i) => ({ id: makeId(), category: i.category || "Inverters", companyName: i.companyName || "", sku: i.sku || "", quantity: String(i.quantity ?? ""), uom: i.uom || "Pcs" })));
      setDispatchMode(x.dispatchMode || "By Road");
      setVehicleNumber(x.vehicleNumber || "");
      setRemarks(x.remarks || "");
      if (Array.isArray(x.documents) && x.documents.length) {
        setDocuments(x.documents.map((d) => ({ id: d.id, type: d.docCategory || "Other", name: d.docCategory || "Document", file: null, existing: true, fileName: d.fileName || d.fileKey })));
      }
    });
  }, [dispatch, editId, navigate]);


  const warehouseId = selectedWarehouse?.id || "";
  const permissions = getWarehousePermissions(user, selectedWarehouse || warehouseId);
  const operationBlocked = !selectedWarehouse || selectedWarehouse.company?.status === "Inactive" || selectedWarehouse.Outward !== "Active";

  useEffect(() => {
    if (warehouseId && !permissions.canOutward && !isEdit) navigate("/outward");
  }, [warehouseId, permissions.canOutward, navigate]);

  useEffect(() => {
    if (!warehouseId) return;
    dispatch(fetchOutwardModels(warehouseId)).then((result) => {
      if (fetchOutwardModels.fulfilled.match(result)) {
        const grouped = {};
        for (const model of result.payload || []) {
          const key = helperKey(model.category, model.companyName);
          (grouped[key] ||= []).push(model.name || model.sku);
        }
        setModels(grouped);
      }
    });
    dispatch(fetchOutwardCompanies(warehouseId)).then((result) => {
      if (fetchOutwardCompanies.fulfilled.match(result)) {
        setCompanyOptions((result.payload || []).map((c) => c.name).filter(Boolean));
      }
    });
  }, [dispatch, warehouseId]);

  const updateReference = (id, field, value) => setReferences((p) => p.map((r) => r.id === id ? { ...r, [field]: value } : r));
  const addReference = () => setReferences((p) => [...p, newReference()]);
  const removeReference = (id) => setReferences((p) => p.length === 1 ? p : p.filter((r) => r.id !== id));

  const updateItem = (id, field, value) => setItems((p) => p.map((i) => {
    if (i.id !== id) return i;
    if (field === "category" || field === "companyName") return { ...i, [field]: value, sku: "" };
    return { ...i, [field]: value };
  }));
  const addItem = () => setItems((p) => [...p, newItem()]);
  const removeItem = (id) => setItems((p) => p.length === 1 ? p : p.filter((i) => i.id !== id));

  const addModel = async (item) => {
    const name = newModelName.trim();
    if (!name) return alert("Please enter a model name.");
    const companyName = item?.companyName || "";
    const result = await dispatch(createOutwardModel({ warehouseId, category: item.category, name, companyName: companyName || undefined }));
    if (createOutwardModel.fulfilled.match(result)) {
      const key = helperKey(item.category, companyName);
      setModels((p) => ({ ...p, [key]: [...(p[key] || []), name] }));
      updateItem(item.id, "sku", name);
      setNewModelFor(null); setNewModelName("");
    } else alert(result.payload?.message || "Unable to add model.");
  };

  const addCompany = async (itemId) => {
    const name = newCompanyName.trim();
    if (!name) { alert("Please enter a company name."); return; }
    const result = await dispatch(createOutwardCompany({ warehouseId, name }));
    if (createOutwardCompany.fulfilled.match(result)) {
      setCompanyOptions((prev) => (prev.includes(name) ? prev : [...prev, name]));
      updateItem(itemId, "companyName", name);
      setNewCompanyFor(null); setNewCompanyName("");
    } else alert(result.payload?.message || "Unable to add company.");
  };

  const updateDocument = (id, patch) => setDocuments((p) => p.map((d) => d.id === id ? { ...d, ...patch } : d));
  const addDocument = (type) => {
    let name = type;
    if (type === "Other") {
      name = window.prompt("Enter document name");
      if (!name?.trim()) return;
      name = name.trim();
    }
    setDocuments((p) => [...p, newDoc(type, name)]);
    setShowDocumentMenu(false);
  };
  const removeDocument = (id) => setDocuments((p) => p.filter((d) => d.id !== id));
  const handleDocumentUpload = (id, file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return alert("File size must be less than 10 MB.");
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) return alert("Only PDF, JPG, PNG and WEBP files are allowed.");
    updateDocument(id, { file });
  };

  const refsPayload = useMemo(() => references.filter((r) => r.refDocNumber.trim() || r.ewayBillNumber.trim()).map((r) => ({
    refDocType: r.refDocType, refDocNumber: r.refDocNumber.trim(), ewayBillNumber: r.ewayBillNumber.trim() || undefined,
  })), [references]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!warehouseId) return alert("Please select a warehouse.");
    if (operationBlocked || !permissions.canOutward) return alert("You do not have permission to create outward in this warehouse.");
    if (!customerName.trim()) return alert("Please enter customer / recipient name.");
    if (!companyName.trim()) return alert("Please enter company name.");
    if (!refsPayload.length) return alert("Please enter at least one reference document number or E-way bill number.");
    for (const item of items) {
      if (!item.sku.trim()) return alert("Please select/enter model for every item.");
      if (Number(item.quantity) <= 0) return alert("Please enter a valid quantity for every item.");
      if (!item.uom) return alert("Please select UOM for every item.");
    }

    const first = refsPayload[0];
    const payload = {
      warehouseId,
      companyId: selectedCompanyId,
      outwardType,
      outwardDateTime,
      customerName: customerName.trim(),
      companyName: companyName.trim(),
      refDocType: first.refDocType,
      refDocNumber: first.refDocNumber || first.ewayBillNumber,
      refDocDate: outwardDateTime.split("T")[0],
      ewayBillNumber: first.ewayBillNumber,
      referenceDocuments: refsPayload,
      dispatchMode,
      vehicleNumber: vehicleNumber.trim() || undefined,
      remarks: remarks.trim() || undefined,
      items: items.map((i) => ({ category: i.category, companyName: i.companyName?.trim() || undefined, sku: i.sku.trim(), quantity: Number(i.quantity), uom: i.uom })),
    };

    const result = isEdit
      ? await dispatch(updateOutward({ id: editId, payload }))
      : await dispatch(createOutward(payload));
    if ((isEdit ? updateOutward.rejected.match(result) : createOutward.rejected.match(result))) return alert(result.payload?.message || "Failed to create outward entry.");
    const created = result.payload?.data || result.payload;
    const outwardId = created?.id || editId;
    const outwardNumber = created?.outwardNumber || "Outward";
    if (!outwardId) { alert("Outward created but ID was not returned."); navigate("/outward"); return; }

    const selected = documents.filter((d) => d.file && !d.existing && (d.type !== "Other" || d.name.trim()));
    const uploads = await Promise.all(selected.map((d) => {
      const category = d.type === "Other" ? d.name.trim() : d.type;
      return dispatch(uploadOutwardDocument({ outwardId, file: d.file, docCategory: category }));
    }));
    const failed = uploads.filter((r) => uploadOutwardDocument.rejected.match(r)).length;
    if (isEdit) {
      alert(failed ? `${outwardNumber} updated. ${failed} document upload(s) failed.` : `${outwardNumber} updated successfully.`);
    } else {
      alert(failed ? `${outwardNumber} created. ${failed} document upload(s) failed.` : `${outwardNumber} created successfully.`);
    }
    dispatch(resetOutwardCreateStatus());
    // replace (not push) so a successful save doesn't leave the edit
    // form sitting in browser history - otherwise clicking Back from
    // the detail page lands back on the form instead of the list/detail
    // page the user actually came from.
    navigate(isEdit ? `/outward/${editId}` : "/outward", { replace: true });
  };

  const anyUploading = Object.values(uploadingDocs || {}).some(Boolean);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 md:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800"><ArrowLeft size={22} /></button>
          <div><h1 className="text-base font-semibold text-gray-900 md:text-lg">{isEdit ? "Edit outward entry" : "New outward entry"}</h1><p className="text-xs text-gray-400">{isEdit ? "Update the prefilled outward details" : "Dispatch number auto-generated on submit"}</p></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Company / Warehouse context — only Super Admin can select these. */}
          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Company & Warehouse</h2>
            {isSuperAdmin ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div><label className={labelCls}>Company</label><div className="relative"><select value={selectedCompanyId} onChange={(e) => { const id = e.target.value; const company = topCompanyOptions.find((c) => c.id === id); setSelectedCompanyId(id); setCompanyName(company?.name || ""); dispatch(setSelectedWarehouse(null)); }} className={`${inputCls} appearance-none bg-white`}><option value="">Select company</option>{topCompanyOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" /></div></div><div><label className={labelCls}>Warehouse</label><div className="relative"><select value={selectedWarehouse?.id || ""} disabled={!selectedCompanyId} onChange={(e) => { const warehouse = companyWarehouses.find((w) => w.id === e.target.value); dispatch(setSelectedWarehouse(warehouse || null)); }} className={`${inputCls} appearance-none bg-white disabled:bg-gray-100 disabled:text-gray-400`}><option value="">{selectedCompanyId ? "Select warehouse" : "Select company first"}</option>{companyWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}</select><ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" /></div></div></div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div><label className={labelCls}>Company</label><div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">{selectedWarehouse?.company?.name || "Assigned company"}</div></div><div><label className={labelCls}>Warehouse</label><div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">{selectedWarehouse?.name || "Assigned warehouse"}</div></div></div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Outward details</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div><label className={labelCls}>Outward date and time</label><input type="datetime-local" value={outwardDateTime} onChange={(e) => setOutwardDateTime(e.target.value)} className={inputCls} /></div>
              <div><label className={labelCls}>Outward type</label><div className="relative"><select value={outwardType} onChange={(e) => setOutwardType(e.target.value)} className={`${inputCls} appearance-none`}><option>Sale - Stock Out</option><option>Service - Stock Out</option><option>Return to Vendor</option><option>Damage / Scrap Out</option></select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} /></div></div>
            </div>
            <div className="mt-4"><label className={labelCls}>Customer / Recipient name</label><input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Search or enter customer" className={inputCls} /></div>

            <div className="mt-4 space-y-4">
              {references.map((r, index) => (
                <div key={r.id} className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                  {references.length > 1 && <div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium text-gray-500">Reference document {index + 1}</span><button type="button" onClick={() => removeReference(r.id)} className="flex items-center gap-1 text-xs text-red-500"><Trash2 size={13} />Remove</button></div>}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
                    <div><label className={labelCls}>Reference doc type</label><div className="relative"><select value={r.refDocType} onChange={(e) => updateReference(r.id, "refDocType", e.target.value)} className={`${inputCls} appearance-none`}><option>Invoice</option><option>E-way Bill</option><option>Delivery Challan</option><option>Return Note</option><option>Other</option></select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} /></div></div>
                    <div><label className={labelCls}>Reference doc no.</label><input value={r.refDocNumber} onChange={(e) => updateReference(r.id, "refDocNumber", e.target.value)} placeholder="Enter document number" className={inputCls} /></div>
                    <div><label className={labelCls}>E-way bill number</label><input value={r.ewayBillNumber} onChange={(e) => updateReference(r.id, "ewayBillNumber", e.target.value)} placeholder="If above threshold" className={inputCls} /></div>
                    <button type="button" onClick={addReference} className="flex h-[43px] items-center justify-center gap-2 rounded-lg border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50"><Plus size={16} />Add document</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div><label className={labelCls}>Dispatch mode</label><select value={dispatchMode} onChange={(e) => setDispatchMode(e.target.value)} className={`${inputCls} appearance-none`}><option>By Road</option><option>Courier</option><option>Customer Pickup</option></select></div>
              <div><label className={labelCls}>Vehicle / AWB number</label><input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} placeholder="If applicable" className={inputCls} /></div>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold text-gray-900">Item details</h2><button type="button" onClick={addItem} className="flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700"><Plus size={14} />Add item</button></div>
            <div className="space-y-4">
              {items.map((item, index) => (
                <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                  <div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium text-gray-500">Item {index + 1}</span>{items.length > 1 && <button type="button" onClick={() => removeItem(item.id)} className="flex items-center gap-1 text-xs text-red-500"><Trash2 size={13} />Delete item</button>}</div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-12">
                    <div className="md:col-span-2"><label className={labelCls}>Category</label><select value={item.category} onChange={(e) => updateItem(item.id, "category", e.target.value)} className={`${inputCls} appearance-none`}><option>Inverters</option><option>Panels</option><option>Cables</option></select></div>
                    <div className="md:col-span-3">
                      <label className={labelCls}>Company</label>
                      <div className="flex gap-2">
                        <select value={item.companyName} onChange={(e) => updateItem(item.id, "companyName", e.target.value)} className={`${inputCls} min-w-0 appearance-none`}>
                          <option value="">Select company</option>
                          {companyOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                        <button type="button" title="Add company" onClick={() => { setNewCompanyFor(item.id); setNewCompanyName(""); }} className="shrink-0 rounded-lg border border-blue-300 bg-white px-3 text-blue-700 hover:bg-blue-50"><Plus size={16} /></button>
                      </div>
                      {newCompanyFor === item.id && (
                        <div className="mt-2 flex gap-2">
                          <input autoFocus value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} placeholder="Add company" className={inputCls} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCompany(item.id); } }} />
                          <button type="button" onClick={() => addCompany(item.id)} className="rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700">Add</button>
                          <button type="button" onClick={() => { setNewCompanyFor(null); setNewCompanyName(""); }} className="rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600">Cancel</button>
                        </div>
                      )}
                    </div>
                    <div className="md:col-span-3">
                      <label className={labelCls}>SKU / Model</label>
                      <div className="flex gap-2">
                        <select value={item.sku} disabled={!item.companyName} onChange={(e) => updateItem(item.id, "sku", e.target.value)} className={`${inputCls} min-w-0 appearance-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400`}>
                          <option value="">{item.companyName ? "Select model" : "Select company first"}</option>
                          {(models[helperKey(item.category, item.companyName)] || []).map((m) => <option key={m}>{m}</option>)}
                        </select>
                        <button type="button" disabled={!item.companyName} onClick={() => { setNewModelFor(item.id); setNewModelName(""); }} className="rounded-lg border border-blue-300 px-3 text-blue-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"><Plus size={16} /></button>
                      </div>
                      {newModelFor === item.id && <div className="mt-2 flex gap-2"><input autoFocus value={newModelName} onChange={(e) => setNewModelName(e.target.value)} placeholder={`Add ${item.category} model`} className={inputCls} /><button type="button" onClick={() => addModel(item)} className="rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white">Add</button><button type="button" onClick={() => setNewModelFor(null)} className="rounded-lg border px-3 text-xs">Cancel</button></div>}
                    </div>
                    <div className="md:col-span-2"><label className={labelCls}>Quantity</label><input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(item.id, "quantity", e.target.value)} placeholder="0" className={inputCls} /></div>
                    <div className="md:col-span-2"><label className={labelCls}>UOM</label><select value={item.uom} onChange={(e) => updateItem(item.id, "uom", e.target.value)} className={`${inputCls} appearance-none`}><option>Pcs</option><option>Meters</option><option>Bundles</option></select></div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div><h2 className="text-base font-semibold text-gray-900">Documents</h2><p className="mt-1 text-xs text-gray-400">Upload documents if available. Documents are optional.</p></div>
              <div className="relative shrink-0">
                <button type="button" onClick={() => setShowDocumentMenu((v) => !v)} className="flex items-center gap-2 rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"><Plus size={16} />Add document</button>
                {showDocumentMenu && <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                  {["Delivery challan", "E-way bill", "Dispatch photo", "Other"].map((value) => <button key={value} type="button" onClick={() => addDocument(value)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"><FileText size={16} className="text-gray-400" />{value}</button>)}
                </div>}
              </div>
            </div>
            <div className="space-y-4">
              {documents.map((doc) => (
                <div key={doc.id} className="flex min-h-[104px] items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4">
                  <div className="flex min-w-0 items-center gap-5">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gray-100"><FileText size={28} strokeWidth={1.7} className="text-gray-400" /></div>
                    <div className="min-w-0"><p className="text-base font-semibold text-gray-900 md:text-lg">{doc.name || doc.type}</p>{doc.file && <p className="mt-1 truncate text-xs text-green-600">Uploaded: {doc.file.name}</p>}</div>
                  </div>
                  <label className="flex h-12 shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-blue-300 bg-white px-5 text-sm font-semibold text-blue-700 hover:bg-blue-50"><Upload size={19} />{doc.file ? "Change document" : "Upload document"}<input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={createStatus === "loading"} onChange={(e) => { handleDocumentUpload(doc.id, e.target.files?.[0]); e.target.value = ""; }} /></label>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6"><label className={labelCls}>Dispatch remarks</label><textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Package condition, dispatch notes, etc." className={`${inputCls} resize-none`} /></section>
          <button type="submit" disabled={createStatus === "loading" || anyUploading} className="w-full rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">{createStatus === "loading" ? (isEdit ? "Updating outward..." : "Creating outward...") : (isEdit ? "Update outward" : "Submit and generate dispatch number")}</button>
        </form>
      </div>
    </div>
  );
}
