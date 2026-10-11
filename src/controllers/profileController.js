import { getUserProfileService } from "../services/userService.js";

export const getProfile = async (req, res) => {
  try {
    // Lấy userId từ Middleware Auth (sau khi verify JWT)
    const userId = req.user?.id; 

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Chưa xác thực người dùng.",
      });
    }

    // Gọi hàm Service xử lý data
    const profileData = await getUserProfileService(userId);

    // Trả kết quả thành công
    return res.status(200).json({
      success: true,
      message: "Lấy thông tin profile thành công.",
      data: profileData,
    });
  } catch (error) {
    console.error("Error in getProfile Controller:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Lỗi máy chủ nội bộ.",
    });
  }
};