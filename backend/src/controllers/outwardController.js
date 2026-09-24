import prisma from "../config/prisma.js";
import { recordAuditLog, recordAuditLogs, diffFields, diffItems, describeItem } from "../utils/auditLog.js";
import { findUnknownProducts, unknownProductsMessage } from "../utils/productCatalog.js";
import { getWarehouseStock, findShortages, shortageMessage } from "../utils/stock.js";
 
const DEFAULT_DOCUMENT_TYPES = ["Delivery challan", "E-way bill", "Dispatch photo"];
 
// Create / edit run the stock check and the save in one serializable transaction.
// Prisma's default limit is 5 seconds, and even 10 seconds was not enough when
// every query is a slow network round trip to a remote database (the save then
// failed with "Transaction already closed" and worked only on a retry). 30
// seconds is a safety net - the transaction itself is now kept short.
// (maxWait = how long to wait for a free database connection before the
// transaction even starts.)
const STOCK_TRANSACTION_OPTIONS = { isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 };
 
async function getScopedWarehouseIds(req) {
  if (req.user.role === "SUPER_ADMIN") return null;
  if (req.user.role === "WAREHOUSE_MANAGER") {
    const rows = await prisma.warehouseAccess.findMany({
      where: { userId: req.user.id, accessLevel: "MANAGE" },
      select: { warehouseId: true },
    });
    return rows.map((r) => r.warehouseId);
  }
  return [];
}
 
async function assertWarehouseAccess(req, warehouseId, permission = "canOutward") {
  if (!warehouseId) throw Object.assign(new Error("warehouseId is required"), { status: 400 });
 
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, code: true, companyId: true, Outward: true, company: { select: { id: true, name: true, status: true } } },
  });
  if (!warehouse) throw Object.assign(new Error("Warehouse not found"), { status: 404 });
  if (warehouse.company?.status === "Inactive") throw Object.assign(new Error("This warehouse belongs to an inactive company."), { status: 403 });
  if (permission === "canOutward" && warehouse.Outward !== "Active") throw Object.assign(new Error("Outward is disabled for this warehouse."), { status: 403 });
 
  if (req.user.role === "SUPER_ADMIN") return warehouse;
 
  const access = await prisma.warehouseAccess.findUnique({
    where: { userId_warehouseId: { userId: req.user.id, warehouseId } },
  });
  if (!access || access.accessLevel !== "MANAGE") throw Object.assign(new Error("You don't have access to this warehouse"), { status: 403 });
  if (permission && !access[permission]) throw Object.assign(new Error("You don't have permission to do this on this warehouse"), { status: 403 });
  return warehouse;
}
 
function documentStatus(documents = []) {
  const required = new Set(DEFAULT_DOCUMENT_TYPES.map((x) => x.toLowerCase()));
  const uploaded = new Set(documents.map((d) => String(d.docCategory || "").toLowerCase()));
  const pendingDocuments = [...required].filter((x) => !uploaded.has(x)).length;
  return {
    status: pendingDocuments === 0 ? "Complete" : "Pending",
    pendingDocuments,
    uploadedDocuments: DEFAULT_DOCUMENT_TYPES.length - pendingDocuments,
    requiredDocuments: DEFAULT_DOCUMENT_TYPES.length,
  };
}
 
export async function listOutward(req, res) {
  try {
    const { search = "", type, dateFrom, dateTo, warehouseId, page = "1", pageSize = "20" } = req.query;
    const scopedWarehouseIds = await getScopedWarehouseIds(req);
    const where = {
      AND: [
        scopedWarehouseIds ? { warehouseId: { in: scopedWarehouseIds } } : {},
        warehouseId ? { warehouseId } : {},
        search ? { OR: [
          { outwardNumber: { contains: search, mode: "insensitive" } },
          { customerName: { contains: search, mode: "insensitive" } },
          { companyName: { contains: search, mode: "insensitive" } },
          { refDocNumber: { contains: search, mode: "insensitive" } },
        ] } : {},
        type ? { outwardType: type } : {},
        dateFrom || dateTo ? { createdAt: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          // See inwardController.listGrn for why this needs end-of-day, not midnight.
          ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999`) } : {}),
        } } : {},
      ],
    };
 
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const pageSizeNum = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
    const [rows, total] = await Promise.all([
      prisma.min.findMany({
        where,
        include: {
          items: true,
          referenceDocuments: true,
          createdBy: { select: { name: true, email: true } },
          warehouse: { select: { id: true, name: true, code: true, company: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.min.count({ where }),
    ]);
 
    const ids = rows.map((x) => x.id);
    const documents = ids.length ? await prisma.document.findMany({ where: { linkedType: "outward", linkedId: { in: ids } }, orderBy: { uploadedAt: "desc" } }) : [];
    const data = rows.map((row) => {
      const docs = documents.filter((d) => d.linkedId === row.id);
      return { ...row, documents: docs, ...documentStatus(docs) };
    });
 
    return res.json({ data, pagination: { page: pageNum, pageSize: pageSizeNum, total, totalPages: Math.ceil(total / pageSizeNum) } });
  } catch (error) {
    console.error("List outward error:", error);
    return res.status(500).json({ message: "Failed to fetch outward entries", error: error.message });
  }
}
 
export async function getOutwardById(req, res) {
  try {
    const min = await prisma.min.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        referenceDocuments: true,
        createdBy: { select: { name: true, email: true, role: true } },
        warehouse: { select: { id: true, name: true, code: true, companyId: true, Inward: true, Outward: true, company: { select: { name: true, status: true } } } },
      },
    });
    if (!min) return res.status(404).json({ message: "Outward entry not found" });
 
    // Read access is deliberately warehouse-scoped.
    if (req.user.role === "WAREHOUSE_MANAGER") {
      const access = await prisma.warehouseAccess.findUnique({ where: { userId_warehouseId: { userId: req.user.id, warehouseId: min.warehouseId } } });
      if (!access || access.accessLevel !== "MANAGE") return res.status(403).json({ message: "You don't have access to this entry's warehouse" });
    }
 
    const documents = await prisma.document.findMany({ where: { linkedType: "outward", linkedId: min.id }, orderBy: { uploadedAt: "desc" } });
    return res.json({ data: { ...min, documents, ...documentStatus(documents) } });
  } catch (error) {
    console.error("Get outward error:", error);
    return res.status(500).json({ message: "Failed to fetch outward entry", error: error.message });
  }
}
 
/**
 * =========================================================
 * GET /api/outward/stock?warehouseId=&excludeOutwardId=
 * =========================================================
 *
 * What is in stock right now in ONE warehouse (inward minus outward, per
 * category + SKU). The outward form uses it so the SKU / model dropdown can
 * show "how many are available" and only allow picking what is in stock.
 *
 * Only rows with something available are returned - anything missing from
 * the list is out of stock.
 *
 * excludeOutwardId: when EDITING an outward entry, pass its id so the
 * quantities it already holds count as available again for that entry.
 * =========================================================
 */
export async function listOutwardStock(req, res) {
  try {
    const { warehouseId, excludeOutwardId } = req.query;
    await assertWarehouseAccess(req, warehouseId, null);
    const stock = await getWarehouseStock(prisma, warehouseId, { excludeOutwardId: excludeOutwardId || undefined });
    const data = Array.from(stock.values())
      .filter((row) => row.available > 0)
      .map(({ category, sku, uom, available }) => ({ category, sku, uom, available }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.sku.localeCompare(b.sku));
    return res.json({ data });
  } catch (error) {
    console.error("List outward stock error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch stock" });
  }
}
 
export async function listOutwardModels(req, res) {
  try {
    const { warehouseId } = req.query;
    await assertWarehouseAccess(req, warehouseId, null);
    // Scoped the same way inward does it: key on category + companyName
    // + model name so the same model name under a different brand /
    // company doesn't collapse into one row, and nothing shows until
    // an item's Company is selected on the form.
    const [catalog, history] = await Promise.all([
      prisma.warehouseModel.findMany({ where: { warehouseId }, orderBy: [{ category: "asc" }, { companyName: "asc" }, { name: "asc" }] }),
      prisma.minItem.groupBy({
        by: ["category", "sku", "companyName"],
        where: { min: { warehouseId } },
      }),
    ]);
    const map = new Map(catalog.map((m) => [`${m.category}::${m.companyName || ""}::${m.name}`, m]));
    for (const row of history) {
      if (!row.sku) continue;
      const key = `${row.category}::${row.companyName || ""}::${row.sku}`;
      if (!map.has(key)) map.set(key, { category: row.category, name: row.sku, companyName: row.companyName || null });
    }
    return res.json({ data: Array.from(map.values()) });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch models" });
  }
}
 
export async function createOutwardModel(req, res) {
  try {
    const { warehouseId, category, name, companyName } = req.body;
    await assertWarehouseAccess(req, warehouseId, "canOutward");
    if (!category || !name?.trim()) return res.status(422).json({ message: "category and model name are required" });
    const model = await prisma.warehouseModel.create({ data: { warehouseId, category, name: name.trim(), companyName: companyName?.trim() || null } });
    return res.status(201).json({ data: model });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "This model already exists in this warehouse." });
    return res.status(error.status || 500).json({ message: error.message || "Failed to create model" });
  }
}
 
/**
 * =========================================================
 * ITEM COMPANIES (brand/manufacturer tagged per item)
 * =========================================================
 *
 * Mirrors listInwardCompanies / createInwardCompany - the same
 * per-warehouse WarehouseCompany catalog is shared between inward
 * and outward, so a company added from either form shows up on both.
 * =========================================================
 */
 
export async function listOutwardCompanies(req, res) {
  try {
    const { warehouseId } = req.query;
    await assertWarehouseAccess(req, warehouseId, null);
    const [catalog, history] = await Promise.all([
      prisma.warehouseCompany.findMany({ where: { warehouseId }, orderBy: { name: "asc" } }),
      prisma.minItem.findMany({ where: { min: { warehouseId }, companyName: { not: null } }, select: { companyName: true }, distinct: ["companyName"] }),
    ]);
    const map = new Map(catalog.map((c) => [c.name, c]));
    for (const row of history) {
      if (row.companyName && !map.has(row.companyName)) map.set(row.companyName, { name: row.companyName });
    }
    return res.json({ data: Array.from(map.values()) });
  } catch (error) {
    console.error("List outward companies error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch companies" });
  }
}
 
export async function createOutwardCompany(req, res) {
  try {
    const { warehouseId, name } = req.body;
    await assertWarehouseAccess(req, warehouseId, "canOutward");
    if (!name?.trim()) return res.status(422).json({ message: "warehouseId and company name are required" });
    const company = await prisma.warehouseCompany.create({ data: { warehouseId, name: name.trim() } });
    return res.status(201).json({ data: company });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "This company already exists in this warehouse." });
    return res.status(error.status || 500).json({ message: error.message || "Failed to create company" });
  }
}
 
 
export async function updateOutward(req, res) {
  try {
    const { id } = req.params;
    const data = req.body;
    const items = Array.isArray(data.items) ? data.items : [];
    const references = Array.isArray(data.referenceDocuments) ? data.referenceDocuments : [];
 
    const existing = await prisma.min.findUnique({
      where: { id },
      select: {
        id: true, warehouseId: true, outwardNumber: true,
        outwardType: true, customerName: true, companyName: true,
        refDocType: true, refDocNumber: true, ewayBillNumber: true,
        dispatchMode: true, vehicleNumber: true, remarks: true,
        items: { select: { category: true, sku: true, companyName: true, quantity: true, uom: true } },
      },
    });
    if (!existing) return res.status(404).json({ message: "Outward entry not found" });
    const warehouse = await assertWarehouseAccess(req, existing.warehouseId, "canOutward");
    if (!data.companyId || warehouse.companyId !== data.companyId) {
      return res.status(400).json({ message: "Selected company does not match this warehouse." });
    }
 
    if (!data.outwardType || !data.customerName?.trim() || !data.companyName?.trim()) {
      return res.status(422).json({ message: "Outward type, customer/recipient and company name are required." });
    }
    if (!references.length || !references.some((r) => r?.refDocNumber || r?.ewayBillNumber)) {
      return res.status(422).json({ message: "At least one reference document is required." });
    }
    if (!items.length) return res.status(422).json({ message: "At least one item is required." });
    for (const item of items) {
      if (!item.category || !item.sku?.trim() || Number(item.quantity) <= 0 || !item.uom) {
        return res.status(422).json({ message: "Every item must have category, model, quantity and UOM." });
      }
    }
 
    // Items new to this entry must exist in the product master
    // (items it already had are allowed even if the product was deleted since).
    const unknownItems = await findUnknownProducts(items, existing.items);
    if (unknownItems.length) {
      return res.status(422).json({ message: unknownProductsMessage(unknownItems) });
    }
 
    const normalizedRefs = references
      .filter((r) => r && (r.refDocNumber || r.ewayBillNumber))
      .map((r) => ({
        refDocType: String(r.refDocType || "Other").trim(),
        refDocNumber: String(r.refDocNumber || r.ewayBillNumber || "N/A").trim(),
        ewayBillNumber: r.ewayBillNumber ? String(r.ewayBillNumber).trim() : null,
      }));
 
    const newSnapshot = {
      outwardType: data.outwardType,
      customerName: data.customerName.trim(),
      companyName: data.companyName.trim(),
      refDocType: normalizedRefs[0].refDocType,
      refDocNumber: normalizedRefs[0].refDocNumber,
      ewayBillNumber: normalizedRefs[0].ewayBillNumber,
      dispatchMode: data.dispatchMode || null,
      vehicleNumber: data.vehicleNumber?.trim() || null,
      remarks: data.remarks?.trim() || null,
    };
    const newItems = items.map((item) => ({
      category: item.category, companyName: item.companyName ? String(item.companyName).trim() || null : null, sku: item.sku.trim(),
      quantity: Number(item.quantity), uom: item.uom,
    }));
    const fieldChanges = diffFields(existing, newSnapshot, [
      "outwardType", "customerName", "companyName", "refDocType", "refDocNumber",
      "ewayBillNumber", "dispatchMode", "vehicleNumber", "remarks",
    ]);
    const itemChanges = diffItems(existing.items, newItems);
 
    await prisma.$transaction(async (tx) => {
      // This entry's own current quantities are excluded from the outward total
      // (they're being replaced), and it may keep quantities it already had.
      const stock = await getWarehouseStock(tx, existing.warehouseId, { excludeOutwardId: id });
      const shortages = findShortages(newItems, stock, existing.items);
      if (shortages.length) {
        throw Object.assign(new Error(shortageMessage(shortages)), { status: 422 });
      }
 
      await tx.min.update({
        where: { id },
        data: {
          outwardType: data.outwardType,
          customerName: data.customerName.trim(),
          companyName: data.companyName.trim(),
          refDocType: normalizedRefs[0].refDocType,
          refDocNumber: normalizedRefs[0].refDocNumber,
          refDocDate: data.refDocDate ? new Date(data.refDocDate) : new Date(),
          ewayBillNumber: normalizedRefs[0].ewayBillNumber,
          dispatchMode: data.dispatchMode || null,
          vehicleNumber: data.vehicleNumber?.trim() || null,
          remarks: data.remarks?.trim() || null,
          items: {
            deleteMany: {},
            create: newItems,
          },
          referenceDocuments: {
            deleteMany: {},
            create: normalizedRefs,
          },
        },
      });
 
      // -------------------------------------------------
      // AUDIT TRAIL
      // -------------------------------------------------
      const auditBase = {
        entityType: "OUTWARD",
        entityId: id,
        entityNumber: existing.outwardNumber,
        userId: req.user.id,
        warehouseId: existing.warehouseId,
      };
      const auditEntries = [];
      for (const change of fieldChanges) {
        auditEntries.push({
          ...auditBase,
          action: "UPDATED",
          description: `${change.label} updated from "${change.oldValue || "—"}" to "${change.newValue || "—"}"`,
          changes: change,
        });
      }
      for (const item of itemChanges.added) {
        auditEntries.push({
          ...auditBase,
          action: "ITEM_ADDED",
          description: `Item added: ${describeItem(item)} — qty ${item.quantity} ${item.uom}`,
          changes: item,
        });
      }
      for (const item of itemChanges.removed) {
        auditEntries.push({
          ...auditBase,
          action: "ITEM_REMOVED",
          description: `Item removed: ${describeItem(item)} — qty ${item.quantity} ${item.uom}`,
          changes: item,
        });
      }
      for (const { item, oldQuantity, newQuantity } of itemChanges.updated) {
        auditEntries.push({
          ...auditBase,
          action: "ITEM_UPDATED",
          description: `Quantity updated for ${describeItem(item)} from ${oldQuantity} to ${newQuantity} ${item.uom}`,
          changes: { field: "quantity", item: describeItem(item), oldValue: oldQuantity, newValue: newQuantity },
        });
      }
      if (!auditEntries.length) {
        auditEntries.push({
          ...auditBase,
          action: "UPDATED",
          description: "Outward entry saved with no field changes",
        });
      }
      // One insert for the whole trail (see recordAuditLogs).
      await recordAuditLogs(tx, auditEntries);
    }, STOCK_TRANSACTION_OPTIONS);
 
    // Reloaded AFTER the transaction commits - it's only for the response, so it
    // doesn't need to hold the transaction open.
    const result = await prisma.min.findUnique({ where: { id }, include: { items: true, referenceDocuments: true } });
    return res.json({ message: "Outward entry updated successfully", data: result });
  } catch (error) {
    console.error("Update outward error:", error);
    if (error.code === "P2034") return res.status(409).json({ message: "Stock was just updated by someone else. Please try again." });
    return res.status(error.status || 500).json({ message: error.message || "Failed to update outward entry" });
  }
}
 
export async function createOutward(req, res) {
  try {
    const data = req.body;
    const items = Array.isArray(data.items) ? data.items : [];
    const references = Array.isArray(data.referenceDocuments) ? data.referenceDocuments : [];
 
    const warehouse = await assertWarehouseAccess(req, data.warehouseId, "canOutward");
 
    if (!data.companyId) return res.status(422).json({ message: "companyId is required" });
    if (warehouse.companyId !== data.companyId) {
      return res.status(400).json({ message: "Selected warehouse does not belong to the selected company" });
    }
    if (!data.outwardType) return res.status(422).json({ message: "outwardType is required" });
    if (!data.customerName?.trim()) return res.status(422).json({ message: "customerName is required" });
    if (!data.companyName?.trim()) return res.status(422).json({ message: "companyName is required" });
    if (!data.refDocNumber?.trim() && references.length === 0) return res.status(422).json({ message: "At least one document number is required" });
    if (!items.length) return res.status(422).json({ message: "At least one item is required" });
 
    for (const item of items) {
      if (!item.category || !item.sku?.trim()) return res.status(422).json({ message: "Each item category and model is required" });
      if (Number(item.quantity) <= 0) return res.status(422).json({ message: `Item "${item.sku}" must have a valid quantity` });
      if (!item.uom) return res.status(422).json({ message: `Item "${item.sku}" UOM is required` });
    }
 
    // Every item must exist in the product master managed by the admin.
    // The product check and the outward count don't depend on each other, so run
    // them together (one wait for the database instead of two).
    const [unknownItems, outwardCount] = await Promise.all([
      findUnknownProducts(items),
      prisma.min.count({ where: { warehouseId: warehouse.id } }),
    ]);
    if (unknownItems.length) {
      return res.status(422).json({ message: unknownProductsMessage(unknownItems) });
    }
 
    const normalizedRefs = (references.length ? references : [{ refDocType: data.refDocType || "Invoice", refDocNumber: data.refDocNumber, ewayBillNumber: data.ewayBillNumber }])
      .filter((r) => r && (r.refDocNumber || r.ewayBillNumber))
      .map((r) => ({ refDocType: String(r.refDocType || "Other").trim(), refDocNumber: String(r.refDocNumber || "").trim(), ewayBillNumber: r.ewayBillNumber ? String(r.ewayBillNumber).trim() : null }));
 
    if (!normalizedRefs.length) return res.status(422).json({ message: "At least one reference document is required" });
 
    // Numbering is warehouse-local: MIN-WHCODE-0001, MIN-WHCODE-0002, ...
    // (No separate "does this number exist" query: if two people get the same
    // number at the same moment, the unique constraint on outwardNumber rejects
    // the second save and we retry with the next number below.)
    const itemRows = items.map((item) => ({
      category: item.category,
      companyName: item.companyName ? String(item.companyName).trim() || null : null,
      sku: item.sku.trim(),
      quantity: Number(item.quantity),
      uom: item.uom,
    }));
 
    // Stock check + insert happen in ONE serializable transaction, so two
    // people dispatching the same stock at the same moment can't both get
    // through - the second one is refused (or asked to retry).
    // Inside it we only do the stock check and the inserts (items / reference
    // documents = one createMany insert each). The re-read for the response and
    // the audit log happen AFTER the commit, so the transaction stays short.
    let sequence = outwardCount + 1;
    let created = null;
    const MAX_NUMBER_ATTEMPTS = 10;
 
    for (let attempt = 1; attempt <= MAX_NUMBER_ATTEMPTS; attempt += 1) {
      const outwardNumber = `MIN-${warehouse.code}-${String(sequence).padStart(4, "0")}`;
      try {
        created = await prisma.$transaction(async (tx) => {
          const stock = await getWarehouseStock(tx, warehouse.id);
          const shortages = findShortages(items, stock);
          if (shortages.length) {
            throw Object.assign(new Error(shortageMessage(shortages)), { status: 422 });
          }
 
          return tx.min.create({
            data: {
              outwardNumber,
              warehouseId: warehouse.id,
              outwardType: data.outwardType,
              customerName: data.customerName.trim(),
              companyName: data.companyName.trim(),
              refDocType: normalizedRefs[0].refDocType,
              refDocNumber: normalizedRefs[0].refDocNumber || normalizedRefs[0].ewayBillNumber || "N/A",
              refDocDate: data.outwardDateTime ? new Date(data.outwardDateTime) : (data.refDocDate ? new Date(data.refDocDate) : new Date()),
              ewayBillNumber: normalizedRefs[0].ewayBillNumber,
              dispatchMode: data.dispatchMode || null,
              vehicleNumber: data.vehicleNumber || null,
              remarks: data.remarks || null,
              createdById: req.user.id,
              items: { createMany: { data: itemRows } },
              referenceDocuments: { createMany: { data: normalizedRefs } },
            },
            // Only what we need - no include, so Prisma skips the extra re-read queries.
            select: { id: true, outwardNumber: true, warehouseId: true },
          });
        }, STOCK_TRANSACTION_OPTIONS);
        break;
      } catch (err) {
        const isNumberClash =
          err?.code === "P2002" && String(err?.meta?.target ?? "").includes("outwardNumber");
        if (isNumberClash && attempt < MAX_NUMBER_ATTEMPTS) {
          sequence += 1;
          continue;
        }
        throw err;
      }
    }
 
    // After the commit: read the saved entry back and write the audit trail at
    // the same time. recordAuditLog never throws, so a failed audit write can't
    // fail the outward entry.
    const [result] = await Promise.all([
      prisma.min.findUnique({ where: { id: created.id }, include: { items: true, referenceDocuments: true } }),
      recordAuditLog(prisma, {
        entityType: "OUTWARD",
        entityId: created.id,
        entityNumber: created.outwardNumber,
        action: "CREATED",
        description: `Outward entry ${created.outwardNumber} created with ${itemRows.length} item${itemRows.length === 1 ? "" : "s"}`,
        userId: req.user.id,
        warehouseId: created.warehouseId,
      }),
    ]);
 
    return res.status(201).json({ message: "Outward entry created successfully", data: { ...result, documents: [], ...documentStatus([]) } });
  } catch (error) {
    console.error("Create outward error:", error);
    if (error.code === "P2034") return res.status(409).json({ message: "Stock was just updated by someone else. Please try again." });
    return res.status(error.status || 500).json({ message: error.message || "Failed to create outward entry", error: error.message });
  }
}
 
/**
 * =========================================================
 * GET /api/outward/history
 * =========================================================
 *
 * Activity feed across ALL outward entries the caller can see
 * (same warehouse scoping as listOutward). Newest first.
 * =========================================================
 */
 
export async function listOutwardHistory(req, res) {
  try {
    const {
      warehouseId,
      search = "",
      page = "1",
      pageSize = "20",
    } = req.query;
 
    const scopedWarehouseIds = await getScopedWarehouseIds(req);
 
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const pageSizeNum = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
 
    const where = {
      entityType: "OUTWARD",
      AND: [
        scopedWarehouseIds ? { warehouseId: { in: scopedWarehouseIds } } : {},
        warehouseId ? { warehouseId } : {},
        search ? { entityNumber: { contains: search, mode: "insensitive" } } : {},
      ],
    };
 
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
        include: { user: { select: { name: true, role: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
 
    return res.json({
      data: rows,
      pagination: {
        page: pageNum,
        pageSize: pageSizeNum,
        total,
        totalPages: Math.ceil(total / pageSizeNum),
      },
    });
  } catch (error) {
    console.error("List outward history error:", error);
    return res.status(500).json({ message: "Failed to fetch history", error: error.message });
  }
}
 







