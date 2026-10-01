import { randomUUID } from "node:crypto";
import prisma from "../config/prisma.js";
import { supabase, SUPABASE_BUCKET } from "../config/supabase.js";
import { recordAuditLog, recordAuditLogs, diffFields, diffItems, describeItem } from "../utils/auditLog.js";
import { storeOutwardFiles } from "./documentController.js";
import { outwardFolder } from "../utils/outwardWorkflow.js";
import { findUnknownProducts, unknownProductsMessage } from "../utils/productCatalog.js";
import { getWarehouseStock, findShortages, shortageMessage } from "../utils/stock.js";
import {
  STATUS,
  SALES_EDITABLE_STATUSES,
  REJECTABLE_STATUSES,
  APPROVABLE_STATUSES,
  itemsFingerprint,
  WAREHOUSE_VISIBLE_STATUSES,
  HIDDEN_FROM_WAREHOUSE_ACTIONS,
  isFinanceSide,
  getUserCompanyIds,
  sanitizeForWarehouse,
  shapeForFinance,
  validateItemCost,
  toItemRow,
  proofKeyProblem,
} from "../utils/outwardWorkflow.js";

const DEFAULT_DOCUMENT_TYPES = ["Delivery challan", "E-way bill", "Dispatch photo"];

// Create / edit run the stock check and the save in one serializable transaction.
const STOCK_TRANSACTION_OPTIONS = { isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 };

const httpError = (status, message) => Object.assign(new Error(message), { status });

// Sales-side entries have no dispatch details yet. The Min table requires these
// columns, so they hold a placeholder until the warehouse manager dispatches.
const PLACEHOLDER = "Pending";

// What each role gets back for an entry.
const shapeFor = (req, entry) =>
  req.user.role === "WAREHOUSE_MANAGER" ? sanitizeForWarehouse(entry) : shapeForFinance(entry);

// ---------------------------------------------------------------------------
// Scoping
// ---------------------------------------------------------------------------
async function getScopedWarehouseIds(req) {
  const role = req.user.role;
  if (role === "SUPER_ADMIN") return null;
  if (role === "WAREHOUSE_MANAGER") {
    const rows = await prisma.warehouseAccess.findMany({
      where: { userId: req.user.id, accessLevel: "MANAGE" },
      select: { warehouseId: true },
    });
    return rows.map((r) => r.warehouseId);
  }
  if (isFinanceSide(role)) {
    const companyIds = await getUserCompanyIds(req.user);
    if (!companyIds.length) return [];
    const rows = await prisma.warehouse.findMany({ where: { companyId: { in: companyIds } }, select: { id: true } });
    return rows.map((r) => r.id);
  }
  return [];
}

// Extra list filter that depends on who is asking.
function roleWhere(req) {
  switch (req.user.role) {
    // Own entries + entries the super admin created (warehouse scope already limits these to the user's company).
    case "SALES": return { OR: [{ createdById: req.user.id }, { createdBy: { role: "SUPER_ADMIN" } }] };
    case "WAREHOUSE_MANAGER": return { status: { in: WAREHOUSE_VISIBLE_STATUSES } };
    default: return {};
  }
}

async function assertWarehouseAccess(req, warehouseId, permission = "canOutward") {
  if (!warehouseId) throw httpError(400, "warehouseId is required");

  const warehouse = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, code: true, companyId: true, Outward: true, company: { select: { id: true, name: true, status: true } } },
  });
  if (!warehouse) throw httpError(404, "Warehouse not found");
  if (warehouse.company?.status === "Inactive") throw httpError(403, "This warehouse belongs to an inactive company.");
  if (permission === "canOutward" && warehouse.Outward !== "Active") throw httpError(403, "Outward is disabled for this warehouse.");

  if (req.user.role === "SUPER_ADMIN") return warehouse;

  // SALES / ACCOUNT: access comes from the company they belong to.
  if (isFinanceSide(req.user.role)) {
    const companyIds = await getUserCompanyIds(req.user);
    if (!warehouse.companyId || !companyIds.includes(warehouse.companyId)) {
      throw httpError(403, "You don't have access to this warehouse");
    }
    if (permission === "canOutward" && req.user.role !== "SALES") {
      throw httpError(403, "Only Sales can create or edit outward entries");
    }
    return warehouse;
  }

  const access = await prisma.warehouseAccess.findUnique({
    where: { userId_warehouseId: { userId: req.user.id, warehouseId } },
  });
  if (!access || access.accessLevel !== "MANAGE") throw httpError(403, "You don't have access to this warehouse");
  if (permission && !access[permission]) throw httpError(403, "You don't have permission to do this on this warehouse");
  return warehouse;
}

// Can this user open this one entry at all?
async function assertEntryVisible(req, min) {
  const role = req.user.role;
  if (role === "SUPER_ADMIN") return;
  if (role === "SALES") {
    if (min.createdById !== req.user.id) {
      // Entries created by the super admin are visible too, but only for the Sales user's own company.
      const creator = await prisma.user.findUnique({ where: { id: min.createdById }, select: { role: true } });
      if (creator?.role !== "SUPER_ADMIN") throw httpError(403, "You can only view outward entries you created");
      await assertWarehouseAccess(req, min.warehouseId, null);
    }
    return;
  }
  if (role === "ACCOUNT") {
    await assertWarehouseAccess(req, min.warehouseId, null);
    return;
  }
  if (role === "WAREHOUSE_MANAGER") {
    const access = await prisma.warehouseAccess.findUnique({
      where: { userId_warehouseId: { userId: req.user.id, warehouseId: min.warehouseId } },
    });
    if (!access || access.accessLevel !== "MANAGE") throw httpError(403, "You don't have access to this entry's warehouse");
    if (!WAREHOUSE_VISIBLE_STATUSES.includes(min.status)) throw httpError(403, "This entry is not ready for the warehouse yet");
    return;
  }
  throw httpError(403, "Not allowed");
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

// `status` in the response has always meant the documents checklist
// ("Complete" / "Pending"), and the frontend relies on that. The workflow
// status is therefore sent as `workflowStatus` (never sent to warehouse managers).
function finishFor(req, entry, allDocs) {
  const shaped = shapeFor(req, entry);
  const workflowStatus = req.user.role === "WAREHOUSE_MANAGER" ? undefined : entry.status;
  // Dispatch documents reach Sales / Account only after the warehouse manager
  // has filled the dispatch details (status DISPATCHED). The super admin does
  // not see the documents section while the entry is still at the approval
  // stage (PENDING_APPROVAL / REJECTED) - only from dispatch details onwards.
  let docsVisible = true;
  if (isFinanceSide(req.user.role)) docsVisible = entry.status === STATUS.DISPATCHED;
  else if (req.user.role === "SUPER_ADMIN") docsVisible = [STATUS.PENDING_DISPATCH, STATUS.DISPATCHED].includes(entry.status);
  const docs = docsVisible ? allDocs : [];
  return { ...shaped, workflowStatus, ...documentStatus(docs), documents: docs };
}

const plainItem = (i) => ({ category: i.category, sku: i.sku, companyName: i.companyName, quantity: i.quantity, uom: i.uom });

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------
export async function listOutward(req, res) {
  try {
    const { search = "", type, status, dateFrom, dateTo, warehouseId, page = "1", pageSize = "20" } = req.query;
    const scopedWarehouseIds = await getScopedWarehouseIds(req);
    const where = {
      AND: [
        scopedWarehouseIds ? { warehouseId: { in: scopedWarehouseIds } } : {},
        warehouseId ? { warehouseId } : {},
        roleWhere(req),
        status && Object.values(STATUS).includes(status) ? { status } : {},
        search ? { OR: [
          { outwardNumber: { contains: search, mode: "insensitive" } },
          { customerName: { contains: search, mode: "insensitive" } },
          { companyName: { contains: search, mode: "insensitive" } },
          { refDocNumber: { contains: search, mode: "insensitive" } },
        ] } : {},
        type ? { outwardType: type } : {},
        dateFrom || dateTo ? { createdAt: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
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
    const data = rows.map((row) => finishFor(req, row, documents.filter((d) => d.linkedId === row.id)));

    return res.json({ data, pagination: { page: pageNum, pageSize: pageSizeNum, total, totalPages: Math.ceil(total / pageSizeNum) } });
  } catch (error) {
    console.error("List outward error:", error);
    return res.status(500).json({ message: "Failed to fetch outward entries", error: error.message });
  }
}

// ---------------------------------------------------------------------------
// GET ONE
// ---------------------------------------------------------------------------
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
    await assertEntryVisible(req, min);

    const documents = await prisma.document.findMany({ where: { linkedType: "outward", linkedId: min.id }, orderBy: { uploadedAt: "desc" } });
    return res.json({ data: finishFor(req, min, documents) });
  } catch (error) {
    console.error("Get outward error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch outward entry" });
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
 
 
// ---------------------------------------------------------------------------
// Validation shared by create + update (Sales side: customer + items + cost)
// ---------------------------------------------------------------------------
function validateSalesPayload(data, items) {
  if (!data.outwardType) return "outwardType is required";
  if (!data.customerName?.trim()) return "customerName is required";
  if (!data.companyName?.trim()) return "companyName is required";
  if (!items.length) return "At least one item is required";
  for (const [index, item] of items.entries()) {
    const label = `Item ${index + 1}`;
    if (!item.category || !item.sku?.trim()) return `${label}: category and model are required`;
    if (Number(item.quantity) <= 0) return `${label}: quantity must be greater than 0`;
    if (!item.uom) return `${label}: UOM is required`;
    const costError = validateItemCost(item, label);
    if (costError) return costError;
  }
  return null;
}

// Only quantity-level facts go into audit rows that the warehouse can read.
const costFingerprint = (i) => JSON.stringify([Number(i.cost ?? 0), i.costStatus || null, i.utrNumber || null, Boolean(i.proofFileKey)]);
const itemMatchKey = (i) => [i.category, i.sku, i.uom].join("::").toLowerCase();


// Moves proofs that were picked before the entry existed (uploads/<id>/...) into min/<outward number>/.
// Runs in parallel; a proof that fails to move simply stays where it is (it still downloads fine).
async function moveTempProofs(minId, outwardNumber) {
  const rows = await prisma.minItem.findMany({
    where: { minId, proofFileKey: { startsWith: "uploads/" } },
    select: { id: true, proofFileKey: true },
  });
  if (!rows.length) return;
  const folder = outwardFolder(outwardNumber);
  await Promise.all(
    rows.map(async (row) => {
      const target = `${folder}${row.proofFileKey.split("/").pop()}`;
      const { error } = await supabase.storage.from(SUPABASE_BUCKET).move(row.proofFileKey, target);
      if (error) return console.error("Proof move failed:", row.proofFileKey, error.message);
      await prisma.minItem.update({ where: { id: row.id }, data: { proofFileKey: target } });
    })
  );
}

// ---------------------------------------------------------------------------
// CREATE  (Sales, Super admin)  ->  status PENDING_APPROVAL
// ---------------------------------------------------------------------------
export async function createOutward(req, res) {
  try {
    const data = req.body;
    const items = Array.isArray(data.items) ? data.items : [];

    const warehouse = await assertWarehouseAccess(req, data.warehouseId, "canOutward");

    if (!data.companyId) return res.status(422).json({ message: "companyId is required" });
    if (warehouse.companyId !== data.companyId) {
      return res.status(400).json({ message: "Selected warehouse does not belong to the selected company" });
    }
    const problem = validateSalesPayload(data, items);
    if (problem) return res.status(422).json({ message: problem });

    // The id is chosen up front so the payment proofs could be uploaded straight into
    // min/<warehouse code>/<id>/ before the entry exists.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const newMinId = UUID_RE.test(String(data.id || "")) ? String(data.id).toLowerCase() : randomUUID();
    const proofProblem = proofKeyProblem(items, newMinId);
    if (proofProblem) return res.status(422).json({ message: proofProblem });

    const [unknownItems, outwardCount] = await Promise.all([
      findUnknownProducts(items),
      prisma.min.count({ where: { warehouseId: warehouse.id } }),
    ]);
    if (unknownItems.length) return res.status(422).json({ message: unknownProductsMessage(unknownItems) });

    const itemRows = items.map((item) => toItemRow(item));

    let sequence = outwardCount + 1;
    let created = null;
    const MAX_NUMBER_ATTEMPTS = 10;

    for (let attempt = 1; attempt <= MAX_NUMBER_ATTEMPTS; attempt += 1) {
      const outwardNumber = `MIN-${warehouse.code}-${String(sequence).padStart(4, "0")}`;
      try {
        created = await prisma.$transaction(async (tx) => {
          // Stock is reserved as soon as Sales submits (rejected entries release it again).
          const stock = await getWarehouseStock(tx, warehouse.id, { onlyItems: items });
          const shortages = findShortages(items, stock);
          if (shortages.length) throw httpError(422, shortageMessage(shortages));

          return tx.min.create({
            data: {
              id: newMinId,
              outwardNumber,
              warehouseId: warehouse.id,
              outwardType: data.outwardType,
              customerName: data.customerName.trim(),
              companyName: data.companyName.trim(),
              refDocType: PLACEHOLDER,
              refDocNumber: PLACEHOLDER,
              refDocDate: data.outwardDateTime ? new Date(data.outwardDateTime) : new Date(),
              status: STATUS.PENDING_APPROVAL,
              createdById: req.user.id,
              items: { createMany: { data: itemRows } },
            },
            select: { id: true, outwardNumber: true, warehouseId: true },
          });
        }, STOCK_TRANSACTION_OPTIONS);
        break;
      } catch (err) {
        const isNumberClash = err?.code === "P2002" && String(err?.meta?.target ?? "").includes("outwardNumber");
        if (isNumberClash && attempt < MAX_NUMBER_ATTEMPTS) { sequence += 1; continue; }
        throw err;
      }
    }

    await moveTempProofs(created.id, created.outwardNumber);

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

    return res.status(201).json({ message: "Outward entry submitted for account approval", data: finishFor(req, result, []) });
  } catch (error) {
    console.error("Create outward error:", error);
    if (error.code === "P2034") return res.status(409).json({ message: "Stock was just updated by someone else. Please try again." });
    return res.status(error.status || 500).json({ message: error.message || "Failed to create outward entry" });
  }
}

// ---------------------------------------------------------------------------
// UPDATE  (Sales until dispatch, Super admin any time)
// PENDING_APPROVAL / REJECTED  -> always (re)submitted to Account.
// PENDING_DISPATCH             -> back to Account only when cost / item details
//                                 changed; header-only edits keep it approved.
// DISPATCHED                   -> Super admin only, status unchanged.
// ---------------------------------------------------------------------------
export async function updateOutward(req, res) {
  try {
    const { id } = req.params;
    const data = req.body;
    const items = Array.isArray(data.items) ? data.items : [];

    const existing = await prisma.min.findUnique({
      where: { id },
      select: {
        id: true, warehouseId: true, outwardNumber: true, status: true, createdById: true,
        outwardType: true, customerName: true, companyName: true,
        refDocType: true, refDocNumber: true, ewayBillNumber: true,
        dispatchMode: true, vehicleNumber: true, remarks: true,
        items: true,
      },
    });
    if (!existing) return res.status(404).json({ message: "Outward entry not found" });

    const isAdmin = req.user.role === "SUPER_ADMIN";
    if (!isAdmin) {
      // Sales can edit entries they created themselves, or entries created by the super admin
      // (company access is still enforced below by assertWarehouseAccess).
      if (existing.createdById !== req.user.id) {
        const creator = await prisma.user.findUnique({ where: { id: existing.createdById }, select: { role: true } });
        if (creator?.role !== "SUPER_ADMIN") {
          return res.status(403).json({ message: "You can only edit outward entries you created or that the admin created" });
        }
      }
      if (!SALES_EDITABLE_STATUSES.includes(existing.status)) {
        return res.status(409).json({ message: "This entry has been dispatched and can no longer be edited" });
      }
    }

    const warehouse = await assertWarehouseAccess(req, existing.warehouseId, "canOutward");
    const proofProblem = proofKeyProblem(items, id, existing.outwardNumber);
    if (proofProblem) return res.status(422).json({ message: proofProblem });
    if (!data.companyId || warehouse.companyId !== data.companyId) {
      return res.status(400).json({ message: "Selected company does not match this warehouse." });
    }

    // A row that still holds its old proof file says keepProof: true.
    const existingById = new Map(existing.items.map((i) => [i.id, i]));
    const normalized = items.map((item) => {
      const previous = existingById.get(item.serverId);
      return { ...item, keepProof: item.keepProof === true && Boolean(previous?.proofFileKey) };
    });

    const problem = validateSalesPayload(data, normalized);
    if (problem) return res.status(422).json({ message: problem });

    const unknownItems = await findUnknownProducts(normalized, existing.items);
    if (unknownItems.length) return res.status(422).json({ message: unknownProductsMessage(unknownItems) });

    const newItems = normalized.map((item) => toItemRow(item, existingById.get(item.serverId)));

    // Update after dispatch (Super admin): the same save also carries the dispatch details.
    let dispatchUpdate = null;
    if (isAdmin && existing.status === STATUS.DISPATCHED && data.dispatch) {
      const d = data.dispatch;
      if (!d.dispatchMode) return res.status(422).json({ message: "Dispatch mode is required" });
      const refs = (Array.isArray(d.referenceDocuments) ? d.referenceDocuments : [])
        .filter((r) => r && (r.refDocNumber || r.ewayBillNumber))
        .map((r) => ({
          refDocType: String(r.refDocType || "Other").trim(),
          refDocNumber: String(r.refDocNumber || r.ewayBillNumber || "N/A").trim(),
          ewayBillNumber: r.ewayBillNumber ? String(r.ewayBillNumber).trim() : null,
        }));
      if (!refs.length) return res.status(422).json({ message: "At least one reference document is required" });
      dispatchUpdate = {
        refs,
        snapshot: {
          refDocType: refs[0].refDocType,
          refDocNumber: refs[0].refDocNumber,
          ewayBillNumber: refs[0].ewayBillNumber,
          dispatchMode: d.dispatchMode,
          vehicleNumber: d.vehicleNumber?.trim() || null,
          remarks: d.remarks?.trim() || null,
        },
      };
    }

    const newSnapshot = {
      outwardType: data.outwardType,
      customerName: data.customerName.trim(),
      companyName: data.companyName.trim(),
    };
    const fieldChanges = diffFields(existing, newSnapshot, ["outwardType", "customerName", "companyName"]);
    const itemChanges = diffItems(existing.items, newItems);

    // Cost side changes are logged in one line that warehouse managers never see.
    const oldByKey = new Map(existing.items.map((i) => [itemMatchKey(i), i]));
    const costChanged = newItems.some((n) => {
      const o = oldByKey.get(itemMatchKey(n));
      return !o || costFingerprint(o) !== costFingerprint(n);
    });

    let sentForApproval = false;

    await prisma.$transaction(async (tx) => {
      // Re-read the status inside the transaction: Account / warehouse may have acted meanwhile.
      const current = await tx.min.findUnique({ where: { id }, select: { status: true } });
      if (!current) throw httpError(404, "Outward entry not found");
      if (!isAdmin && !SALES_EDITABLE_STATUSES.includes(current.status)) {
        throw httpError(409, "This entry has been dispatched and can no longer be edited");
      }
      const wasRejected = current.status === STATUS.REJECTED;
      const wasApproved = current.status === STATUS.PENDING_DISPATCH;
      // ANY update (Sales or super admin) on an approved, not-yet-dispatched entry sends it back for
      // approval again. A dispatched entry edited by the super admin keeps its status.
      const resubmit = current.status === STATUS.PENDING_APPROVAL || wasRejected || wasApproved;
      sentForApproval = resubmit;

      const stock = await getWarehouseStock(tx, existing.warehouseId, { excludeOutwardId: id, onlyItems: [...newItems, ...existing.items] });
      const shortages = findShortages(newItems, stock, existing.items);
      if (shortages.length) throw httpError(422, shortageMessage(shortages));

      await tx.min.update({
        where: { id },
        data: {
          outwardType: data.outwardType,
          customerName: data.customerName.trim(),
          companyName: data.companyName.trim(),
          ...(data.outwardDateTime ? { refDocDate: new Date(data.outwardDateTime) } : {}),
          ...(dispatchUpdate ? dispatchUpdate.snapshot : {}),
          ...(resubmit
            ? { status: STATUS.PENDING_APPROVAL, approvedById: null, approvedByName: null, approvedAt: null, approvalRemarks: null }
            : {}),
          items: { deleteMany: {}, create: newItems },
          ...(dispatchUpdate ? { referenceDocuments: { deleteMany: {}, create: dispatchUpdate.refs } } : {}),
        },
      });

      const base = {
        entityType: "OUTWARD", entityId: id, entityNumber: existing.outwardNumber,
        userId: req.user.id, warehouseId: existing.warehouseId,
      };
      const entries = [];
      if (dispatchUpdate) {
        const dispatchChanges = diffFields(existing, dispatchUpdate.snapshot, ["refDocType", "refDocNumber", "ewayBillNumber", "dispatchMode", "vehicleNumber", "remarks"]);
        for (const c of dispatchChanges) {
          entries.push({ ...base, action: "UPDATED", description: `${c.label} updated from "${c.oldValue || "—"}" to "${c.newValue || "—"}"`, changes: c });
        }
      }
      for (const change of fieldChanges) {
        entries.push({ ...base, action: "UPDATED", description: `${change.label} updated from "${change.oldValue || "—"}" to "${change.newValue || "—"}"`, changes: change });
      }
      for (const item of itemChanges.added) {
        entries.push({ ...base, action: "ITEM_ADDED", description: `Item added: ${describeItem(item)} — qty ${item.quantity} ${item.uom}`, changes: plainItem(item) });
      }
      for (const item of itemChanges.removed) {
        entries.push({ ...base, action: "ITEM_REMOVED", description: `Item removed: ${describeItem(item)} — qty ${item.quantity} ${item.uom}`, changes: plainItem(item) });
      }
      for (const { item, oldQuantity, newQuantity } of itemChanges.updated) {
        entries.push({ ...base, action: "ITEM_UPDATED", description: `Quantity updated for ${describeItem(item)} from ${oldQuantity} to ${newQuantity} ${item.uom}`, changes: { field: "quantity", item: describeItem(item), oldValue: oldQuantity, newValue: newQuantity } });
      }
      if (costChanged) entries.push({ ...base, action: "COST_UPDATED", description: "Cost details updated" });
      if (wasRejected) entries.push({ ...base, action: "RESUBMITTED", description: "Resubmitted for account approval" });
      else if (wasApproved) entries.push({ ...base, action: "RESUBMITTED", description: "Updated after approval - sent for account approval again" });
      if (!entries.length) entries.push({ ...base, action: "UPDATED", description: "Outward entry saved with no field changes" });
      await recordAuditLogs(tx, entries);
    }, STOCK_TRANSACTION_OPTIONS);

    // Same shape as GET /:id, so the client never shows a half-filled or stale entry after an edit.
    const result = await prisma.min.findUnique({
      where: { id },
      include: {
        items: true,
        referenceDocuments: true,
        createdBy: { select: { name: true, email: true, role: true } },
        warehouse: { select: { id: true, name: true, code: true, companyId: true, Inward: true, Outward: true, company: { select: { name: true, status: true } } } },
      },
    });
    const documents = await prisma.document.findMany({ where: { linkedType: "outward", linkedId: id }, orderBy: { uploadedAt: "desc" } });
    return res.json({ message: sentForApproval ? "Outward entry saved and sent for account approval" : "Outward entry updated successfully", data: finishFor(req, result, documents) });
  } catch (error) {
    console.error("Update outward error:", error);
    if (error.code === "P2034") return res.status(409).json({ message: "Stock was just updated by someone else. Please try again." });
    return res.status(error.status || 500).json({ message: error.message || "Failed to update outward entry" });
  }
}

// ---------------------------------------------------------------------------
// APPROVE (only while PENDING_APPROVAL) / REJECT (until dispatch)  (Account, Super admin)
// ---------------------------------------------------------------------------
async function loadForDecision(req, allowedStatuses, notAllowedMessage) {
  const min = await prisma.min.findUnique({
    where: { id: req.params.id },
    select: { id: true, outwardNumber: true, warehouseId: true, status: true, createdById: true },
  });
  if (!min) throw httpError(404, "Outward entry not found");
  await assertEntryVisible(req, min);
  if (!allowedStatuses.includes(min.status)) throw httpError(409, notAllowedMessage);
  return min;
}

export async function approveOutward(req, res) {
  try {
    const min = await loadForDecision(req, APPROVABLE_STATUSES, "This entry is not waiting for approval");
    const remarks = req.body?.remarks?.trim() || null;

    // Guard against a double click / two approvers: only flips if it is still pending.
    const { count } = await prisma.min.updateMany({
      where: { id: min.id, status: { in: APPROVABLE_STATUSES } },
      data: {
        status: STATUS.PENDING_DISPATCH,
        approvedById: req.user.id,
        approvedByName: req.user.name,
        approvedAt: new Date(),
        approvalRemarks: remarks,
      },
    });
    if (!count) return res.status(409).json({ message: "This entry was just updated by someone else" });

    await recordAuditLog(prisma, {
      entityType: "OUTWARD", entityId: min.id, entityNumber: min.outwardNumber,
      action: "APPROVED", description: `Cost approved by ${req.user.name}${remarks ? ` — ${remarks}` : ""}`,
      userId: req.user.id, warehouseId: min.warehouseId,
    });
    return res.json({ message: "Approved. Sent to the warehouse manager for dispatch." });
  } catch (error) {
    console.error("Approve outward error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to approve" });
  }
}

export async function rejectOutward(req, res) {
  try {
    const min = await loadForDecision(req, REJECTABLE_STATUSES, "This entry can no longer be rejected (already dispatched or rejected)");
    const remarks = req.body?.remarks?.trim();
    if (!remarks) return res.status(422).json({ message: "Please give a reason for rejecting" });

    const { count } = await prisma.min.updateMany({
      where: { id: min.id, status: { in: REJECTABLE_STATUSES } },
      data: {
        status: STATUS.REJECTED,
        approvedById: req.user.id,
        approvedByName: req.user.name,
        approvedAt: new Date(),
        approvalRemarks: remarks,
      },
    });
    if (!count) return res.status(409).json({ message: "This entry was just updated by someone else" });

    await recordAuditLog(prisma, {
      entityType: "OUTWARD", entityId: min.id, entityNumber: min.outwardNumber,
      action: "REJECTED", description: `Rejected by ${req.user.name} — ${remarks}`,
      userId: req.user.id, warehouseId: min.warehouseId,
    });
    return res.json({ message: "Rejected. Sales can edit and resubmit." });
  } catch (error) {
    console.error("Reject outward error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to reject" });
  }
}

// ---------------------------------------------------------------------------
// DISPATCH  (Warehouse manager, Super admin)
// Fills the dispatch details on an approved entry. Items / cost are not touched.
// After this the entry is locked - only a Super admin can change it again.
// ---------------------------------------------------------------------------
export async function dispatchOutward(req, res) {
  try {
    const { id } = req.params;
    // JSON body, or multipart: payload (JSON string) + files + categories (JSON array, one per file).
    let data = req.body || {};
    let categories = [];
    if (typeof data.payload === "string") {
      try {
        categories = JSON.parse(data.categories || "[]");
        data = JSON.parse(data.payload);
      } catch {
        return res.status(422).json({ message: "Invalid dispatch data" });
      }
    }
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length !== categories.length && files.length) return res.status(422).json({ message: "Each document needs a name" });
    const references = Array.isArray(data.referenceDocuments) ? data.referenceDocuments : [];

    const existing = await prisma.min.findUnique({
      where: { id },
      select: {
        id: true, warehouseId: true, outwardNumber: true, status: true,
        refDocType: true, refDocNumber: true, ewayBillNumber: true,
        dispatchMode: true, vehicleNumber: true, remarks: true,
      },
    });
    if (!existing) return res.status(404).json({ message: "Outward entry not found" });

    const warehouse = await assertWarehouseAccess(req, existing.warehouseId, "canOutward");
    // The warehouse manager (and super admin) fill the dispatch details and can keep updating them
    // after dispatch: reference documents, dispatch mode, vehicle number, remarks (documents via upload).
    const allowedStatuses = [STATUS.PENDING_DISPATCH, STATUS.DISPATCHED];
    if (!allowedStatuses.includes(existing.status)) {
      // Same message whatever the reason, so nothing about approval leaks to the warehouse.
      return res.status(409).json({ message: "This entry is not ready for dispatch" });
    }

    if (!data.dispatchMode) return res.status(422).json({ message: "Dispatch mode is required" });
    const normalizedRefs = references
      .filter((r) => r && (r.refDocNumber || r.ewayBillNumber))
      .map((r) => ({
        refDocType: String(r.refDocType || "Other").trim(),
        refDocNumber: String(r.refDocNumber || r.ewayBillNumber || "N/A").trim(),
        ewayBillNumber: r.ewayBillNumber ? String(r.ewayBillNumber).trim() : null,
      }));
    if (!normalizedRefs.length) return res.status(422).json({ message: "At least one reference document is required" });

    const newSnapshot = {
      refDocType: normalizedRefs[0].refDocType,
      refDocNumber: normalizedRefs[0].refDocNumber,
      ewayBillNumber: normalizedRefs[0].ewayBillNumber,
      dispatchMode: data.dispatchMode,
      vehicleNumber: data.vehicleNumber?.trim() || null,
      remarks: data.remarks?.trim() || null,
    };
    const changes = existing.status === STATUS.DISPATCHED
      ? diffFields(existing, newSnapshot, ["refDocType", "refDocNumber", "ewayBillNumber", "dispatchMode", "vehicleNumber", "remarks"])
      : [];

    // Files go to storage first (in parallel); the database write below then saves the dispatch
    // details and the document rows together in one go.
    const uploaded = files.length ? await storeOutwardFiles(files, categories, existing.outwardNumber) : [];
    let replaced = [];

    // Guarded write: only applies while the entry is still in a status this user may dispatch from
    // (Sales / Account may have pulled it back for re-approval in the meantime).
    try {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.min.updateMany({
          where: { id, status: { in: allowedStatuses } },
          data: {
            ...newSnapshot,
            ...(data.outwardDateTime ? { refDocDate: new Date(data.outwardDateTime) } : {}),
            status: STATUS.DISPATCHED,
            // Who / when dispatched is set once, on the first save only.
            ...(existing.status === STATUS.PENDING_DISPATCH
              ? { dispatchedById: req.user.id, dispatchedByName: req.user.name, dispatchedAt: new Date() }
              : {}),
          },
        });
        if (!count) throw httpError(409, "This entry is not ready for dispatch");
        await tx.min.update({ where: { id }, data: { referenceDocuments: { deleteMany: {}, create: normalizedRefs } } });

        if (uploaded.length) {
          // A new file for a document that already exists replaces it.
          const names = new Set(uploaded.map((u) => u.docCategory.trim().toLowerCase()));
          const old = await tx.document.findMany({ where: { linkedType: "outward", linkedId: id }, select: { id: true, fileKey: true, docCategory: true } });
          replaced = old.filter((d) => names.has(String(d.docCategory || "").trim().toLowerCase()));
          if (replaced.length) await tx.document.deleteMany({ where: { id: { in: replaced.map((d) => d.id) } } });
          await tx.document.createMany({
            data: uploaded.map((u) => ({
              linkedType: "outward", linkedId: id, docCategory: u.docCategory,
              fileKey: u.fileKey, fileType: u.fileType, fileSize: u.fileSize, uploadedById: req.user.id,
            })),
          });
        }
      });
    } catch (txError) {
      if (uploaded.length) await supabase.storage.from(SUPABASE_BUCKET).remove(uploaded.map((u) => u.fileKey)).catch(() => {});
      throw txError;
    }
    if (replaced.length) supabase.storage.from(SUPABASE_BUCKET).remove(replaced.map((d) => d.fileKey)).catch((err) => console.error("Old document cleanup failed:", err));

    const base = { entityType: "OUTWARD", entityId: id, entityNumber: existing.outwardNumber, userId: req.user.id, warehouseId: existing.warehouseId };
    const entries = existing.status === STATUS.PENDING_DISPATCH
      ? [{ ...base, action: "DISPATCHED", description: `Dispatched (${data.dispatchMode}${newSnapshot.vehicleNumber ? `, ${newSnapshot.vehicleNumber}` : ""})` }]
      : changes.map((c) => ({ ...base, action: "UPDATED", description: `${c.label} updated from "${c.oldValue || "—"}" to "${c.newValue || "—"}"`, changes: c }));
    for (const u of uploaded) {
      entries.push({ ...base, action: "DOCUMENT_ADDED", description: `Document added: ${u.docCategory} (${u.fileName})`, changes: { docCategory: u.docCategory, fileName: u.fileName } });
    }
    // The save already succeeded - the audit trail is written in the background.
    if (entries.length) recordAuditLogs(prisma, entries).catch((err) => console.error("Audit log (dispatch) failed:", err));

    const [result, documents] = await Promise.all([
      prisma.min.findUnique({ where: { id }, include: { items: true, referenceDocuments: true } }),
      prisma.document.findMany({ where: { linkedType: "outward", linkedId: id } }),
    ]);
    return res.json({ message: "Dispatch details saved", data: finishFor(req, result, documents) });
  } catch (error) {
    console.error("Dispatch outward error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to save dispatch details" });
  }
}

// ---------------------------------------------------------------------------
// DELETE  (Super admin only, and only after the entry has been dispatched)
// Removes the entry, its items, reference documents and uploaded files.
// Stock is calculated from the entries, so the quantities return to stock.
// ---------------------------------------------------------------------------
export async function deleteOutward(req, res) {
  try {
    const { id } = req.params;
    const existing = await prisma.min.findUnique({
      where: { id },
      select: { id: true, outwardNumber: true, warehouseId: true, status: true, items: { select: { proofFileKey: true } } },
    });
    if (!existing) return res.status(404).json({ message: "Outward entry not found" });
    if (existing.status !== STATUS.DISPATCHED) {
      return res.status(409).json({ message: "Only a dispatched outward entry can be deleted" });
    }

    const documents = await prisma.document.findMany({ where: { linkedType: "outward", linkedId: id }, select: { id: true, fileKey: true } });
    const fileKeys = [...documents.map((d) => d.fileKey), ...existing.items.map((i) => i.proofFileKey)].filter(Boolean);
    if (fileKeys.length) {
      const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove(fileKeys);
      if (error) return res.status(500).json({ message: "Failed to delete files from storage.", error: error.message });
    }

    await prisma.$transaction(async (tx) => {
      await tx.document.deleteMany({ where: { linkedType: "outward", linkedId: id } });
      await tx.min.update({ where: { id }, data: { items: { deleteMany: {} }, referenceDocuments: { deleteMany: {} } } });
      await tx.min.delete({ where: { id } });
    });

    await recordAuditLog(prisma, {
      entityType: "OUTWARD", entityId: id, entityNumber: existing.outwardNumber,
      action: "DELETED", description: `Outward entry ${existing.outwardNumber} deleted by ${req.user.name}`,
      userId: req.user.id, warehouseId: existing.warehouseId,
    });
    return res.json({ message: "Outward entry deleted" });
  } catch (error) {
    console.error("Delete outward error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to delete outward entry" });
  }
}

// ---------------------------------------------------------------------------
// GET /api/outward/:id/items/:itemId/proof   (Sales, Account, Super admin only)
// ---------------------------------------------------------------------------
export async function downloadItemProof(req, res) {
  try {
    const item = await prisma.minItem.findUnique({
      where: { id: req.params.itemId },
      select: { id: true, minId: true, proofFileKey: true, min: { select: { id: true, warehouseId: true, createdById: true, status: true } } },
    });
    if (!item || item.minId !== req.params.id || !item.proofFileKey) return res.status(404).json({ message: "No proof file for this item" });
    await assertEntryVisible(req, item.min);

    const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).createSignedUrl(item.proofFileKey, 60 * 5);
    if (error) return res.status(500).json({ message: "Failed to create download link.", error: error.message });
    return res.json({ data: { url: data.signedUrl } });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Failed to download proof" });
  }
}

// ---------------------------------------------------------------------------
// HISTORY
// ---------------------------------------------------------------------------
export async function listOutwardHistory(req, res) {
  try {
    const { warehouseId, search = "", page = "1", pageSize = "20" } = req.query;
    const scopedWarehouseIds = await getScopedWarehouseIds(req);

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const pageSizeNum = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);

    const isWarehouse = req.user.role === "WAREHOUSE_MANAGER";

    // Sales only sees the trail of their own entries and the super admin's entries for their company; a warehouse manager only
    // the entries that reached the warehouse, minus the cost / approval lines.
    let entityFilter = {};
    if (req.user.role === "SALES" || isWarehouse) {
      const mins = await prisma.min.findMany({
        where: { AND: [roleWhere(req), scopedWarehouseIds ? { warehouseId: { in: scopedWarehouseIds } } : {}] },
        select: { id: true },
      });
      entityFilter = { entityId: { in: mins.map((m) => m.id) } };
    }

    const where = {
      entityType: "OUTWARD",
      AND: [
        scopedWarehouseIds ? { warehouseId: { in: scopedWarehouseIds } } : {},
        warehouseId ? { warehouseId } : {},
        entityFilter,
        isWarehouse ? { action: { notIn: HIDDEN_FROM_WAREHOUSE_ACTIONS } } : {},
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

    // Raw change payloads are not needed to render the feed; drop them for the warehouse.
    const data = isWarehouse ? rows.map(({ changes, ...r }) => r) : rows;

    return res.json({ data, pagination: { page: pageNum, pageSize: pageSizeNum, total, totalPages: Math.ceil(total / pageSizeNum) } });
  } catch (error) {
    console.error("List outward history error:", error);
    return res.status(500).json({ message: "Failed to fetch history", error: error.message });
  }
}
