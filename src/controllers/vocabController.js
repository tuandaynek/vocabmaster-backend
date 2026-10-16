import {
  extractVocabWithAI,
  saveVocabularyList,
  reviewVocabularyEntry,
  fetchUserVocabularyList,
  fetchDueCards,
  fetchGlobalDictionary,
  removeUserVocabularyEntry,
} from '../services/vocabService.js';

import { ensureAudioUrl } from '../utils/audio.js';

// Hàm lấy User ID an toàn từ Token hoặc Dev Fallback
const getUserIdFromReq = (req) => {
  const tokenUserId = req.user?.id || req.user?.userId;
  if (tokenUserId) return tokenUserId;

  // Chỉ cho phép fallback sang body/env khi đang ở môi trường Development
  if (process.env.NODE_ENV !== 'production') {
    return req.body?.user_id || process.env.SUPABASE_TEST_USER_ID || null;
  }

  return null;
};

// Chuẩn hóa mảng từ bắt buộc ưu tiên
const parseMustIncludeWords = (input) => {
  if (Array.isArray(input)) return input.map((w) => String(w).trim()).filter(Boolean);
  if (typeof input === 'string') return input.split(',').map((w) => w.trim()).filter(Boolean);
  return [];
};

export const extractVocabTest = async (req, res) => {
  const passage = req.body?.passage ?? '';
  const limit = Number(req.body?.limit ?? 10);
  const focusMode = req.body?.focusMode ?? 'ielts_academic';
  const mustIncludeWords = parseMustIncludeWords(req.body?.mustIncludeWords);

  console.log('-> Config nhận từ Frontend (Test):', {
    passageLength: passage?.length,
    limit,
    focusMode,
    mustIncludeWords,
  });

  if (!passage || !passage.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Passage is required',
    });
  }

  try {
    const data = await extractVocabWithAI({
      passage,
      limit,
      focusMode,
      mustIncludeWords,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('extractVocabTest failed:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to extract vocabulary',
    });
  }
};

export const extractVocab = async (req, res) => {
  const passage = req.body?.passage ?? '';
  const limit = Number(req.body?.limit ?? 10);
  const focusMode = req.body?.focusMode ?? 'ielts_academic';
  const mustIncludeWords = parseMustIncludeWords(req.body?.mustIncludeWords);

  if (!passage || !passage.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Passage is required',
    });
  }

  try {
    const data = await extractVocabWithAI({
      passage,
      limit,
      focusMode,
      mustIncludeWords,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('extractVocab failed:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to extract vocabulary',
    });
  }
};

export const saveVocabSelection = async (req, res) => {
  const singleUpgrade = req.body?.originalWord && req.body?.upgradedWord
    ? [{
      word: req.body.upgradedWord,
      meaning: req.body.meaning,
      context_sentence: req.body.example || null,
      collocations: [{ phrase: req.body.originalWord }],
    }]
    : null;
  const vocabList = req.body?.vocabList ?? req.body?.selectedWords ?? singleUpgrade ?? [];
  const userId = getUserIdFromReq(req);

  try {
    if (!Array.isArray(vocabList) || !vocabList.length) {
      return res.status(400).json({
        success: false,
        message: 'vocabList is required and must not be empty',
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Thiếu token xác thực hoặc user_id',
      });
    }

    const result = await saveVocabularyList({
      vocabList,
      userId,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('saveVocabSelection failed:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to save vocabulary',
    });
  }
};

export const reviewVocab = async (req, res) => {
  const { user_vocab_id, rating } = req.body || {};
  const userId = getUserIdFromReq(req);

  try {
    if (!user_vocab_id) {
      return res.status(400).json({
        success: false,
        message: 'user_vocab_id is required',
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Thiếu token xác thực hoặc user_id',
      });
    }

    const result = await reviewVocabularyEntry({
      user_vocab_id,
      rating,
      userId,
    });

    return res.status(200).json(result);
  } catch (error) {
    const isAuthError = error.message?.includes('quyền') || error.message?.includes('permission');
    const isNotFoundError = error.message?.includes('không tìm thấy') || error.message?.includes('not found');
    const statusCode = isAuthError ? 403 : isNotFoundError ? 404 : 400;

    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to review vocabulary',
    });
  }
};

export const getUserVocabularyList = async (req, res) => {
  const userId = getUserIdFromReq(req);

  try {
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Thiếu token xác thực hợp lệ',
      });
    }

    const data = await fetchUserVocabularyList({ userId });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('getUserVocabularyList failed:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to load user vocabulary list',
    });
  }
};

export const deleteUserVocabulary = async (req, res) => {
  const vocabId = req.params?.id ?? null;
  const userId = getUserIdFromReq(req);

  try {
    if (!vocabId) {
      return res.status(400).json({
        success: false,
        message: 'Vocabulary id is required',
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Thiếu token xác thực hợp lệ',
      });
    }

    const result = await removeUserVocabularyEntry({ vocabId, userId });

    return res.status(200).json({
      success: true,
      data: result,
      message: 'Từ đã được xoá khỏi kho cá nhân',
    });
  } catch (error) {
    const isNotFound = error.message?.includes('not found') || error.message?.includes('không tìm thấy');
    const isAuth = error.message?.includes('permission') || error.message?.includes('quyền');
    const statusCode = isNotFound ? 404 : isAuth ? 403 : 500;

    console.error('deleteUserVocabulary failed:', error);
    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to delete vocabulary from personal dictionary',
    });
  }
};

export const getDueCards = async (req, res) => {
  const userId = getUserIdFromReq(req);

  try {
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Thiếu token xác thực hợp lệ',
      });
    }

    const data = await fetchDueCards({ userId, limit: 20 });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('getDueCards failed:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to load due cards',
    });
  }
};

export const getGlobalDictionary = async (req, res) => {
  const search = String(req.query.search || '');
  const pos = String(req.query.pos || 'all');
  const wordType = String(req.query.wordType || 'all');
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 9);

  try {
    const result = await fetchGlobalDictionary({ search, pos, wordType, page, limit });
    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('getGlobalDictionary failed:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to load global dictionary',
    });
  }
};

export async function getVocabAudioHandler(req, res) {
  try {
    const text = (req.query.text || req.params?.text || '').toString().trim();
    if (!text) return res.status(400).json({ message: 'Thiếu text' });

    // Lấy thêm các tùy chọn từ query nếu FE muốn tùy chỉnh bảng/bucket
    const { table, targetField, recordId, bucket } = req.query;

    // Gọi helper đa năng
    const audioUrl = await ensureAudioUrl(text, {
      table: table || 'global_words',
      targetField: targetField || 'word',
      recordId: recordId || null,
      bucket: bucket || 'vocab-audios',
    });

    return res.json({ success: true, audioUrl });
  } catch (error) {
    return res.status(500).json({ message: error?.message || 'Lỗi xử lý audio' });
  }
}
