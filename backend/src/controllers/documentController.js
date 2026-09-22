import prisma from "../config/prisma.js";
import { supabase, SUPABASE_BUCKET } from "../config/supabase.js";
import { recordAuditLog } from "../utils/auditLog.js";
 
// assertLinkedEntryAccess used to be 3 sequential round-trips (entry, then
// its warehouse, then the caller's warehouse access) plus a 4th one later
// just to look up the entry's display number for the audit log - all on
// the hot path of every single document upload/download/delete. The entry
// + warehouse + entry number are fetched together here in one query, and
// the access-grant check (still a separate query - Prisma can't filter an
// arbitrary user's access as part of the same call) is skipped entirely
// for SUPER_ADMIN, who bypasses it anyway.
async function assertLinkedEntryAccess(req, linkedType, linkedId, permission = null) {
  const model = linkedType === "grn" ? prisma.grn : prisma.min;
  const numberField = linkedType === "grn" ? "grnNumber" : "outwardNumber";

  const entry = await model.findUnique({
    where: { id: linkedId },
    select: {
      id: true,
      warehouseId: true,
      [numberField]: true,
      warehouse: { select: { id: true, companyId: true, company: { select: { status: true } } } },
    },
  });
  if (!entry) throw Object.assign(new Error(`${linkedType === "grn" ? "GRN" : "Outward entry"} not found.`), { status: 404 });

  const warehouse = entry.warehouse;
  if (!warehouse) throw Object.assign(new Error("Warehouse not found."), { status: 404 });
  if (warehouse.company?.status === "Inactive") throw Object.assign(new Error("This warehouse belongs to an inactive company."), { status: 403 });

  entry.entryNumber = entry[numberField] || entry.id;

  if (req.user.role === "SUPER_ADMIN") return entry;

  const access = await prisma.warehouseAccess.findUnique({
    where: { userId_warehouseId: { userId: req.user.id, warehouseId: entry.warehouseId } },
  });
  if (!access || access.accessLevel !== "MANAGE") throw Object.assign(new Error("You don't have access to this warehouse."), { status: 403 });
  if (permission && !access[permission]) throw Object.assign(new Error("You don't have permission to manage this document."), { status: 403 });
  return entry;
}
 
function sanitizeCategory(value) {
  return String(value || "Other").replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 80) || "Other";
}
function baseName(category) {
  const c = category.toLowerCase();
  if (c.includes("invoice")) return "invoice";
  if (c.includes("e-way") || c.includes("eway")) return "eway-bill";
  if (c.includes("challan")) return "delivery-challan";
  if (c.includes("dispatch photo") || c.includes("photo")) return "dispatch-photo";
  if (c.includes("sign-off") || c.includes("signoff")) return "unloading-signoff";
  return "document";
}
 
// Document.linkedType uses "grn" / "outward"; AuditLog.entityType uses
// "INWARD" / "OUTWARD" — keep the mapping in one place.
const AUDIT_ENTITY_TYPE = { grn: "INWARD", outward: "OUTWARD" };
 
async function uploadLinkedDocument(req, res, linkedType) {
  try {
    if (!req.user?.id) return res.status(401).json({ message: "Unauthorized. Please login again." });
    if (!req.file) return res.status(422).json({ message: "Please select a file." });
 
    const id = req.params.id;
    const permission = linkedType === "grn" ? "canInward" : "canOutward";
    const entry = await assertLinkedEntryAccess(req, linkedType, id, permission);
 
    const category = sanitizeCategory(req.body.docCategory);
    const file = req.file;
    const originalName = file.originalname;
    const fileType = file.mimetype;
    const fileSize = file.size;
    const cleanFileName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
    const extension = cleanFileName.includes(".") ? cleanFileName.split(".").pop().toLowerCase() : "file";
 
    const prefix = linkedType === "grn" ? "GRN" : "MIN";
    const entryNumber = entry.entryNumber;
    // Use a collision-proof suffix instead of a DB count: counting existing
    // docs and using count+1 is a read-then-write race when multiple files
    // are uploaded concurrently (as the frontend does via Promise.all), and
    // it also breaks when the category itself is already unique per file
    // (e.g. "invoice1"/"invoice2"), since baseName() collapses those back
    // down to the same "invoice" prefix — both then computed count=0 and
    // collided on the same storage key, so only the first upload survived.
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const fileKey = `${prefix}/${entryNumber}/${baseName(category)}-${uniqueSuffix}.${extension}`;
 
    const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).upload(fileKey, file.buffer, {
      contentType: fileType, cacheControl: "3600", upsert: false,
    });
    if (error) return res.status(500).json({ message: "Failed to upload file.", error: error.message });
 
    const document = await prisma.document.create({
      data: { linkedType, linkedId: id, docCategory: category, fileKey: data.path, fileType, fileSize, uploadedById: req.user.id },
    });
 
    // The audit log write doesn't need to hold up the response - the upload
    // already succeeded and the document row is already saved, so let the
    // caller move on and finish logging in the background. Failures here
    // are logged but never surfaced to the user, same as before.
    recordAuditLog(prisma, {
      entityType: AUDIT_ENTITY_TYPE[linkedType],
      entityId: id,
      entityNumber: entryNumber,
      action: "DOCUMENT_ADDED",
      description: `Document added: ${category} (${originalName})`,
      changes: { docCategory: category, fileName: originalName },
      userId: req.user.id,
      warehouseId: entry.warehouseId,
    }).catch((err) => console.error("Audit log (DOCUMENT_ADDED) failed:", err));
 
    return res.status(201).json({ message: "Document uploaded successfully", data: { ...document, fileName: originalName } });
  } catch (error) {
    console.error(`UPLOAD ${linkedType.toUpperCase()} DOCUMENT ERROR:`, error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to upload document." });
  }
}
 
export function uploadGrnDocument(req, res) { return uploadLinkedDocument(req, res, "grn"); }
export function uploadOutwardDocument(req, res) { return uploadLinkedDocument(req, res, "outward"); }
 
export async function downloadDocument(req, res) {
  try {
    const document = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!document) return res.status(404).json({ message: "Document not found." });
    await assertLinkedEntryAccess(req, document.linkedType, document.linkedId, null);
    const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).createSignedUrl(document.fileKey, 60 * 5);
    if (error) return res.status(500).json({ message: "Failed to create download link.", error: error.message });
    return res.json({ message: "Download link created", data: { url: data.signedUrl } });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Failed to download document." });
  }
}
 
export async function deleteDocument(req, res) {
  try {
    const document = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!document) return res.status(404).json({ message: "Document not found." });
    const entry = await assertLinkedEntryAccess(req, document.linkedType, document.linkedId, "canManageDocuments");
    const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove([document.fileKey]);
    if (error) return res.status(500).json({ message: "Failed to delete file from storage.", error: error.message });
    await prisma.document.delete({ where: { id: document.id } });
 
    // Same as upload: the delete already succeeded, so don't make the
    // caller wait on the audit log write too.
    recordAuditLog(prisma, {
      entityType: AUDIT_ENTITY_TYPE[document.linkedType],
      entityId: document.linkedId,
      entityNumber: entry.entryNumber,
      action: "DOCUMENT_REMOVED",
      description: `Document removed: ${document.docCategory}`,
      changes: { docCategory: document.docCategory },
      userId: req.user.id,
      warehouseId: entry.warehouseId,
    }).catch((err) => console.error("Audit log (DOCUMENT_REMOVED) failed:", err));
 
    return res.json({ message: "Document deleted successfully." });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Failed to delete document." });
  }
}
