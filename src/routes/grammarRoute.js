import express from "express";
import {
  createQuestionController,
  createStageController,
  createSubTopicController,
  createTopicController,
  getQuestionsController,
  getSubTopicDetailController,
  getSubTopicsController,
  getStagesController,
  getTopicsController,
  getUserProgressController,
  importFullSubTopicController,
  submitSessionController,
  updateSubTopicTheoryController,
} from "../controllers/grammarController.js";
import { verifyAdminToken } from "../middlewares/verifyAdminToken.js";
import { verifyToken } from "../middlewares/verifyToken.js";

const router = express.Router();

router.get("/grammar/topics", verifyToken, getTopicsController);
router.get("/grammar/topics/:topicId/sub-topics", verifyToken, getSubTopicsController);
router.get("/grammar/sub-topics/:subTopicId", verifyToken, getSubTopicDetailController);
router.get("/grammar/sub-topics/:subTopicId/stages", verifyToken, getStagesController);
router.get("/grammar/stages/:stageId/questions", verifyToken, getQuestionsController);
router.post("/grammar/sessions/submit", verifyToken, submitSessionController);
router.get("/grammar/users/:userId/progress", verifyToken, getUserProgressController);
router.post("/admin/grammar/topics", verifyAdminToken, createTopicController);
router.post("/admin/grammar/topics/:topicId/sub-topics", verifyAdminToken, createSubTopicController);
router.put("/admin/grammar/sub-topics/:subTopicId", verifyAdminToken, updateSubTopicTheoryController);
router.post("/admin/grammar/sub-topics/:subTopicId/stages", verifyAdminToken, createStageController);
router.post("/admin/grammar/stages/:stageId/questions", verifyAdminToken, createQuestionController);
router.post(
  "/admin/grammar/sub-topics/import-full",
  verifyAdminToken,
  importFullSubTopicController,
);

export default router;
