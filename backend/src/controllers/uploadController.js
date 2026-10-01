import prisma from "../config/prisma.js";
import { getUserCompanyIds, outwardFolder, tempProofFolder } from "../utils/outwardWorkflow.js";
import {
  supabase,
  SUPABASE_BUCKET,
} from "../config/supabase.js";

export async function uploadFile(
  req,
  res
) {
  try {
    // ==========================================
    // CHECK AUTH
    // ==========================================

    if (!req.user?.id) {
      return res.status(401).json({
        message:
          "Unauthorized. Please login again.",
      });
    }

    // ==========================================
    // CHECK FILE
    // ==========================================

    if (!req.file) {
      return res.status(422).json({
        message:
          "Please select a file.",
      });
    }

    const file =
      req.file;

    // ==========================================
    // FILE DETAILS
    // ==========================================

    const originalName =
      file.originalname;

    const fileType =
      file.mimetype;

    const fileSize =
      file.size;

    // ==========================================
    // SAFE FILE NAME
    // ==========================================

    const cleanFileName =
      originalName
        .replace(
          /[^a-zA-Z0-9._-]/g,
          "_"
        )
        .replace(
          /_+/g,
          "_"
        );

    // ==========================================
    // FILE EXTENSION
    // ==========================================

    const extension =
      cleanFileName.includes(".")
        ? cleanFileName
            .split(".")
            .pop()
        : "file";

    // ==========================================
    // WHERE IT GOES: min/<outward number>/payment-<...>.<ext>  (new entry: uploads/<id>/ first)
    // Only this path is saved - there is no temporary copy.
    // ==========================================
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const { warehouseId, outwardId } = req.body || {};

    if (!UUID_RE.test(String(warehouseId || "")) || !UUID_RE.test(String(outwardId || ""))) {
      return res.status(422).json({
        message: "Select a warehouse before attaching a payment proof.",
      });
    }

    const [warehouse, existingEntry, companyIds] = await Promise.all([
      prisma.warehouse.findUnique({
        where: { id: warehouseId },
        select: { id: true, code: true, companyId: true },
      }),
      prisma.min.findUnique({ where: { id: outwardId }, select: { warehouseId: true, outwardNumber: true } }),
      req.user.role !== "SUPER_ADMIN" ? getUserCompanyIds(req.user) : Promise.resolve(null),
    ]);
    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    if (companyIds && (!warehouse.companyId || !companyIds.includes(warehouse.companyId))) {
      return res.status(403).json({ message: "You don't have access to this warehouse" });
    }

    // An existing entry must belong to the same warehouse as the folder it is uploaded to.
    if (existingEntry && existingEntry.warehouseId !== warehouse.id) {
      return res.status(400).json({ message: "This outward entry belongs to a different warehouse" });
    }

    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const fileName = `payment-${uniqueSuffix}.${extension}`;
    // Existing entry (edit): straight into its own folder. New entry: waits in uploads/<id>/ and is
    // moved to min/<outward number>/ when the entry is created.
    const folder = existingEntry ? outwardFolder(existingEntry.outwardNumber) : tempProofFolder(outwardId);
    const fileKey = `${folder}${fileName}`;

    // ==========================================
    // UPLOAD TO SUPABASE
    // ==========================================

    const {
      data,
      error,
    } =
      await supabase.storage
        .from(
          SUPABASE_BUCKET
        )
        .upload(
          fileKey,
          file.buffer,
          {
            contentType:
              fileType,

            cacheControl:
              "3600",

            upsert: false,
          }
        );

    // ==========================================
    // SUPABASE ERROR
    // ==========================================

    if (error) {
      console.error(
        "Supabase upload error:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to upload file.",

        error:
          error.message,
      });
    }

    // ==========================================
    // SUCCESS
    // ==========================================

    return res.status(201).json({
      message:
        "File uploaded successfully",

      data: {
        fileKey:
          data.path,

        fileName:
          originalName,

        fileType,

        fileSize,
      },
    });
  } catch (error) {
    console.error(
      "Upload error:",
      error
    );

    return res.status(500).json({
      message:
        "Failed to upload file.",

      error:
        error.message,
    });
  }
}