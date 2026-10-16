import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import authRoute from "./routes/authRoute.js";
import vocabRoutes from "./routes/vocabRoute.js";
import collocationRoutes from "./routes/collocationRoute.js";
import speakingRoute from "./routes/speakingRoute.js";
import writingRoute from "./routes/writingRoute.js";
import profileRoute from "./routes/profileRoute.js";
import websiteRoute from "./routes/websiteRoute.js";
import adminRoute from "./routes/adminRoute.js"
import grammarRoute from './routes/grammarRoute.js'

import { handleTtsSample } from "./controllers/speakingController.js";
import rateLimit from 'express-rate-limit'

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Config CORS
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  process.env.FRONTEND_URL,
].filter(Boolean);
// Chặn spam request ở cấp độ Express (VD: Tối đa 30 requests/phút cho toàn bộ API)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 phút
  max: 30, 
  message: { success: false, message: "Bạn thao tác quá nhanh, vui lòng thử lại sau 1 phút!" }
});

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || origin.startsWith("http://192.168.")) {
        return callback(null, true);
      }
      return callback(null, true); // Hoặc đổi sang strict restriction nếu đẩy Production hẳn
    },
    credentials: true,
  })
);

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


// Routes
app.use("/api/", limiter);
app.use("/api/auth", authRoute);
app.use("/api/vocab", vocabRoutes);
app.use("/api/collocation", collocationRoutes);
app.use("/api/speaking", speakingRoute);
app.use("/api/writing", writingRoute);
app.use("/api/profile", profileRoute);
app.use("/api/website", websiteRoute);
app.use("/api/admin", adminRoute);
app.use("/api", grammarRoute);
app.post("/api/tts/sample", handleTtsSample);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("🔥 Server Error:", err.stack || err.message);
  res.status(500).json({ success: false, message: err.message || "Server Internal Error" });
});

// Start Server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});