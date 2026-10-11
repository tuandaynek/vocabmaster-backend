import { supabase } from '../lib/supabase.js';

// 1. Lấy danh sách tên tính năng user đã đánh giá
export const getUserRatedFeatures = async (userId) => {
  const { data, error } = await supabase
    .from('user_feedbacks')
    .select('feature_name')
    .eq('user_id', userId);

  if (error) throw error;
  return data.map((item) => item.feature_name);
};

// 2. Thêm mới hoặc Cập nhật Rating (Upsert)
export const upsertRating = async (userId, { feature_name, rating, comment }) => {
  const { data, error } = await supabase
    .from('user_feedbacks')
    .upsert(
      {
        user_id: userId,
        feature_name,
        rating,
        comment: comment || '',
        created_at: new Date().toISOString(),
      },
      { onConflict: 'user_id, feature_name' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
};

// 3. Tính toán thống kê & Lấy 10 đánh giá mới nhất
export const getStatsAndFeed = async () => {
  // Dùng Promise.all để gọi đồng thời 3 truy vấn cùng một lúc, giảm thời gian chờ xuống tối thiểu
  const [usersRes, ratingsRes, feedRes] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('user_feedbacks').select('rating'),
    supabase.from('user_feedbacks').select(`
      id,
      feature_name,
      rating,
      comment,
      created_at,
      users (
        username,
        avatar_url
      )
    `).order('created_at', { ascending: false }).limit(10)
  ]);

  if (ratingsRes.error) throw ratingsRes.error;

  const allRatings = ratingsRes.data || [];
  const totalRatings = allRatings.length;
  const avgRating =
    totalRatings > 0
      ? Number((allRatings.reduce((sum, r) => sum + r.rating, 0) / totalRatings).toFixed(1))
      : 5.0;

  return {
    stats: {
      totalUsers: usersRes.count || 0,
      avgRating,
      totalRatings,
    },
    recentFeed: feedRes.data || [],
  };
};