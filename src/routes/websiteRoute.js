import express from 'express';
import {
  getMyRatedFeatures,
  submitRating,
  getPublicStats,
} from '../controllers/websiteController.js';
import { verifyToken } from '../middlewares/verifyToken.js';

const router = express.Router();

// Public route - Không cần login để xem stats & reviews feed
router.get('/stats/public', getPublicStats);

// Protected routes - Bắt buộc login
router.get('/my-rating', verifyToken, getMyRatedFeatures);
router.post('/submit-rating', verifyToken, submitRating);

export default router;