import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import authRoute from "./routes/authRoute.js";
import vocabRoutes from "./routes/vocabRoutes.js";
import collocationRoutes from "./routes/collocationRoutes.js";
import speakingRoute from "./routes/speakingRoute.js";
import writingRoute from "./routes/writingRoute.js";
import { handleTtsSample } from "./controllers/speakingController.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: (origin, callback) => {
      // Cho phép tất cả các domain/IP gửi tới (bao gồm cả Radmin IP)
      callback(null, true);
    },
    credentials: true, // 👈 BẮT BUỘC để cho phép gửi/nhận Cookie qua mạng
  })
);

// Routes
app.use("/api/auth", authRoute);
app.use("/api/vocab", vocabRoutes);
app.use("/api/collocation", collocationRoutes);
app.use("/api/speaking", speakingRoute);
app.use("/api/writing", writingRoute);
app.post("/api/tts/sample", handleTtsSample);

// Start Server trực tiếp
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});