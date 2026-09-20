import express from "express";
import {
  extractVocab,
  saveVocabSelection,
  reviewVocab,
  getUserVocabularyList,
  deleteUserVocabulary,
  getDueCards,
  getGlobalDictionary,
  getVocabAudioHandler,
} from "../controllers/vocabController.js";
import { requireAuth } from "../middlewares/verifyToken.js";

const router = express.Router();

router.post("/extract", extractVocab);
router.post("/save", requireAuth, saveVocabSelection);
router.post("/review", requireAuth, reviewVocab);
router.get("/user-list", requireAuth, getUserVocabularyList);
router.delete("/user-item/:id", requireAuth, deleteUserVocabulary);
router.get("/due-cards", requireAuth, getDueCards);
router.get("/global-list", requireAuth, getGlobalDictionary);
router.get("/audio", requireAuth, getVocabAudioHandler);

export default router;
