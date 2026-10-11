import { supabase } from "../lib/supabase.js";

// Helper tính toán Level & XP ngay tại Backend
const calculateLevel = (xp = 0) => {
  const XP_PER_LEVEL = 300;
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const currentLevelXp = xp % XP_PER_LEVEL;
  const nextLevelXp = XP_PER_LEVEL;
  const progressPercent = Math.min(
    100,
    Math.round((currentLevelXp / nextLevelXp) * 100),
  );

  return { level, currentLevelXp, nextLevelXp, progressPercent };
};

export const getUserProfileService = async (userId) => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startDate = thirtyDaysAgo.toISOString().split("T")[0];

  const [userResponse, activityResponse] = await Promise.all([
    supabase
      .from("users")
      .select(
        "username, email, avatar_url, total_xp, current_streak, longest_streak, cached_vocab_count, cached_collocation_count, last_active_date",
      )
      .eq("id", userId)
      .single(),

    supabase
      .from("user_daily_activities")
      .select("activity_date, xp_earned")
      .eq("user_id", userId)
      .gte("activity_date", startDate)
      .order("activity_date", { ascending: true }),
  ]);

  if (userResponse.error || !userResponse.data) {
    throw new Error(
      userResponse.error?.message || "Không tìm thấy người dùng.",
    );
  }

  const user = userResponse.data;
  const rawActivities = activityResponse.data || [];

  const activityHistory = (rawActivities || []).map((act) => ({
    date: act.activity_date, // Dạng 'YYYY-MM-DD'
    xp: act.xp_earned || 0,
    wordsLearned: act.words_learned || 0,
    wordsReviewed: act.words_reviewed || 0,
    collocationsLearned: act.collocations_learned || 0,
  }));

  const totalXp = Number(user.total_xp) || 0;

  // Tính toán Level Progress
  const levelInfo = calculateLevel(totalXp);

  return {
    username: user.username,
    email: user.email,
    avatarUrl: user.avatar_url,
    totalXp,
    currentStreak: user.current_streak || 0,
    longestStreak: user.longest_streak || 0,
    cachedVocabCount: user.cached_vocab_count || 0,
    cachedCollocationCount: user.cached_collocation_count || 0,
    lastActiveDate: user.last_active_date,
    activityHistory,
    // Trả về thẳng object levelInfo cho Frontend dùng
    levelInfo,
  };
};
