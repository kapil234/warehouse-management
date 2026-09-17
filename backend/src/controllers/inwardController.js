import prisma from "../config/prisma.js";
import { recordAuditLog, diffFields, diffItems, describeItem } from "../utils/auditLog.js";

/**
 * =========================================================
 * REQUIRED GRN DOCUMENTS
 * =========================================================
 */

const REQUIRED_DOCUMENTS = [
  "Vendor invoice",
  "E-way bill",
  "Unloading sign-off sheet",
];

const META_PREFIX = "__INWARD_META__";

function buildStoredRemarks(companyName, documentNumbers, remarks) {
  const meta = JSON.stringify({ companyName: companyName || "", documentNumbers: Array.isArray(documentNumbers) ? documentNumbers : [] });
  return `${META_PREFIX}${meta}\n${remarks || ""}`;
}

function parseStoredRemarks(value) {
  const text = String(value || "");
  if (!text.startsWith(META_PREFIX)) return { companyName: "", documentNumbers: [], remarks: text };
  const newline = text.indexOf("\n");
  try {
    const meta = JSON.parse(text.slice(META_PREFIX.length, newline < 0 ? undefined : newline));
    return { companyName: meta.companyName || "", documentNumbers: Array.isArray(meta.documentNumbers) ? meta.documentNumbers : [], remarks: newline < 0 ? "" : text.slice(newline + 1) };
  } catch {
    return { companyName: "", documentNumbers: [], remarks: text };
  }
}

/**
 * =========================================================
 * HELPER
 * =========================================================
 *
 * Calculates document status for a GRN.
 *
 * 0 documents
 * -> Pending
 * -> 3 documents pending
 *
 * 1 document
 * -> Pending
 * -> 2 documents pending
 *
 * 2 documents
 * -> Pending
 * -> 1 document pending
 *
 * 3 documents
 * -> Complete
 * -> 0 documents pending
 */

function calculateDocumentStatus(documents = []) {
  const uploadedCategories = documents.map((doc) => String(doc.docCategory || "").trim().toLowerCase());
  const pendingDocuments = REQUIRED_DOCUMENTS.filter((requiredDocument) => {
    const required = requiredDocument.toLowerCase();
    return !uploadedCategories.some((value) => value === required || value.startsWith(`${required} #`) || value.startsWith(`${required} `));
  }).length;

  const uploadedDocuments =
    REQUIRED_DOCUMENTS.length -
    pendingDocuments;

  const status =
    pendingDocuments === 0
      ? "Complete"
      : "Pending";

  return {
    status,

    pendingDocuments,

    uploadedDocuments,

    requiredDocuments:
      REQUIRED_DOCUMENTS.length,
  };
}

/**
 * =========================================================
 * GET /api/grn
 * =========================================================
 *
 * List GRNs with:
 * - items
 * - documents
 * - createdBy
 * - document status
 * - pagination
 * - search
 * - type filter
 * - date filter
 *
 * =========================================================
 */

export async function listGrn(req, res) {
  try {
    const {
      search = "",
      type,
      dateFrom,
      dateTo,
      warehouseId,
      page = "1",
      pageSize = "20",
    } = req.query;

    // =====================================================
    // SCOPE BY ROLE / WAREHOUSE
    // (previously this endpoint returned every GRN in the system to
    // any authenticated user — a warehouse manager could browse other
    // companies' inward entries. Scope it the same way warehouses
    // themselves are scoped.)
    // =====================================================

    let scopedWarehouseIds = null;

    if (req.user.role === "WAREHOUSE_MANAGER") {
      const grants = await prisma.warehouseAccess.findMany({
        where: { userId: req.user.id, accessLevel: "MANAGE" },
        select: { warehouseId: true },
      });
      scopedWarehouseIds = grants.map((g) => g.warehouseId);
    }
    // SUPER_ADMIN: no scoping — sees everything (optionally filtered
    // by ?warehouseId= below like everyone else).

    // =====================================================
    // PAGINATION
    // =====================================================

    const pageNum = Math.max(
      parseInt(page, 10) || 1,
      1
    );

    const pageSizeNum = Math.min(
      Math.max(
        parseInt(pageSize, 10) || 20,
        1
      ),
      100
    );

    // =====================================================
    // BUILD WHERE
    // =====================================================

    const where = {
      AND: [
        // -------------------------------------------------
        // WAREHOUSE SCOPE
        // -------------------------------------------------

        scopedWarehouseIds ? { warehouseId: { in: scopedWarehouseIds } } : {},

        warehouseId ? { warehouseId } : {},

        // -------------------------------------------------
        // SEARCH
        // -------------------------------------------------

        search
          ? {
              OR: [
                {
                  grnNumber: {
                    contains: search,
                    mode: "insensitive",
                  },
                },

                {
                  supplierName: {
                    contains: search,
                    mode: "insensitive",
                  },
                },

                {
                  companyName: {
                    contains: search,
                    mode: "insensitive",
                  },
                },

                {
                  refDocNumber: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
              ],
            }
          : {},

        // -------------------------------------------------
        // INWARD TYPE FILTER
        // -------------------------------------------------

        type
          ? {
              inwardType: type,
            }
          : {},

        // -------------------------------------------------
        // DATE FILTER
        // -------------------------------------------------

        dateFrom || dateTo
          ? {
              createdAt: {
                ...(dateFrom
                  ? {
                      gte: new Date(
                        dateFrom
                      ),
                    }
                  : {}),

                ...(dateTo
                  ? {
                      lte: new Date(
                        dateTo
                      ),
                    }
                  : {}),
              },
            }
          : {},
      ],
    };

    // =====================================================
    // GET GRNS + TOTAL
    // =====================================================

    const [rows, total] =
      await Promise.all([
        prisma.grn.findMany({
          where,

          include: {
            items: true,
            referenceDocuments: true,

            createdBy: {
              select: {
                name: true,
              },
            },

            warehouse: {
              select: {
                id: true,
                name: true,
                code: true,
                company: { select: { name: true } },
              },
            },
          },

          orderBy: {
            createdAt: "desc",
          },

          skip:
            (pageNum - 1) *
            pageSizeNum,

          take: pageSizeNum,
        }),

        prisma.grn.count({
          where,
        }),
      ]);

    // =====================================================
    // GET GRN IDS
    // =====================================================

    const grnIds = rows.map(
      (grn) => grn.id
    );

    // =====================================================
    // GET DOCUMENTS
    // =====================================================

    let documents = [];

    if (grnIds.length > 0) {
      documents =
        await prisma.document.findMany({
          where: {
            linkedType: "grn",

            linkedId: {
              in: grnIds,
            },
          },

          orderBy: {
            uploadedAt: "desc",
          },
        });
    }

    // =====================================================
    // ATTACH DOCUMENTS + STATUS
    // =====================================================

    const rowsWithDocuments =
      rows.map((grn) => {
        // -------------------------------------------------
        // Documents belonging to this GRN
        // -------------------------------------------------

        const grnDocuments =
          documents.filter(
            (doc) =>
              doc.linkedId === grn.id
          );

        // -------------------------------------------------
        // Calculate document status
        // -------------------------------------------------

        const statusData =
          calculateDocumentStatus(
            grnDocuments
          );

        // -------------------------------------------------
        // Return GRN
        // -------------------------------------------------

        return {
          ...grn,
          companyName: grn.companyName || grn.warehouse?.company?.name || "",
          documents:
            grnDocuments,

          status:
            statusData.status,

          pendingDocuments:
            statusData.pendingDocuments,

          uploadedDocuments:
            statusData.uploadedDocuments,

          requiredDocuments:
            statusData.requiredDocuments,
        };
      });

    // =====================================================
    // RESPONSE
    // =====================================================

    return res.json({
      data: rowsWithDocuments,

      pagination: {
        page: pageNum,

        pageSize:
          pageSizeNum,

        total,

        totalPages:
          Math.ceil(
            total /
              pageSizeNum
          ),
      },
    });
  } catch (error) {
    console.error(
      "List GRN error:"
    );

    console.error(error);

    return res.status(500).json({
      message:
        "Failed to fetch GRNs",

      error:
        error.message,
    });
  }
}

/**
 * =========================================================
 * GET /api/grn/:id
 * =========================================================
 *
 * Get one GRN with:
 * - items
 * - documents
 * - createdBy
 * - document status
 *
 * =========================================================
 */

export async function getGrnById(req, res) {
  try {
    const { id } = req.params;

    // =====================================================
    // GET GRN
    // =====================================================

    const grn =
      await prisma.grn.findUnique({
        where: {
          id,
        },

        include: {
          items: true,
          referenceDocuments: true,

          createdBy: {
            select: {
              name: true,
              role: true,
            },
          },

          warehouse: {
            select: {
              id: true,
              name: true,
              code: true,
              companyId: true,
              Inward: true,
              Outward: true,
              company: { select: { name: true, status: true } },
            },
          },
        },
      });

    // =====================================================
    // CHECK GRN
    // =====================================================

    if (!grn) {
      return res.status(404).json({
        message:
          "GRN not found",
      });
    }

    // =====================================================
    // SCOPE CHECK — same warehouse scoping as listGrn
    // =====================================================


    if (req.user.role === "WAREHOUSE_MANAGER") {
      const access = await prisma.warehouseAccess.findUnique({
        where: {
          userId_warehouseId: { userId: req.user.id, warehouseId: grn.warehouseId },
        },
      });
      if (!access || access.accessLevel !== "MANAGE") {
        return res.status(403).json({ message: "You don't have access to this GRN's warehouse" });
      }
    }

    // =====================================================
    // GET DOCUMENTS
    // =====================================================

    const documents =
      await prisma.document.findMany({
        where: {
          linkedType: "grn",

          linkedId: grn.id,
        },

        orderBy: {
          uploadedAt: "desc",
        },
      });

    // =====================================================
    // CALCULATE STATUS
    // =====================================================

    const statusData =
      calculateDocumentStatus(
        documents
      );

    // =====================================================
    // RESPONSE
    // =====================================================

    return res.json({
      data: {
        ...grn,
        companyName: grn.companyName || grn.warehouse?.company?.name || "",
        documents,

        status:
          statusData.status,

        pendingDocuments:
          statusData.pendingDocuments,

        uploadedDocuments:
          statusData.uploadedDocuments,

        requiredDocuments:
          statusData.requiredDocuments,
      },
    });
  } catch (error) {
    console.error(
      "Get GRN error:"
    );

    console.error(error);

    return res.status(500).json({
      message:
        "Failed to fetch GRN",

      error:
        error.message,
    });
  }
}

/**
 * =========================================================
 * POST /api/grn
 * =========================================================
 *
 * Create GRN.
 *
 * Documents are OPTIONAL.
 *
 * If no documents are provided:
 *
 * documents = []
 *
 * GRN is still created.
 *
 * =========================================================
 */


export async function updateGrn(req, res) {
  try {
    const { id } = req.params;
    const data = req.body;
    const items = Array.isArray(data.items) ? data.items : [];
    const references = Array.isArray(data.referenceDocuments) ? data.referenceDocuments : [];

    const existing = await prisma.grn.findUnique({
      where: { id },
      select: {
        id: true, warehouseId: true, grnNumber: true,
        inwardType: true, supplierName: true, companyName: true,
        refDocType: true, refDocNumber: true, ewayBillNumber: true, remarks: true,
        items: { select: { category: true, sku: true, companyName: true, quantity: true, uom: true } },
      },
    });
    if (!existing) return res.status(404).json({ message: "GRN not found" });

    const warehouse = await prisma.warehouse.findUnique({
      where: { id: existing.warehouseId },
      select: { id: true, companyId: true, Inward: true, company: { select: { status: true } } },
    });
    if (!warehouse) return res.status(404).json({ message: "Warehouse not found" });
    if (warehouse.company?.status === "Inactive" || warehouse.Inward !== "Active") {
      return res.status(403).json({ message: "Inward is disabled for this warehouse/company." });
    }
    if (req.user.role === "WAREHOUSE_MANAGER") {
      const access = await prisma.warehouseAccess.findUnique({
        where: { userId_warehouseId: { userId: req.user.id, warehouseId: existing.warehouseId } },
      });
      if (!access || access.accessLevel !== "MANAGE" || !access.canInward) {
        return res.status(403).json({ message: "You don't have permission to update this inward entry." });
      }
    }

    if (!data.inwardType || !data.supplierName?.trim() || !data.companyName?.trim()) {
      return res.status(422).json({ message: "Inward type, supplier/customer and company name are required." });
    }
    if (!data.companyId || data.companyId !== warehouse.companyId) {
      return res.status(400).json({ message: "Selected company does not match this warehouse." });
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

    const normalizedRefs = references
      .filter((r) => r && (r.refDocNumber || r.ewayBillNumber))
      .map((r) => ({
        refDocType: String(r.refDocType || "Other").trim(),
        refDocNumber: String(r.refDocNumber || r.ewayBillNumber || "N/A").trim(),
        ewayBillNumber: r.ewayBillNumber ? String(r.ewayBillNumber).trim() : null,
      }));

    // Snapshot the "new" values in the same shape as `existing` so we can
    // diff them below, both for top-level fields and for the item list.
    const newSnapshot = {
      inwardType: data.inwardType,
      supplierName: data.supplierName.trim(),
      companyName: data.companyName.trim(),
      refDocType: normalizedRefs[0].refDocType,
      refDocNumber: normalizedRefs[0].refDocNumber,
      ewayBillNumber: normalizedRefs[0].ewayBillNumber,
      remarks: data.remarks?.trim() || null,
    };
    const newItems = items.map((item) => ({
      category: item.category, sku: item.sku.trim(),
      quantity: Number(item.quantity), uom: item.uom,
      companyName: item.companyName ? String(item.companyName).trim() || null : null,
    }));
    const fieldChanges = diffFields(existing, newSnapshot, [
      "inwardType", "supplierName", "companyName", "refDocType", "refDocNumber", "ewayBillNumber", "remarks",
    ]);
    const itemChanges = diffItems(existing.items, newItems);

    const result = await prisma.$transaction(async (tx) => {
      await tx.grn.update({
        where: { id },
        data: {
          inwardType: data.inwardType,
          supplierName: data.supplierName.trim(),
          companyName: data.companyName.trim(),
          refDocType: normalizedRefs[0].refDocType,
          refDocNumber: normalizedRefs[0].refDocNumber,
          refDocDate: data.refDocDate ? new Date(data.refDocDate) : new Date(),
          ewayBillNumber: normalizedRefs[0].ewayBillNumber,
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
        entityType: "INWARD",
        entityId: id,
        entityNumber: existing.grnNumber,
        userId: req.user.id,
        warehouseId: existing.warehouseId,
      };
      for (const change of fieldChanges) {
        await recordAuditLog(tx, {
          ...auditBase,
          action: "UPDATED",
          description: `${change.label} updated from "${change.oldValue || "—"}" to "${change.newValue || "—"}"`,
          changes: change,
        });
      }
      for (const item of itemChanges.added) {
        await recordAuditLog(tx, {
          ...auditBase,
          action: "ITEM_ADDED",
          description: `Item added: ${describeItem(item)} — qty ${item.quantity} ${item.uom}`,
          changes: item,
        });
      }
      for (const item of itemChanges.removed) {
        await recordAuditLog(tx, {
          ...auditBase,
          action: "ITEM_REMOVED",
          description: `Item removed: ${describeItem(item)} — qty ${item.quantity} ${item.uom}`,
          changes: item,
        });
      }
      for (const { item, oldQuantity, newQuantity } of itemChanges.updated) {
        await recordAuditLog(tx, {
          ...auditBase,
          action: "ITEM_UPDATED",
          description: `Quantity updated for ${describeItem(item)} from ${oldQuantity} to ${newQuantity} ${item.uom}`,
          changes: { field: "quantity", item: describeItem(item), oldValue: oldQuantity, newValue: newQuantity },
        });
      }
      if (!fieldChanges.length && !itemChanges.added.length && !itemChanges.removed.length && !itemChanges.updated.length) {
        await recordAuditLog(tx, {
          ...auditBase,
          action: "UPDATED",
          description: "Inward entry saved with no field changes",
        });
      }

      return tx.grn.findUnique({ where: { id }, include: { items: true, referenceDocuments: true } });
    });
    return res.json({ message: "Inward entry updated successfully", data: result });
  } catch (error) {
    console.error("Update GRN error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to update GRN" });
  }
}

export async function createGrn(req, res) {
  try {
    // =====================================================
    // REQUEST DATA
    // =====================================================

    const data = req.body;

    console.log(
      "Creating GRN with payload:"
    );

    console.log(
      JSON.stringify(
        data,
        null,
        2
      )
    );

    // =====================================================
    // BASIC DEFAULTS
    // =====================================================

    const items =
      Array.isArray(
        data.items
      )
        ? data.items
        : [];

    const documents =
      Array.isArray(
        data.documents
      )
        ? data.documents
        : [];

    // =====================================================
    // BASIC REQUIRED FIELD VALIDATION
    // =====================================================

    if (!data.warehouseId) {
      return res.status(422).json({
        message:
          "warehouseId is required",
      });
    }

    if (!data.inwardType) {
      return res.status(422).json({
        message:
          "inwardType is required",
      });
    }

    if (!data.supplierName) {
      return res.status(422).json({
        message:
          "supplierName is required",
      });
    }

    if (!data.companyName) {
      return res.status(422).json({ message: "companyName is required" });
    }

    if (!data.companyId) {
      return res.status(422).json({ message: "companyId is required" });
    }

    const transactionWarehouse = await prisma.warehouse.findUnique({
      where: { id: data.warehouseId },
      select: {
        id: true, code: true, companyId: true, Inward: true,
        company: { select: { id: true, name: true, status: true } },
      },
    });
    if (!transactionWarehouse) return res.status(404).json({ message: "Warehouse not found" });
    if (transactionWarehouse.companyId !== data.companyId) {
      return res.status(400).json({ message: "Selected warehouse does not belong to the selected company" });
    }
    if (transactionWarehouse.company?.status === "Inactive" || transactionWarehouse.Inward !== "Active") {
      return res.status(403).json({ message: "Inward is disabled for this warehouse/company." });
    }
    if (req.user.role === "WAREHOUSE_MANAGER") {
      const access = await prisma.warehouseAccess.findUnique({
        where: { userId_warehouseId: { userId: req.user.id, warehouseId: data.warehouseId } },
      });
      if (!access || access.accessLevel !== "MANAGE" || !access.canInward) {
        return res.status(403).json({ message: "You don't have permission to create inward in this warehouse." });
      }
    }

    if (!data.refDocNumber && !Array.isArray(data.otherDocumentNumbers)) {
      return res.status(422).json({ message: "At least one document number is required" });
    }

    if (items.length === 0) {
      return res.status(422).json({
        message:
          "At least one item is required",
      });
    }

    // =====================================================
    // VALIDATE ITEMS
    // =====================================================

    for (const item of items) {
      if (!item.category) {
        return res.status(422).json({
          message:
            "Item category is required",
        });
      }

      if (!item.sku) {
        return res.status(422).json({
          message:
            "Item SKU is required",
        });
      }

      const quantity =
        Number(
          item.quantity
        ) || 0;

      if (quantity <= 0) {
        return res.status(422).json({
          message:
            `Item "${item.sku}" must have a valid quantity`,
        });
      }

      if (!item.uom) {
        return res.status(422).json({
          message:
            `Item "${item.sku}" UOM is required`,
        });
      }
    }

    // =====================================================
    // GENERATE GRN NUMBER
    // =====================================================

    const warehouse = await prisma.warehouse.findUnique({
      where: { id: data.warehouseId },
      select: { id: true, code: true },
    });
    if (!warehouse) return res.status(404).json({ message: "Warehouse not found" });

    const grnCount = await prisma.grn.count({ where: { warehouseId: warehouse.id } });
    let grnNumber = `GRN-${warehouse.code}-${String(grnCount + 1).padStart(4, "0")}`;
    let existingGrn = await prisma.grn.findUnique({ where: { grnNumber }, select: { id: true } });
    let grnSequence = grnCount + 1;
    while (existingGrn) {
      grnSequence += 1;
      grnNumber = `GRN-${warehouse.code}-${String(grnSequence).padStart(4, "0")}`;
      existingGrn = await prisma.grn.findUnique({ where: { grnNumber }, select: { id: true } });
    }

    console.log(
      "Generated GRN number:",
      grnNumber
    );

    // =====================================================
    // CREATE TRANSACTION
    // =====================================================

    const result =
      await prisma.$transaction(
        async (tx) => {
          // =============================================
          // CREATE GRN
          // =============================================

          const grn =
            await tx.grn.create({
              data: {
                grnNumber,

                warehouseId:
                  data.warehouseId,

                inwardType:
                  data.inwardType,

                supplierName:
                  data.supplierName,

                companyName:
                  data.companyName || null,

                refDocType:
                  data.refDocType,

                refDocNumber:
                  data.refDocNumber,

                refDocDate:
                  data.refDocDate
                    ? new Date(
                        data.refDocDate
                      )
                    : new Date(),

                ewayBillNumber:
                  data.ewayBillNumber ||
                  null,

                remarks:
                  data.remarks || null,

                createdById:
                  req.user.id,

                // =======================================
                // CREATE ITEMS
                // =======================================

                items: {
                  create:
                    items.map(
                      (item) => ({
                        category:
                          item.category,

                        sku:
                          item.sku,

                        quantity:
                          Number(
                            item.quantity
                          ) || 0,

                        uom:
                          item.uom,

                        companyName:
                          item.companyName
                            ? String(item.companyName).trim() || null
                            : null,
                      })
                    ),
                },

                referenceDocuments: {
                  create: (Array.isArray(data.referenceDocuments) ? data.referenceDocuments : [{ refDocType: data.refDocType, refDocNumber: data.refDocNumber, ewayBillNumber: data.ewayBillNumber }])
                    .filter((r) => r && (r.refDocNumber || r.ewayBillNumber))
                    .map((r) => ({
                      refDocType: String(r.refDocType || "Other").trim(),
                      refDocNumber: String(r.refDocNumber || r.ewayBillNumber || "N/A").trim(),
                      ewayBillNumber: r.ewayBillNumber ? String(r.ewayBillNumber).trim() : null,
                    })),
                },
              },

              include: {
                items: true,
                referenceDocuments: true,
              },
            });

          // =============================================
          // CREATE DOCUMENTS
          // =============================================

          for (
            const doc of documents
          ) {
            // -----------------------------------------
            // Ignore empty document
            // -----------------------------------------

            if (!doc) {
              continue;
            }

            // -----------------------------------------
            // Ignore document without fileKey
            // -----------------------------------------

            if (
              !doc.fileKey
            ) {
              console.log(
                "Skipping document without fileKey:",
                doc
              );

              continue;
            }

            // -----------------------------------------
            // Create Document
            // -----------------------------------------

            await tx.document.create({
              data: {
                linkedType:
                  "grn",

                linkedId:
                  grn.id,

                docCategory:
                  doc.docCategory ||
                  "Other",

                fileKey:
                  doc.fileKey,

                fileType:
                  doc.fileType ||
                  "unknown",

                fileSize:
                  Number(
                    doc.fileSize
                  ) || 0,

                uploadedById:
                  req.user.id,
              },
            });
          }

          // =============================================
          // AUDIT TRAIL
          // =============================================

          await recordAuditLog(tx, {
            entityType: "INWARD",
            entityId: grn.id,
            entityNumber: grn.grnNumber,
            action: "CREATED",
            description: `Inward entry ${grn.grnNumber} created with ${grn.items.length} item${grn.items.length === 1 ? "" : "s"}`,
            userId: req.user.id,
            warehouseId: grn.warehouseId,
          });



          // =============================================
          // GET CREATED DOCUMENTS
          // =============================================

          const createdDocuments =
            await tx.document.findMany(
              {
                where: {
                  linkedType:
                    "grn",

                  linkedId:
                    grn.id,
                },

                orderBy: {
                  uploadedAt:
                    "desc",
                },
              }
            );

          // =============================================
          // RETURN CREATED GRN
          // =============================================

          return {
            ...grn,

            documents:
              createdDocuments,
          };
        }
      );

    // =====================================================
    // CALCULATE DOCUMENT STATUS
    // =====================================================

    const statusData =
      calculateDocumentStatus(
        result.documents
      );

    // =====================================================
    // SUCCESS RESPONSE
    // =====================================================

    return res.status(201).json({
      message:
        "GRN created successfully",

      data: {
        ...result,

        status:
          statusData.status,

        pendingDocuments:
          statusData.pendingDocuments,

        uploadedDocuments:
          statusData.uploadedDocuments,

        requiredDocuments:
          statusData.requiredDocuments,
      },
    });
  } catch (error) {
    // =====================================================
    // ERROR
    // =====================================================

    console.error(
      "Create GRN error:"
    );

    console.error(error);

    return res.status(500).json({
      message:
        "Failed to create GRN",

      error:
        error.message,
    });
  }
}

export async function listInwardModels(req, res) {
  try {
    const { warehouseId } = req.query;
    if (!warehouseId) return res.status(422).json({ message: "warehouseId is required" });

    if (req.user.role === "WAREHOUSE_MANAGER") {
      const access = await prisma.warehouseAccess.findUnique({ where: { userId_warehouseId: { userId: req.user.id, warehouseId } } });
      if (!access || access.accessLevel !== "MANAGE") return res.status(403).json({ message: "You don't have access to this warehouse" });
    }

    const [catalog, history] = await Promise.all([
      prisma.warehouseModel.findMany({ where: { warehouseId }, orderBy: [{ category: "asc" }, { companyName: "asc" }, { name: "asc" }] }),
      prisma.grnItem.groupBy({
        by: ["category", "sku", "companyName"],
        where: { grn: { warehouseId } },
      }),
    ]);
    // Key on category + companyName + model name so the same model name
    // under a different brand/company doesn't collapse into one row.
    const map = new Map(catalog.map((m) => [`${m.category}::${m.companyName || ""}::${m.name}`, m]));
    for (const row of history) {
      if (!row.sku) continue;
      const key = `${row.category}::${row.companyName || ""}::${row.sku}`;
      if (!map.has(key)) map.set(key, { category: row.category, name: row.sku, companyName: row.companyName || null });
    }
    return res.json({ data: Array.from(map.values()) });
  } catch (error) {
    console.error("List inward models error:", error);
    return res.status(500).json({ message: "Failed to fetch models", error: error.message });
  }
}

export async function createInwardModel(req, res) {
  try {
    const { warehouseId, category, name, companyName } = req.body;
    if (!warehouseId || !category || !name?.trim()) return res.status(422).json({ message: "warehouseId, category and model name are required" });
    if (req.user.role === "WAREHOUSE_MANAGER") {
      const access = await prisma.warehouseAccess.findUnique({ where: { userId_warehouseId: { userId: req.user.id, warehouseId } } });
      if (!access || access.accessLevel !== "MANAGE" || !access.canInward) return res.status(403).json({ message: "You don't have permission for this warehouse" });
    }
    const model = await prisma.warehouseModel.create({
      data: { warehouseId, category, name: name.trim(), companyName: companyName?.trim() || null },
    });
    return res.status(201).json({ data: model });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "This model already exists in this warehouse." });
    return res.status(500).json({ message: "Failed to create model", error: error.message });
  }
}

/**
 * =========================================================
 * ITEM COMPANIES (brand/manufacturer tagged per item)
 * =========================================================
 *
 * Separate from the tenant "Company" (the account that owns
 * warehouses, managed by SUPER_ADMIN only). This is a small,
 * per-warehouse catalog of company/brand names used to tag
 * individual GRN items, the same way WarehouseModel catalogs
 * models per category.
 * =========================================================
 */

export async function listInwardCompanies(req, res) {
  try {
    const { warehouseId } = req.query;
    if (!warehouseId) return res.status(422).json({ message: "warehouseId is required" });

    if (req.user.role === "WAREHOUSE_MANAGER") {
      const access = await prisma.warehouseAccess.findUnique({ where: { userId_warehouseId: { userId: req.user.id, warehouseId } } });
      if (!access || access.accessLevel !== "MANAGE") return res.status(403).json({ message: "You don't have access to this warehouse" });
    }

    const [catalog, history] = await Promise.all([
      prisma.warehouseCompany.findMany({ where: { warehouseId }, orderBy: { name: "asc" } }),
      prisma.grnItem.findMany({ where: { grn: { warehouseId }, companyName: { not: null } }, select: { companyName: true }, distinct: ["companyName"] }),
    ]);
    const map = new Map(catalog.map((c) => [c.name, c]));
    for (const row of history) {
      if (row.companyName && !map.has(row.companyName)) map.set(row.companyName, { name: row.companyName });
    }
    return res.json({ data: Array.from(map.values()) });
  } catch (error) {
    console.error("List inward companies error:", error);
    return res.status(500).json({ message: "Failed to fetch companies", error: error.message });
  }
}

export async function createInwardCompany(req, res) {
  try {
    const { warehouseId, name } = req.body;
    if (!warehouseId || !name?.trim()) return res.status(422).json({ message: "warehouseId and company name are required" });
    if (req.user.role === "WAREHOUSE_MANAGER") {
      const access = await prisma.warehouseAccess.findUnique({ where: { userId_warehouseId: { userId: req.user.id, warehouseId } } });
      if (!access || access.accessLevel !== "MANAGE" || !access.canInward) return res.status(403).json({ message: "You don't have permission for this warehouse" });
    }
    const company = await prisma.warehouseCompany.create({ data: { warehouseId, name: name.trim() } });
    return res.status(201).json({ data: company });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "This company already exists in this warehouse." });
    return res.status(500).json({ message: "Failed to create company", error: error.message });
  }
}

/**
 * =========================================================
 * GET /api/grn/:id/history
 * =========================================================
 *
 * Chronological audit trail for one GRN: created, updated,
 * items added/updated/removed, documents added/removed.
 * Newest first.
 * =========================================================
 */

/**
 * =========================================================
 * GET /api/grn/history
 * =========================================================
 *
 * Activity feed across ALL GRNs the caller can see (same
 * warehouse scoping as listGrn) - "GRN-XXXX created", "GRN-XXXX
 * updated: Supplier name changed from A to B", etc. Newest first.
 * This is what the Inward list page's "Activity history" panel
 * reads from - it's not scoped to one GRN.
 * =========================================================
 */

export async function listGrnHistory(req, res) {
  try {
    const {
      warehouseId,
      search = "",
      page = "1",
      pageSize = "20",
    } = req.query;

    let scopedWarehouseIds = null;
    if (req.user.role === "WAREHOUSE_MANAGER") {
      const grants = await prisma.warehouseAccess.findMany({
        where: { userId: req.user.id, accessLevel: "MANAGE" },
        select: { warehouseId: true },
      });
      scopedWarehouseIds = grants.map((g) => g.warehouseId);
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const pageSizeNum = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);

    const where = {
      entityType: "INWARD",
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
    console.error("List GRN history error:", error);
    return res.status(500).json({ message: "Failed to fetch history", error: error.message });
  }
}
