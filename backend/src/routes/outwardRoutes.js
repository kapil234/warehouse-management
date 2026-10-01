import express from "express";
import {
  listOutward,
  getOutwardById,
  createOutward,
  updateOutward,
  approveOutward,
  rejectOutward,
  dispatchOutward,
  downloadItemProof,
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
import { upload } from "../middleware/uploadMiddleware.js";

/**
 * Outward workflow
 *
 *   SALES              creates / edits (cost + UTR / proof)  -> PENDING_APPROVAL
 *   ACCOUNT            approves or rejects the cost          -> PENDING_DISPATCH / REJECTED
 *   WAREHOUSE_MANAGER  fills the dispatch details            -> DISPATCHED
 *   SUPER_ADMIN        can do every step
 *
 * Warehouse / company scoping is done inside the controller
 * (assertWarehouseAccess), because SALES and ACCOUNT get access through
 * their company while warehouse managers get it through a warehouse grant.
 */
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

// Sales creates. The controller checks the warehouse / company / stock itself.
router.post("/", authorize("SUPER_ADMIN", "SALES"), createOutward);

router.get("/:id", getOutwardById);
router.put("/:id", authorize("SUPER_ADMIN", "SALES"), updateOutward);

// Outward entries cannot be deleted by anyone (Super admin can update them at any time instead).

// Account decision on the cost side.
router.post("/:id/approve", authorize("SUPER_ADMIN", "ACCOUNT"), approveOutward);
router.post("/:id/reject", authorize("SUPER_ADMIN", "ACCOUNT"), rejectOutward);

// Warehouse manager fills vehicle / dispatch details.
// Accepts JSON, or multipart (payload + files + categories) so the documents travel with the dispatch.
router.put("/:id/dispatch", authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"), upload.array("files", 10), dispatchOutward);

// Payment proof of an item - never reachable by the warehouse manager.
router.get("/:id/items/:itemId/proof", authorize("SUPER_ADMIN", "SALES", "ACCOUNT"), downloadItemProof);

// Dispatch documents (challan / e-way bill / photo) are a warehouse job.
router.post("/:id/documents", authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"), upload.single("file"), uploadOutwardDocument);
export default router;
