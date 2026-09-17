import express from "express";
import { uploadFile } from "../controllers/uploadController.js";
import { upload } from "../middleware/uploadMiddleware.js";
import authenticate from "../middleware/authenticate.js";

const router = express.Router();

// User must be logged in
router.use(authenticate);

// Upload file
router.post(
  "/",
  upload.single("file"),
  uploadFile
);

export default router;