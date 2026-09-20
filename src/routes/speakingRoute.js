import express from 'express';
import {
  handleChatStep,
  handleGetCollocations,
  handleGetHints,
  handleEvaluateSession,
  handleEvaluateAudio
  ,handleSaveSpeakingHistory
} from '../controllers/speakingController.js';
import multer from 'multer';
import { requireAuth } from '../middlewares/verifyToken.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // Giới hạn 25MB (mức chuẩn của Whisper)
});

router.post('/chat-step', handleChatStep);
router.post('/collocations', handleGetCollocations);
router.post('/hints', handleGetHints);
router.post('/evaluate', handleEvaluateSession);
router.post('/evaluate-audio', upload.single('audio'), handleEvaluateAudio);
router.post('/history', requireAuth, handleSaveSpeakingHistory);

export default router;