import jwt from "jsonwebtoken";
import { supabase } from "../lib/supabase.js";

// Middleware kiểm tra quyền Admin
export const verifyAdminToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Authorization token is required",
      });
    }

    const token = authHeader.slice("Bearer ".length);
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your_fallback_secret_key",
    );
    const userId =
      typeof decoded === "object" && decoded
        ? decoded.userId ?? decoded.id
        : null;

    if (!userId) {
      return res.status(403).json({
        success: false,
        error: "Invalid authentication token",
      });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to verify admin role: ${error.message}`);
    }

    if (user?.role !== "admin") {
      return res.status(403).json({
        success: false,
        error: "Admin access is required",
      });
    }

    req.user = { id: userId, userId, role: "admin" };
    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(403).json({
        success: false,
        error: "Invalid or expired authentication token",
      });
    }

    console.error("verifyAdminToken failed:", error);
    return res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Admin authorization failed",
    });
  }
};