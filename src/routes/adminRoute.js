import express from "express";
import {
  adminImportCollocations,
} from "../controllers/adminController.js";
import { verifyAdminToken } from "../middlewares/verifyAdminToken.js";

const router = express.Router();

router.post("/collocation/import", verifyAdminToken, adminImportCollocations);

export default router;