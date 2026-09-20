import express from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/verifyToken.js";
import {
  evaluateEssay,
  generateEssayOutline,
  handleTutorChat,
} from "../services/writingService.js";

const router = express.Router();

router.post("/tutor-chat", async (req, res) => {
  try {
    const { questionText, chatHistory, userMessage, targetBand } = req.body || {};
    if (typeof questionText !== "string" || !questionText.trim()) {
      return res.status(400).json({ success: false, message: "questionText is required." });
    }
    if (typeof userMessage !== "string" || !userMessage.trim()) {
      return res.status(400).json({ success: false, message: "userMessage is required." });
    }

    const data = await handleTutorChat(questionText, chatHistory, userMessage, targetBand);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error in writing tutor chat:", error);
    return res.status(502).json({
      success: false,
      message: "Không thể kết nối AI Writing Tutor lúc này.",
      error: error.message,
    });
  }
});

router.post("/outline", async (req, res) => {
  try {
    const { questionText } = req.body || {};
    if (typeof questionText !== "string" || !questionText.trim()) {
      return res.status(400).json({
        success: false,
        message: "questionText is required.",
      });
    }

    const data = await generateEssayOutline(questionText);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error in writing outline:", error);
    return res.status(502).json({
      success: false,
      message: "Không thể tạo dàn ý Writing lúc này.",
      error: error.message,
    });
  }
});

router.post("/evaluate", async (req, res) => {
  try {
    const { questionText, userEssay } = req.body || {};
    if (typeof questionText !== "string" || !questionText.trim()) {
      return res.status(400).json({
        success: false,
        message: "questionText is required.",
      });
    }
    if (typeof userEssay !== "string" || !userEssay.trim()) {
      return res.status(400).json({
        success: false,
        message: "userEssay is required.",
      });
    }

    const data = await evaluateEssay(questionText, userEssay);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error in writing evaluation:", error);
    return res.status(502).json({
      success: false,
      message: "Không thể chấm bài Writing lúc này.",
      error: error.message,
    });
  }
});

router.post("/save", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { questionText, userEssay, outline, evaluation } = req.body || {};

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }
    if (
      typeof questionText !== "string" ||
      !questionText.trim() ||
      typeof userEssay !== "string" ||
      !userEssay.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "questionText and userEssay are required.",
      });
    }

    const { data, error } = await supabase
      .from("writing_practice_history")
      .insert({
        user_id: userId,
        question_text: questionText.trim(),
        user_essay: userEssay.trim(),
        outline: outline ?? null,
        evaluation: evaluation ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error("Error in writing save:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể lưu bài Writing.",
      error: error.message,
    });
  }
});

export default router;
