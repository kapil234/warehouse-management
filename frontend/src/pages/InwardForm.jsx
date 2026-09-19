import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  Check,
  FileText,
  X,
  Upload,
  Plus,
  Trash2,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  createInward,
  updateInward,
  fetchInwardById,
  uploadInwardDocument,
  resetCreateStatus,
  selectCreateStatus,
  selectUploadingDocs,
} from "../features/inward/inwardSlice";
import {
  fetchWarehouses,
  selectWarehouses,
  selectSelectedWarehouse,
  setSelectedWarehouse,
} from "../features/warehouse/warehouseSlice";
import { getWarehousePermissions } from "../features/warehouse/warehousePermissions";
import { fetchCompanies, selectAllCompanies } from "../features/company/companySlice";
import useProducts from "../features/product/useProducts";
import ItemProductFields, { ItemProductNotice } from "../components/ItemProductFields";

/*
 * Inward form:
 * - No serial-number UI or validation.
 * - Company name is beside Supplier / Customer.
 * - Reference documents are repeatable.
 * - Every reference row contains document type, reference number and E-way bill.
 * - Documents section has the three default document types plus custom documents.
 * - Items are repeatable. Category and SKU / model are picked from the product
 *   list that admins manage on the Product Management page.
 */

const DEFAULT_REFERENCE = () => ({
  id: crypto.randomUUID(),
  refDocType: "Invoice",
  refDocNumber: "",
  ewayBillNumber: "",
});

const DEFAULT_DOCUMENTS = [
  { id: crypto.randomUUID(), type: "Invoice", name: "Vendor invoice", file: null },
  { id: crypto.randomUUID(), type: "E-way Bill", name: "E-way bill", file: null },
  { id: crypto.randomUUID(), type: "Other", name: "Unloading sign-off sheet", file: null },
];

const createItem = () => ({
  id: crypto.randomUUID(),
  category: "",
  sku: "",
  quantity: "",
  uom: "Pcs",
});

const getDateTimeLocal = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}`;
};

// Builds the docCategory string sent to the backend for a document
// uploaded from this form. This MUST line up exactly (case-insensitively)
// with the labels InwardDetail.jsx and inwardHelpers.js use to match
// "required" documents ("Vendor invoice" / "E-way bill" / "Unloading
// sign-off sheet") — otherwise every upload lands in "Additional
// documents" instead of its proper slot, and the Complete/Pending status
// never reflects what was actually uploaded. For the first document of
// a given label, send the label as-is; for repeats (or custom "Other"
// documents), append "#N" — the same convention InwardDetail.jsx already
// uses for documents added after creation, so both stay consistent.
const buildDocCategory = (label, index) => (index > 1 ? `${label} #${index}` : label);

export default function InwardForm() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { id: editId } = useParams();
  const isEdit = Boolean(editId);

  const warehouses = useSelector(selectWarehouses);
  const selectedWarehouse = useSelector(selectSelectedWarehouse);
  const companies = useSelector(selectAllCompanies);
  const createStatus = useSelector(selectCreateStatus);
  const uploadingDocs = useSelector(selectUploadingDocs);
  const products = useProducts();

  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem("user"));
    } catch {
      return null;
    }
  })();

  const [inwardType, setInwardType] = useState("Purchase - New Stock");
  const [inwardDateTime, setInwardDateTime] = useState(getDateTimeLocal);
  const [supplierName, setSupplierName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");

  const [referenceDocuments, setReferenceDocuments] = useState([DEFAULT_REFERENCE()]);
  const [documents, setDocuments] = useState(DEFAULT_DOCUMENTS);
  const [showDocumentMenu, setShowDocumentMenu] = useState(false);

  const [items, setItems] = useState([createItem()]);

  const [remarks, setRemarks] = useState("");

  const inputCls =
    "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400";
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
    dispatch(fetchInwardById(editId)).then((result) => {
      if (!fetchInwardById.fulfilled.match(result)) {
        alert(result.payload || "Unable to load inward entry.");
        navigate("/inward");
        return;
      }
      const x = result.payload;
      if (x.warehouse) {
        dispatch(setSelectedWarehouse(x.warehouse));
        setSelectedCompanyId(x.warehouse.companyId || x.warehouse.company?.id || "");
      }
      setInwardType(x.inwardType || "Purchase - New Stock");
      const dt = x.inwardDateTime || x.refDocDate || x.createdAt;
      if (dt) {
        const d = new Date(dt);
        if (!Number.isNaN(d.getTime())) {
          const p = (n) => String(n).padStart(2, "0");
          setInwardDateTime(`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`);
        }
      }
      setSupplierName(x.supplierName || "");
      setCompanyName(x.warehouse?.company?.name || x.companyName || "");
      const refs = Array.isArray(x.referenceDocuments) && x.referenceDocuments.length
        ? x.referenceDocuments
        : [{ refDocType: x.refDocType || "Invoice", refDocNumber: x.refDocNumber || "", ewayBillNumber: x.ewayBillNumber || "" }];
      setReferenceDocuments(refs.map((r) => ({ ...DEFAULT_REFERENCE(), refDocType: r.refDocType || "Invoice", refDocNumber: r.refDocNumber || "", ewayBillNumber: r.ewayBillNumber || "" })));
      setItems((x.items || []).map((i) => ({ id: crypto.randomUUID(), category: i.category || "", companyName: i.companyName || "", sku: i.sku || "", quantity: String(i.quantity ?? ""), uom: i.uom || "Pcs" })));
      setRemarks(x.remarks || "");
      if (Array.isArray(x.documents) && x.documents.length) {
        setDocuments(x.documents.map((d) => ({ id: d.id, type: d.docCategory || "Other", name: d.docCategory || "Document", file: null, existing: true, fileName: d.fileName || d.fileKey })));
      }
    });
  }, [dispatch, editId, navigate]);

  const warehouseId = selectedWarehouse?.id || "";
  const permissions = getWarehousePermissions(user, selectedWarehouse || warehouseId);
  const operationBlocked =
    !selectedWarehouse ||
    (!isEdit && (selectedWarehouse.company?.status === "Inactive" || selectedWarehouse.Inward !== "Active"));

  useEffect(() => {
    if (warehouseId && !permissions.canInward && !isEdit) {
      navigate("/inward");
    }
  }, [navigate, warehouseId, permissions.canInward]);

  const submitting = createStatus === "loading";
  const anyDocUploading = Object.values(uploadingDocs || {}).some(Boolean);

  const updateReference = (id, field, value) => {
    setReferenceDocuments((prev) =>
      prev.map((doc) => (doc.id === id ? { ...doc, [field]: value } : doc))
    );
  };

  const addReferenceDocument = () => {
    setReferenceDocuments((prev) => [...prev, DEFAULT_REFERENCE()]);
  };

  const removeReferenceDocument = (id) => {
    setReferenceDocuments((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((doc) => doc.id !== id);
    });
  };

  const handleDocumentUpload = (id, file) => {
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert("File size must be less than 10 MB.");
      return;
    }

    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.type)) {
      alert("Only PDF, JPG, PNG and WEBP files are allowed.");
      return;
    }

    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === id
          ? {
              ...doc,
              file,
            }
          : doc
      )
    );
  };

  const addDocument = (type) => {
    let name = type;
    if (type === "Vendor invoice") name = "Vendor invoice";
    if (type === "E-way bill") name = "E-way bill";
    if (type === "Unloading sign-off sheet") name = "Unloading sign-off sheet";
    if (type === "Other") {
      name = window.prompt("Enter document name");
      if (!name?.trim()) return;
      name = name.trim();
    }

    const normalizedType = type === "Vendor invoice" ? "Invoice" : type === "E-way bill" ? "E-way Bill" : type;
    setDocuments((prev) => [
      ...prev,
      { id: crypto.randomUUID(), type: normalizedType, name, file: null },
    ]);
    setShowDocumentMenu(false);
  };

  const removeDocument = (id) => {
    setDocuments((prev) => prev.filter((doc) => doc.id !== id));
  };

  const updateItem = (id, field, value) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        // Picking a different category / SKU means a different product, so the
        // (hidden) company carried over from an older entry no longer applies.
        if (field === "category") {
          return {
            ...item,
            category: value,
            sku: "",
            companyName: "",
          };
        }

        if (field === "sku") {
          return { ...item, sku: value, companyName: "" };
        }

        return { ...item, [field]: value };
      })
    );
  };

  const addItem = () => {
    setItems((prev) => [...prev, createItem()]);
  };

  const removeItem = (id) => {
    setItems((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((item) => item.id !== id);
    });
  };

  const formatDateForApi = (value) => {
    if (!value) return undefined;
    return value.split("T")[0];
  };

  const referencePayload = useMemo(
    () =>
      referenceDocuments.map((doc) => ({
        refDocType: doc.refDocType,
        refDocNumber: doc.refDocNumber.trim(),
        ewayBillNumber: doc.ewayBillNumber.trim() || undefined,
      })),
    [referenceDocuments]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!supplierName.trim()) {
      alert("Please enter supplier / customer name.");
      return;
    }

    if (!selectedCompanyId || !companyName.trim()) {
      alert("Please select a company.");
      return;
    }

    if (!referenceDocuments[0]?.refDocNumber.trim()) {
      alert("Please enter reference document number.");
      return;
    }

    for (const item of items) {
      if (!item.category) {
        alert("Please select a category for every item.");
        return;
      }

      if (!item.sku.trim()) {
        alert("Please select SKU / model for every item.");
        return;
      }

      if (!item.quantity || Number(item.quantity) <= 0) {
        alert("Please enter a valid quantity for every item.");
        return;
      }
    }

    if (!warehouseId) {
      alert("Please select a warehouse for the selected company.");
      return;
    }

    if (operationBlocked) {
      alert(
        "This warehouse inward operation is inactive because the company or warehouse operation is inactive."
      );
      return;
    }

    if (!permissions.canInward) {
      alert(
        "You do not have permission to create this inward entry in the selected warehouse."
      );
      return;
    }

    /*
     * Keep the original API fields for backward compatibility and also
     * send the complete referenceDocuments/companyName data.
     */
    const firstReference = referenceDocuments[0];

    const payload = {
      warehouseId,
      companyId: selectedCompanyId,
      inwardType,
      inwardDateTime,
      supplierName: supplierName.trim(),
      companyName: companyName.trim(),

      refDocType: firstReference.refDocType,
      refDocNumber: firstReference.refDocNumber.trim(),
      refDocDate: formatDateForApi(inwardDateTime),
      ewayBillNumber: firstReference.ewayBillNumber.trim() || undefined,

      referenceDocuments: referencePayload,

      remarks: remarks.trim() || undefined,

      items: items.map((item) => ({
        category: item.category,
        companyName: item.companyName?.trim() || undefined,
        sku: item.sku.trim(),
        quantity: Number(item.quantity),
        uom: item.uom,
      })),
    };

    const result = isEdit
      ? await dispatch(updateInward({ id: editId, payload }))
      : await dispatch(createInward(payload));

    if (createInward.rejected.match(result)) {
      const err = result.payload || {};

      if (err.status === 403) {
        alert(err.message || "You are not authorized to create an inward entry.");
      } else if (err.status === 422) {
        alert(err.message || "Please check the form details.");
        console.log("Validation errors:", err.errors);
      } else if (err.status === 409) {
        alert(err.message || "The inward entry conflicts with existing data.");
      } else {
        alert(err.message || "Failed to create inward entry.");
      }
      return;
    }

    const created = result.payload?.data || result.payload;
    const grnId = created?.id || editId;
    const grnNumber =
      created?.grnNumber ||
      created?.grn_number ||
      created?.grn?.grnNumber ||
      (isEdit ? `GRN ${editId}` : "");

    if (!grnId) {
      alert("GRN created but GRN ID was not returned by the server.");
      dispatch(resetCreateStatus());
      navigate("/inward");
      return;
    }

    const selectedDocuments = documents.filter((doc) => doc.file && !doc.existing && (doc.type !== "Other" || doc.name.trim()));

    if (selectedDocuments.length > 0) {
      const categoryCounts = {};

      const uploadResults = await Promise.all(
        selectedDocuments.map((doc) => {
          const label = doc.name?.trim() || doc.type;
          const key = label.toLowerCase();
          categoryCounts[key] = (categoryCounts[key] || 0) + 1;

          return dispatch(
            uploadInwardDocument({
              grnId,
              file: doc.file,
              docCategory: buildDocCategory(label, categoryCounts[key]),
            })
          );
        })
      );

      const failedCount = uploadResults.filter((r) =>
        uploadInwardDocument.rejected.match(r)
      ).length;

      if (failedCount > 0) {
        alert(
          isEdit
            ? `GRN ${grnNumber} updated successfully. Some documents could not be uploaded.`
            : `GRN ${grnNumber} created successfully. Some documents could not be uploaded.`
        );
      } else {
        alert(isEdit ? `GRN ${grnNumber} updated successfully.` : `GRN ${grnNumber} created successfully.`);
      }
    } else {
      alert(isEdit ? `GRN ${grnNumber} updated successfully.` : `GRN ${grnNumber} created successfully.`);
    }

    dispatch(resetCreateStatus());
    // replace (not push) so a successful save doesn't leave the edit
    // form sitting in browser history - otherwise clicking Back from
    // the detail page lands back on the form instead of the list/detail
    // page the user actually came from.
    navigate(isEdit ? `/inward/${editId}` : "/inward", { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 md:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-gray-500 transition-colors hover:text-gray-800"
          >
            <ArrowLeft size={22} />
          </button>

          <div>
            <h1 className="text-base font-semibold text-gray-900 md:text-lg">
              {isEdit ? "Edit inward entry" : "New inward entry"}
            </h1>
            <p className="text-xs text-gray-400">
              {isEdit ? "Update the prefilled inward details" : "GRN auto-generated on submit"}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Company / Warehouse context — only Super Admin can select these. */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Company & Warehouse</h2>
            {isSuperAdmin ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div><label className={labelCls}>Company</label><div className="relative"><select value={selectedCompanyId} onChange={(e) => { const id = e.target.value; const company = topCompanyOptions.find((c) => c.id === id); setSelectedCompanyId(id); setCompanyName(company?.name || ""); dispatch(setSelectedWarehouse(null)); }} className={`${inputCls} appearance-none bg-white`}><option value="">Select company</option>{topCompanyOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" /></div></div>
                <div><label className={labelCls}>Warehouse</label><div className="relative"><select value={selectedWarehouse?.id || ""} disabled={!selectedCompanyId} onChange={(e) => { const warehouse = companyWarehouses.find((w) => w.id === e.target.value); dispatch(setSelectedWarehouse(warehouse || null)); }} className={`${inputCls} appearance-none bg-white disabled:bg-gray-100 disabled:text-gray-400`}><option value="">{selectedCompanyId ? "Select warehouse" : "Select company first"}</option>{companyWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}</select><ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" /></div></div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div><label className={labelCls}>Company</label><div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">{selectedWarehouse?.company?.name || "Assigned company"}</div></div><div><label className={labelCls}>Warehouse</label><div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">{selectedWarehouse?.name || "Assigned warehouse"}</div></div></div>
            )}
          </div>

          {/* Inward details */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">
              Inward details
            </h2>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className={labelCls}>Inward date and time</label>
                <div className="relative">
                  <input
                    type="datetime-local"
                    value={inwardDateTime}
                    onChange={(e) => setInwardDateTime(e.target.value)}
                    className={inputCls}
                  />
                  <Calendar
                    size={16}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Inward type</label>
                <div className="relative">
                  <select
                    value={inwardType}
                    onChange={(e) => setInwardType(e.target.value)}
                    className={`${inputCls} appearance-none bg-white`}
                  >
                    <option>Purchase - New Stock</option>
                    <option>Purchase - Service Stock</option>
                    <option>Return of Purchase</option>
                    <option>Service Stock from Customer</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                </div>
              </div>
            </div>

            {/* Supplier / customer */}
            <div className="mt-4">
              <label className={labelCls}>Supplier / Customer name</label>
              <input
                type="text"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="Search or enter supplier"
                className={inputCls}
              />
            </div>

            {/* Reference documents */}
            <div className="mt-4 space-y-4">
              {referenceDocuments.map((reference, index) => (
                <div
                  key={reference.id}
                  className="rounded-xl border border-gray-100 bg-gray-50/40 p-3"
                >
                  <div className="mb-3 flex items-center justify-between">
                    {referenceDocuments.length > 1 ? (
                      <p className="text-xs font-medium text-gray-500">
                        Reference document {index + 1}
                      </p>
                    ) : (
                      <span />
                    )}

                    {referenceDocuments.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeReferenceDocument(reference.id)}
                        className="flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-700"
                      >
                        <Trash2 size={13} />
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
                    <div>
                      <label className={labelCls}>Reference doc type</label>
                      <div className="relative">
                        <select
                          value={reference.refDocType}
                          onChange={(e) =>
                            updateReference(
                              reference.id,
                              "refDocType",
                              e.target.value
                            )
                          }
                          className={`${inputCls} appearance-none bg-white`}
                        >
                          <option>Invoice</option>
                          <option>E-way Bill</option>
                          <option>Delivery Challan</option>
                          <option>Return Note</option>
                          <option>Other</option>
                        </select>
                        <ChevronDown
                          size={16}
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                        />
                      </div>
                    </div>

                    <div>
                      <label className={labelCls}>Reference doc no.</label>
                      <input
                        type="text"
                        value={reference.refDocNumber}
                        onChange={(e) =>
                          updateReference(
                            reference.id,
                            "refDocNumber",
                            e.target.value
                          )
                        }
                        placeholder="Enter document number"
                        className={inputCls}
                      />
                    </div>

                    <div>
                      <label className={labelCls}>E-way bill number</label>
                      <input
                        type="text"
                        value={reference.ewayBillNumber}
                        onChange={(e) =>
                          updateReference(
                            reference.id,
                            "ewayBillNumber",
                            e.target.value
                          )
                        }
                        placeholder="If above threshold"
                        className={inputCls}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={addReferenceDocument}
                      className="flex h-[43px] items-center justify-center gap-2 rounded-lg border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                    >
                      <Plus size={16} />
                      Add document
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Item details */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                Item details
              </h2>

              <button
                type="button"
                onClick={addItem}
                className="flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"
              >
                <Plus size={14} />
                Add item
              </button>
            </div>

            <ItemProductNotice isAdmin={isSuperAdmin} />

            <div className="space-y-4">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-gray-100 bg-gray-50/40 p-3"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-500">
                      Item {index + 1}
                    </p>

                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-700"
                      >
                        <Trash2 size={13} />
                        Delete item
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-12">
                    <ItemProductFields
                      item={item}
                      products={products}
                      onChange={(field, value) => updateItem(item.id, field, value)}
                      inputCls={inputCls}
                      labelCls={labelCls}
                      categoryClass="md:col-span-3"
                      skuClass="md:col-span-5"
                    />

                    <div className="md:col-span-2">
                      <label className={labelCls}>Quantity</label>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) =>
                          updateItem(item.id, "quantity", e.target.value)
                        }
                        placeholder="0"
                        className={inputCls}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className={labelCls}>UOM</label>
                      <div className="relative">
                        <select
                          value={item.uom}
                          onChange={(e) =>
                            updateItem(item.id, "uom", e.target.value)
                          }
                          className={`${inputCls} appearance-none bg-white`}
                        >
                          <option>Pcs</option>
                          <option>Meters</option>
                          <option>Bundles</option>
                        </select>
                        <ChevronDown
                          size={16}
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Documents */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Documents</h2>
                <p className="mt-1 text-xs text-gray-400">Upload documents if available. Documents are optional.</p>
              </div>

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setShowDocumentMenu((v) => !v)}
                  className="flex items-center gap-2 rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                >
                  <Plus size={16} />
                  Add document
                </button>

                {showDocumentMenu && (
                  <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                    {[
                      ["Vendor invoice", "Vendor invoice"],
                      ["E-way bill", "E-way bill"],
                      ["Unloading sign-off sheet", "Unloading sign-off sheet"],
                      ["Other", "Other"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => addDocument(value)}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <FileText size={16} className="text-gray-400" />
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {documents.map((doc) => (
                <div key={doc.id} className="flex min-h-[104px] items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4">
                  <div className="flex min-w-0 items-center gap-5">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gray-100">
                      <FileText size={28} strokeWidth={1.7} className="text-gray-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-gray-900 md:text-lg">{doc.name || doc.type}</p>
                      {doc.file && (
                        <p className="mt-1 truncate text-xs text-green-600">Uploaded: {doc.file.name}</p>
                      )}
                    </div>
                  </div>

                  <label className="flex h-12 shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-blue-300 bg-white px-5 text-sm font-semibold text-blue-700 hover:bg-blue-50">
                    <Upload size={19} />
                    {doc.file ? "Change document" : "Upload document"}
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      disabled={submitting}
                      onChange={(e) => {
                        handleDocumentUpload(doc.id, e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Remarks */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <label className={labelCls}>Receiving remarks</label>
            <textarea
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Box condition, seal status, damage, etc."
              className={`${inputCls} resize-none`}
            />
          </div>

          <button
            type="submit"
            disabled={submitting || anyDocUploading}
            className="w-full rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? (isEdit ? "Updating inward..." : "Creating GRN...") : (isEdit ? "Update inward" : "Submit and generate GRN")}
          </button>
        </form>
      </div>
    </div>
  );
}
