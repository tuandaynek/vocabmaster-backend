import * as speakingService from '../services/speakingService.js';
import { generateVocabAudio } from '../lib/elevenlabs.js';
import { supabase } from '../lib/supabase.js';

/**
 * POST /api/speaking/chat-step
 * Body: { question, targetBand, history, userResponse }
 */
export const handleChatStep = async (req, res) => {
  try {
    const { question, targetBand, history, userResponse } = req.body;

    if (!userResponse || !userResponse.trim()) {
      return res.status(400).json({ success: false, message: 'Phản hồi không được để trống.' });
    }

    const result = await speakingService.processChatStep({
      question,
      targetBand,
      history: history || [],
      userResponse,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error in handleChatStep:', error);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi xử lý câu trả lời.' });
  }
};

/**
 * POST /api/speaking/collocations
 * Body: { vietnamesePhrase, currentQuestion }
 */
export const handleGetCollocations = async (req, res) => {
  try {
    const { vietnamesePhrase, currentQuestion, targetBand } = req.body;

    if (!vietnamesePhrase || !vietnamesePhrase.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập cụm từ tiếng Việt.' });
    }

    const collocations = await speakingService.generateCollocations({
      vietnamesePhrase,
      currentQuestion,
      targetBand,
    });

    return res.status(200).json({
      success: true,
      data: collocations,
    });
  } catch (error) {
    console.error('Error in handleGetCollocations:', error);
    return res.status(500).json({ success: false, message: 'Không thể tra cứu collocations lúc này.' });
  }
};

/**
 * POST /api/speaking/hints
 * Body: { question }
 */
export const handleGetHints = async (req, res) => {
  try {
    const { question, history } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, message: 'Thiếu câu hỏi.' });
    }

    const hints = await speakingService.generateIdeaHints({ question, history: history || [] });

    console.log('Generated hints:', hints);

    return res.status(200).json({
      success: true,
      data: hints,
    });
  } catch (error) {
    console.error('Error in handleGetHints:', error);
    return res.status(500).json({ success: false, message: 'Không thể tải gợi ý ý tưởng.' });
  }
};

/**
 * POST /api/speaking/evaluate
 * Body: { question, targetBand, fullTranscript, audio, mimeType }
 */
export const handleEvaluateSession = async (req, res) => {
  try {
    const { question, targetBand, fullTranscript, audio, mimeType } = req.body;

    if (!fullTranscript || fullTranscript.length === 0) {
      return res.status(400).json({ success: false, message: 'Dữ liệu bài nói không hợp lệ.' });
    }

    const audioBuffer = req.file ? req.file.buffer : null;
    const finalMimeType = req.file ? req.file.mimetype : mimeType;

    const evaluation = await speakingService.evaluateSpeakingSession({
      question,
      targetBand,
      fullTranscript,
      audioBuffer,
      finalMimeType,
    });

    return res.status(200).json({
      success: true,
      data: evaluation,
    });
  } catch (error) {
    console.error('Error in handleEvaluateSession:', error);
    return res.status(500).json({ success: false, message: 'Lỗi khi chấm điểm bài nói.' });
  }
};

export const handleTtsSample = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Text is required.' });
    }

    const audioBase64 = await generateVocabAudio(text.trim());
    return res.status(200).json({ success: true, data: { audioBase64 } });
  } catch (error) {
    console.error('Error in handleTtsSample:', error);
    return res.status(500).json({ success: false, message: 'Không thể tạo audio mẫu.', error: error.message });
  }
};

export const handleSaveSpeakingHistory = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { question, audioUrl, transcript, overallBand, detailedScores, createdAt } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized.' });
    }
    if (!question || typeof overallBand !== 'number' || !detailedScores) {
      return res.status(400).json({ success: false, message: 'Dữ liệu bài luyện tập không hợp lệ.' });
    }

    const { data, error } = await supabase
      .from('speaking_practice_history')
      .insert({
        user_id: userId,
        question,
        audio_url: audioUrl || null,
        transcript: transcript || null,
        overall_band: overallBand,
        detailed_scores: detailedScores,
        created_at: createdAt || new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error('Error in handleSaveSpeakingHistory:', error);
    return res.status(500).json({ success: false, message: 'Không thể lưu bài luyện tập.', error: error.message });
  }
};