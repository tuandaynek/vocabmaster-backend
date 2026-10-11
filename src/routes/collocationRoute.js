import express from "express";
import {
  adminImportCollocations,
  downloadCollocations,
  getCollocationReview,
  getDueCollocations,
  getGlobalCollocations,
  getNextCollocationHandler,
  getUserCollocations,
  reviewCollocation,
  saveCollocationsSelection,
  getCollocationVariations,
  getPhase1Translation,
  completeReview,
  evaluatePhase2Collocation,
  evaluatePhase3Collocation
} from "../controllers/collocationController.js";
import { requireAuth } from "../middlewares/verifyToken.js";

const router = express.Router();

router.get("/global-list", getGlobalCollocations);
router.post("/save", requireAuth, saveCollocationsSelection);
router.post("/download", requireAuth, downloadCollocations);
router.post("/admin/import", requireAuth, adminImportCollocations);
router.get("/user-list", requireAuth, getUserCollocations);
router.get("/due-cards", requireAuth, getDueCollocations);
router.post("/review", requireAuth, reviewCollocation);
router.get("/next-review", requireAuth, getNextCollocationHandler);
router.get("/review/:collocationId", requireAuth, getCollocationReview);

router.get("/review/:collocationId/variations", requireAuth, getCollocationVariations);

router.get("/review/:collocationId/phase1", requireAuth, getPhase1Translation);
router.post("/review/evaluate-phase2", requireAuth, evaluatePhase2Collocation);
router.post("/review/evaluate-phase3", requireAuth, evaluatePhase3Collocation);

router.post("/review/:collocationId/complete", requireAuth, completeReview);

export default router;
