import express from "express";
import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/productController.js";
import authenticate from "../middleware/authenticate.js";
import authorize from "../middleware/authorize.js";

const router = express.Router();

router.use(authenticate);

// Everyone logged in can read the list (inward / outward forms need it).
router.get("/", listProducts);

// Only admins can change the product list.
router.post("/", authorize("SUPER_ADMIN"), createProduct);
router.patch("/:id", authorize("SUPER_ADMIN"), updateProduct);
router.delete("/:id", authorize("SUPER_ADMIN"), deleteProduct);

export default router;
