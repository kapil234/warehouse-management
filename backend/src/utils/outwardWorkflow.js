import prisma from "../config/prisma.js";

/**
 * =========================================================
 * OUTWARD WORKFLOW HELPERS
 * =========================================================
 *
 *   SALES   --create-->  PENDING_APPROVAL
 *   ACCOUNT --approve--> PENDING_DISPATCH
 *   ACCOUNT --reject-->  REJECTED  (allowed until dispatch; Sales edits + resubmits,
 *                                    or Account approves it again directly)
 *   SALES   --edit-->    allowed until dispatch. Changing cost or item details
 *                        sends the entry back to PENDING_APPROVAL; changing only
 *                        header fields (customer, type ...) keeps PENDING_DISPATCH.
 *   WAREHOUSE_MANAGER --dispatch (details + documents)--> DISPATCHED
 *
 * Warehouse only sees PENDING_DISPATCH / DISPATCHED entries.
 * Dispatch documents are visible to Sales / Account only once DISPATCHED.
 * After DISPATCHED Sales / Account are locked out; the WAREHOUSE_MANAGER can still update the dispatch
 * details (reference documents, mode, vehicle no., remarks) and add / delete documents.
 * SUPER_ADMIN changes everything through Update (items, cost, dispatch details).
 * SUPER_ADMIN can change everything.
 * =========================================================
 */

export const STATUS = {
  PENDING_APPROVAL: "PENDING_APPROVAL",
  PENDING_DISPATCH: "PENDING_DISPATCH",
  DISPATCHED: "DISPATCHED",
  REJECTED: "REJECTED",
};

export const COST_STATUSES = ["COMPLETED", "PARTIALLY_COMPLETED", "PENDING"];

// Statuses the warehouse manager is allowed to see at all.
export const WAREHOUSE_VISIBLE_STATUSES = [STATUS.PENDING_DISPATCH, STATUS.DISPATCHED];

// Sales may edit until dispatch; Account may reject until dispatch.
export const SALES_EDITABLE_STATUSES = [STATUS.PENDING_APPROVAL, STATUS.REJECTED, STATUS.PENDING_DISPATCH];
export const REJECTABLE_STATUSES = [STATUS.PENDING_APPROVAL, STATUS.PENDING_DISPATCH];
// Account can approve a pending entry, or change its mind and approve a rejected one.
export const APPROVABLE_STATUSES = [STATUS.PENDING_APPROVAL, STATUS.REJECTED];

// Audit-log actions the warehouse manager must NOT see (cost / approval side).
export const HIDDEN_FROM_WAREHOUSE_ACTIONS = ["SUBMITTED", "RESUBMITTED", "APPROVED", "REJECTED", "COST_UPDATED"];

export const isFinanceSide = (role) => role === "SALES" || role === "ACCOUNT";

/** Company ids the user belongs to (join table + primary company). */
export async function getUserCompanyIds(user) {
  const links = await prisma.userCompany.findMany({
    where: { userId: user.id },
    select: { companyId: true },
  });
  return [...new Set([...links.map((l) => l.companyId), ...(user.companyId ? [user.companyId] : [])])];
}

/**
 * Warehouse ids a SALES / ACCOUNT user can see, through the companies they
 * belong to. Used for the view-only inward list / detail / reports / dashboard.
 */
export async function getFinanceWarehouseIds(user) {
  const companyIds = await getUserCompanyIds(user);
  if (!companyIds.length) return [];
  const rows = await prisma.warehouse.findMany({
    where: { companyId: { in: companyIds } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Removes everything the warehouse manager must not see from an outward
 * entry: cost, cost status, UTR, proof, approval info, workflow status.
 * Items keep only category / model (sku) / quantity / uom.
 */
export function sanitizeForWarehouse(entry) {
  if (!entry) return entry;
  const { approvedById, approvedByName, approvedAt, approvalRemarks, status, ...rest } = entry;
  return {
    ...rest,
    dispatchState: status === STATUS.DISPATCHED ? "Dispatched" : "Pending",
    items: (entry.items || []).map((i) => ({
      id: i.id,
      category: i.category,
      companyName: i.companyName,
      sku: i.sku,
      quantity: i.quantity,
      uom: i.uom,
    })),
  };
}

/** Sales / Account / Super admin view. The storage key stays server-side; a flag is sent instead. */
export function shapeItemForFinance(i) {
  const { proofFileKey, ...rest } = i;
  return {
    ...rest,
    cost: i.cost === null || i.cost === undefined ? null : Number(i.cost),
    hasProof: Boolean(proofFileKey),
  };
}

export function shapeForFinance(entry) {
  if (!entry) return entry;
  return { ...entry, items: (entry.items || []).map(shapeItemForFinance) };
}

/** Returns an error message, or null when the item's cost fields are valid. */
export function validateItemCost(item, label) {
  const cost = item.cost === "" || item.cost === null || item.cost === undefined ? NaN : Number(item.cost);
  if (!Number.isFinite(cost) || cost < 0) return `${label}: cost is required and must be 0 or more`;
  if (!COST_STATUSES.includes(item.costStatus)) {
    return `${label}: cost status must be Completed, Partially Completed or Pending`;
  }
  if (item.costStatus !== "PENDING") {
    const hasUtr = Boolean(String(item.utrNumber || "").trim());
    const hasProof = Boolean(item.proofFileKey) || item.keepProof === true;
    if (!hasUtr && !hasProof) {
      return `${label}: UTR number or a payment proof (image / file) is required when cost status is ${
        item.costStatus === "COMPLETED" ? "Completed" : "Partially Completed"
      }`;
    }
  }
  if (item.proofFileKey && !String(item.proofFileKey).startsWith("uploads/")) {
    return `${label}: invalid proof file`;
  }
  return null;
}

/** Item row as stored in MinItem. `previous` = the row being replaced on edit (to keep its proof). */
export function toItemRow(item, previous) {
  const paid = item.costStatus !== "PENDING";
  const keep = paid && item.keepProof === true && previous?.proofFileKey;
  return {
    category: item.category,
    companyName: item.companyName ? String(item.companyName).trim() || null : null,
    sku: String(item.sku).trim(),
    quantity: Number(item.quantity),
    uom: item.uom,
    cost: Number(item.cost),
    costStatus: item.costStatus,
    utrNumber: paid ? String(item.utrNumber || "").trim() || null : null,
    proofFileKey: paid ? (keep ? previous.proofFileKey : item.proofFileKey || null) : null,
    proofFileName: paid ? (keep ? previous.proofFileName : item.proofFileName || null) : null,
    proofFileType: paid ? (keep ? previous.proofFileType : item.proofFileType || null) : null,
  };
}

/**
 * Fingerprint of everything Account approves: item identity, quantity, UOM and
 * all cost fields. If it changes on an already-approved entry, approval is needed again.
 */
export function itemsFingerprint(items = []) {
  return JSON.stringify(
    items
      .map((i) => [
        String(i.category || "").toLowerCase(),
        String(i.companyName || "").trim().toLowerCase(),
        String(i.sku || "").trim().toLowerCase(),
        Number(i.quantity),
        String(i.uom || "").toLowerCase(),
        Number(i.cost ?? 0),
        i.costStatus || null,
        i.utrNumber || null,
        Boolean(i.proofFileKey),
      ])
      .map((row) => JSON.stringify(row))
      .sort()
  );
}
