import { supabase } from "../lib/supabase.js";

export const XP_PER_LEVEL = 100;

// Bảng quy chuẩn XP thưởng cho toàn bộ ứng dụng
export const XP_RULES = {
  COLLOCATION_REVIEW: {
    good: 15,
    hard: 10,
    again: 5,
  },
  FLASHCARD_LEARN: 10,
  FLASHCARD_REVIEW: 5,
  QUIZ_CORRECT: 10,
  LESSON_COMPLETE: 20,
};

/**
 * Hàm chung để cộng XP, tính Streak và ghi log hoạt động hàng ngày
 * @param {Object} params
 * @param {string} params.userId - ID người dùng
 * @param {number} params.xpEarned - Số XP thưởng
 * @param {number} [params.wordsLearned=0] - Số từ học mới
 * @param {number} [params.wordsReviewed=0] - Số từ ôn tập
 * @param {number} [params.collocationsLearned=0] - Số cụm từ học/ôn tập
 */
export const grantUserXp = async ({
  userId,
  xpEarned = 0,
  wordsLearned = 0,
  wordsReviewed = 0,
  collocationsLearned = 0,
}) => {
  if (!userId) return null;

  try {
    const { data, error } = await supabase.rpc("log_user_activity", {
      p_user_id: userId,
      p_xp_earned: xpEarned,
      p_words_learned: wordsLearned,
      p_words_reviewed: wordsReviewed,
      p_collocations_learned: collocationsLearned,
    });

    if (error) {
      console.error("[grantUserXp Error]:", error.message);
      return null;
    }

    const stats = data?.[0] || {};

    return {
      xpEarned,
      totalXp: stats.new_total_xp,
      currentStreak: stats.new_current_streak,
      longestStreak: stats.new_longest_streak,
    };
  } catch (err) {
    console.error("[grantUserXp Unexpected Error]:", err);
    return null;
  }
};