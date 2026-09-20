import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_ANON_KEY || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn("⚠️ Cảnh báo: Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env");
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);