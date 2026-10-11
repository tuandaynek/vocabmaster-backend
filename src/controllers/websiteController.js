import * as websiteService from '../services/websiteService.js';

// 1. Endpoint lấy mảng feature_name mà user đã rate
export const getMyRatedFeatures = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Chưa xác thực người dùng' });

    const ratedFeatures = await websiteService.getUserRatedFeatures(userId);
    return res.status(200).json({ message: "Successful", data: ratedFeatures });
  } catch (error) {
    return res.status(500).json({ message: 'Lỗi lấy danh sách rated features', error: error.message });
  }
};

// 2. Endpoint lưu/sửa đánh giá tính năng
export const submitRating = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Chưa xác thực người dùng' });

    const { feature_name, rating, comment } = req.body;

    if (!feature_name || !rating) {
      return res.status(400).json({ message: 'Thiếu feature_name hoặc điểm rating' });
    }

    const savedRating = await websiteService.upsertRating(userId, {
      feature_name,
      rating,
      comment,
    });

    return res.status(200).json({
      message: 'Lưu đánh giá thành công!',
      rating: savedRating,
    });
  } catch (error) {
    console.error(error.message)
    return res.status(500).json({ message: 'Lỗi lưu đánh giá', error: error.message });
  }
};

// 3. Endpoint public lấy dữ liệu thống kê & feed hiển thị ra giao diện
export const getPublicStats = async (_req, res) => {
  try {
    const data = await websiteService.getStatsAndFeed();
    return res.status(200).json({
      message: "Successful!",
      data
    });
  } catch (error) {
    return res.status(500).json({ message: 'Lỗi lấy thống kê public', error: error.message });
  }
};