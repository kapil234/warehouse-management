import express from "express";
import {
  listOutward,
  getOutwardById,
  createOutward,
  updateOutward,
  listOutwardModels,
  listOutwardStock,
  createOutwardModel,
  listOutwardCompanies,
  createOutwardCompany,
  listOutwardHistory,
} from "../controllers/outwardController.js";
import { uploadOutwardDocument } from "../controllers/documentController.js";
import authenticate from "../middleware/authenticate.js";
import authorize from "../middleware/authorize.js";
import requireWarehouseAccess from "../middleware/requireWarehouseAccess.js";
import { upload } from "../middleware/uploadMiddleware.js";

const router = express.Router();
router.use(authenticate);
router.get("/", listOutward);
router.get("/models", listOutwardModels);
// Available stock per model - feeds the outward form dropdown. Must stay above "/:id".
router.get("/stock", listOutwardStock);
router.post("/models", authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"), createOutwardModel);
router.get("/companies", listOutwardCompanies);
router.post("/companies", authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"), createOutwardCompany);
// Must stay above "/:id" or "/history" would be matched as an id.
router.get("/history", listOutwardHistory);
router.get("/:id", getOutwardById);
router.put(
  "/:id",
  authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"),
  updateOutward
);
router.post(
  "/",
  authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"),
  requireWarehouseAccess("canOutward", (req) => req.body.warehouseId),
  createOutward
);
router.post("/:id/documents", upload.single("file"), uploadOutwardDocument);
export default router;
