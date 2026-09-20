import jwt from 'jsonwebtoken';

export const verifyToken = (req, res, next) => {
  try {
    // 1. Lấy token từ header Authorization
    const authHeader = req.headers.authorization || req.headers.Authorization;

    // Token gửi lên thường có dạng: "Bearer <token_chuỗi_dài>"
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        message: 'Bạn chưa đăng nhập hoặc Token không hợp lệ.',
      });
    }

    // 2. Tách lấy phần Token phía sau chữ "Bearer "
    const token = authHeader.split(' ')[1];

    // 3. Xác thực Token bằng JWT_SECRET
    // (Lưu ý: JWT_SECRET lấy từ file .env của bạn)
    const secretKey = process.env.JWT_SECRET || 'your_fallback_secret_key';

    jwt.verify(token, secretKey, (err, decodedPayload) => {
      if (err) {
        // Token bị hết hạn (TokenExpiredError) hoặc chữ ký không khớp (JsonWebTokenError)
        return res.status(403).json({
          message: 'Token đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.',
        });
      }

      // 4. Giải mã thành công -> Gán payload (chứa userId, email,...) vào req.user
      req.user = {
        ...decodedPayload,
        id: decodedPayload.userId ?? decodedPayload.id,
        userId: decodedPayload.userId ?? decodedPayload.id,
      };

      // 5. Cho phép request đi tiếp vào Controller (getMe,...)
      next();
    });
  } catch (error) {
    console.error('Lỗi tại verifyToken middleware:', error);
    return res.status(500).json({ message: 'Lỗi xác thực hệ thống.' });
  }
};

export const authenticateUser = verifyToken;
export const requireAuth = verifyToken;