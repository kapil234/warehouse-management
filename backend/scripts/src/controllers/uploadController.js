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
    // UNIQUE FILE NAME
    // ==========================================
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const fileName = `${uniqueSuffix}.${extension}`;
    const fileKey = `uploads/${fileName}`;

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