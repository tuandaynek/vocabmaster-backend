import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Lỗi: Thiếu SUPABASE_URL hoặc SUPABASE_KEY trong .env!");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const API_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

const LIMIT_RPM = 4;  // Ngưỡng an toàn theo phút
const LIMIT_RPD = 14; // Ngưỡng an toàn theo ngày (Vì limit cứng của Google là 20)

const MODEL_1 = "gemini-3.7-flash"; // Hoặc gemini-3.5-flash
const MODEL_2 = "gemini-3.8-flash"; // Hoặc gemini-3.6-flash

const refreshQuotaState = (state) => {
  const now = new Date();
  const updatedMinute = new Date(state.updated_minute_at);
  const updatedDay = new Date(state.updated_day_at);

  let { minute_count, day_count } = state;
  let minuteChanged = false;
  let dayChanged = false;

  if (now - updatedMinute >= 80 * 1000) {
    minute_count = 0;
    minuteChanged = true;
  }

  if (
    now.getUTCDate() !== updatedDay.getUTCDate() ||
    now - updatedDay >= 24 * 60 * 60 * 1000
  ) {
    day_count = 0;
    dayChanged = true;
  }

  return {
    ...state,
    minute_count,
    day_count,
    updated_minute_at: minuteChanged ? now.toISOString() : state.updated_minute_at,
    updated_day_at: dayChanged ? now.toISOString() : state.updated_day_at,
  };
};

const getAvailableApiKey = async (modelName, excludeIndices = []) => {
  if (API_KEYS.length === 0) {
    throw new Error("❌ Không tìm thấy API_KEYS nào trong .env!");
  }

  const { data: states } = await supabase
    .from("api_key_states")
    .select("*")
    .eq("model_name", modelName);

  const stateMap = new Map((states || []).map((s) => [s.key_index, s]));

  for (let i = 0; i < API_KEYS.length; i++) {
    // Bỏ qua các key bị loại trừ do vừa dính lỗi 429 ở lượt gọi vừa rồi
    if (excludeIndices.includes(i)) continue;

    let currentState = stateMap.get(i) || {
      key_index: i,
      model_name: modelName,
      minute_count: 0,
      day_count: 0,
      updated_minute_at: new Date().toISOString(),
      updated_day_at: new Date().toISOString(),
      is_blocked: false,
    };

    if (currentState.is_blocked) continue;

    currentState = refreshQuotaState(currentState);

    console.log(
      `🔍 [Check Key #${i}] Model [${modelName}]: RPM = ${currentState.minute_count}/${LIMIT_RPM}, RPD = ${currentState.day_count}/${LIMIT_RPD}`
    );

    if (currentState.minute_count < LIMIT_RPM && currentState.day_count < LIMIT_RPD) {
      return {
        apiKey: API_KEYS[i],
        keyIndex: i,
        state: currentState,
      };
    } else {
      console.log(`⏳ Key #${i} đã CHẠM NGƯỠNG Quota cho [${modelName}]. Chuyển sang Key tiếp theo...`);
    }
  }

  throw new Error(`🚨 TẤT CẢ API KEYS ĐÃ CHẠM NGƯỠNG QUOTA CỦA MODEL [${modelName}]!`);
};

const recordKeyUsage = async (keyIndex, modelName, currentState) => {
  const updatedState = {
    key_index: keyIndex,
    model_name: modelName,
    minute_count: currentState.minute_count + 1,
    day_count: currentState.day_count + 1,
    updated_minute_at: currentState.updated_minute_at,
    updated_day_at: currentState.updated_day_at,
    is_blocked: false,
  };

  await supabase.from("api_key_states").upsert(updatedState, {
    onConflict: "key_index,model_name",
  });
  console.log(`✅ Updated Usage -> Key #${keyIndex} [${modelName}]: Phút=${updatedState.minute_count}, Ngày=${updatedState.day_count}`);
};

// Hàm cưỡng chế đánh dấu Key hết Quota ngày khi Google nhè lỗi 429
const markKeyQuotaExceeded = async (keyIndex, modelName, currentState) => {
  console.warn(`⚠️ Cưỡng chế đánh dấu Key #${keyIndex} [${modelName}] chạm trần Quota do Google trả về 429!`);
  await supabase.from("api_key_states").upsert(
    {
      key_index: keyIndex,
      model_name: modelName,
      minute_count: LIMIT_RPM,
      day_count: LIMIT_RPD, // Đánh dấu max luôn để không gọi lại nữa
      updated_minute_at: currentState.updated_minute_at,
      updated_day_at: currentState.updated_day_at,
      is_blocked: false,
    },
    { onConflict: "key_index,model_name" }
  );
};

// Wrapper thực thi lệnh gọi AI với cơ chế TỰ ĐỘNG SWITCH KEY KHI LỖI (Retry Loop)
const executeAiCallWithRetry = async (modelName, promptText) => {
  const excludeIndices = [];

  while (excludeIndices.length < API_KEYS.length) {
    const keyInfo = await getAvailableApiKey(modelName, excludeIndices);
    const genAI = new GoogleGenerativeAI(keyInfo.apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    try {
      const result = await model.generateContent(promptText);
      await recordKeyUsage(keyInfo.keyIndex, modelName, keyInfo.state);
      return { response: result, keyIndex: keyInfo.keyIndex };
    } catch (error) {
      const errorMsg = String(error.message || "");
      console.error(`❌ Key #${keyInfo.keyIndex} gặp lỗi từ Google:`, errorMsg.slice(0, 100));

      // Nếu dính lỗi 429 (Rate limit) hoặc 503 (Server busy) -> Đánh dấu key này và retry sang key khác
      if (errorMsg.includes("429") || errorMsg.includes("Quota exceeded") || errorMsg.includes("503")) {
        await markKeyQuotaExceeded(keyInfo.keyIndex, modelName, keyInfo.state);
        excludeIndices.push(keyInfo.keyIndex);
        console.log(`🔄 Đang thử lại tự động với Key khác...`);
      } else {
        throw error; // Các lỗi khác thì quăng ra
      }
    }
  }

  throw new Error(`🚨 Không có Key nào thực thi thành công cho Model [${modelName}]!`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runContinuousTest() {
  console.log("==================================================");
  console.log(`🚀 BẮT ĐẦU CHẠY TEST ROTATE API KEYS CÓ AUTO-RETRY`);
  console.log(`🔑 Tổng số API Keys: ${API_KEYS.length}`);
  console.log("==================================================\n");

  let requestCounter = 1;

  while (true) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`\n--- [REQUEST #${requestCounter}] Lúc ${timestamp} ---`);

    try {
      // BƯỚC 1:
      console.log(`\n👉 Bước 1: Gọi Collocations (${MODEL_1})`);
      const res1 = await executeAiCallWithRetry(MODEL_1, "Cho tui 1 từ tiếng Anh ngẫu nhiên về Công nghệ");
      console.log(`🟢 [Success Step 1]: Key #${res1.keyIndex} -> "${res1.response.response.text().trim().slice(0, 40)}..."`);

      // BƯỚC 2:
      console.log(`\n👉 Bước 2: Gọi Answer (${MODEL_2})`);
      const res2 = await executeAiCallWithRetry(MODEL_2, "Chào bạn! Bạn thế nào?");
      console.log(`🟢 [Success Step 2]: Key #${res2.keyIndex} -> "${res2.response.response.text().trim().slice(0, 40)}..."`);

    } catch (err) {
      console.error(`\n💥 [REQUEST #${requestCounter} THẤT BẠI HOÀN TOÀN]:`, err.message);
    }

    requestCounter++;
    console.log(`\n😴 Nghỉ 10 giây...`);
    await sleep(10000);
  }
}

runContinuousTest();