import express from "express";
import { signup, login, me } from "../controllers/authController.js";
import authenticate from "../middleware/authenticate.js";

const router = express.Router();

// Public — no token needed
router.post("/signup", signup);
router.post("/login", login);

// Protected
router.get("/me", authenticate, me);

export default router;
