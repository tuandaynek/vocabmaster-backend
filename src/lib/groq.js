import Groq from "groq-sdk";
import { supabase } from "../lib/supabase.js";

// --- CẤU HÌNH RATE LIMIT (Fallback nếu không có ENV) ---
const DEFAULT_LIMIT_RPM = 30;
const DEFAULT_LIMIT_RPD = 1000;
// Set mặc định theo mức an toàn của Qwen (ví dụ 8k TPM)
const DEFAULT_LIMIT_TPM = 7000; 
const DEFAULT_LIMIT_TPD = 200000;

const MINUTE_WINDOW_MS = 60 * 1000;
const DAY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const GROQ_MODELS = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"];

const getApiKeys = () =>
  (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

const getLimits = () => ({
  rpm: Number.parseInt(process.env.GROQ_LIMIT_RPM, 10) || DEFAULT_LIMIT_RPM,
  rpd: Number.parseInt(process.env.GROQ_LIMIT_RPD, 10) || DEFAULT_LIMIT_RPD,
  tpm: Number.parseInt(process.env.GROQ_LIMIT_TPM, 10) || DEFAULT_LIMIT_TPM,
  tpd: Number.parseInt(process.env.GROQ_LIMIT_TPD, 10) || DEFAULT_LIMIT_TPD,
});

const errorMessage = (error) =>
  error instanceof Error ? error.message : String(error?.message || error);

const isRateLimitError = (error) => {
  const status = error?.status || error?.statusCode || error?.response?.status;
  const message = errorMessage(error).toLowerCase();
  const code = error?.error?.code || error?.code;
  return (
    status === 429 ||
    message.includes("rate_limit_exceeded") ||
    message.includes("429") ||
    code === "rate_limit_exceeded"
  );
};

const isKeyBlockedError = (error) => {
  const status = error?.status || error?.statusCode;
  const message = errorMessage(error).toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    message.includes("invalid_api_key") ||
    message.includes("unauthorized")
  );
};

export const isBadRequestError = (error) => {
  const status = error?.status || error?.response?.status;
  return status === 400;
};

// --- QUẢN LÝ TRẠNG THÁI QUOTA (Bao gồm Token) ---
const refreshQuotaState = (state) => {
  const now = new Date();
  const updatedMinute = new Date(state.updated_minute_at);
  const updatedDay = new Date(state.updated_day_at);

  let { minute_count, day_count, tpm_count, tpd_count } = state;
  let updatedMinuteAt = state.updated_minute_at;
  let updatedDayAt = state.updated_day_at;

  // Reset Quota theo phút (RPM & TPM)
  if (now.getTime() - updatedMinute.getTime() >= MINUTE_WINDOW_MS) {
    minute_count = 0;
    tpm_count = 0; // Thêm reset TPM
    updatedMinuteAt = now.toISOString();
  }

  // Reset Quota theo ngày (RPD & TPD)
  const isDifferentDay =
    now.toLocaleDateString("vi-VN") !== updatedDay.toLocaleDateString("vi-VN");
  if (isDifferentDay || now.getTime() - updatedDay.getTime() >= DAY_WINDOW_MS) {
    day_count = 0;
    tpd_count = 0; // Thêm reset TPD
    updatedDayAt = now.toISOString();
  }

  return {
    ...state,
    minute_count,
    day_count,
    tpm_count: tpm_count || 0, // Fallback nếu DB trả null
    tpd_count: tpd_count || 0, // Fallback nếu DB trả null
    updated_minute_at: updatedMinuteAt,
    updated_day_at: updatedDayAt,
  };
};

const getAvailableApiKey = async (modelName, excludedIndices, apiKeys) => {
  if (!apiKeys.length) {
    throw new Error("Không tìm thấy GROQ_API_KEYS trong biến môi trường.");
  }

  const { data: states, error } = await supabase
    .from("api_key_states")
    .select("*")
    .eq("model_name", modelName);

  if (error) {
    throw new Error(`Lỗi query DB api_key_states: ${error.message}`);
  }

  const stateMap = new Map((states || []).map((s) => [s.key_index, s]));
  const now = new Date().toISOString();
  const { rpm, rpd, tpm, tpd } = getLimits();

  // Khái toán số token sẽ dùng để tránh chạm trần ngay request này (Tùy chọn)
  const estimatedTokenCost = 500; 

  for (let index = 0; index < apiKeys.length; index += 1) {
    if (excludedIndices.has(index)) continue;

    const rawState = stateMap.get(index) || {
      key_index: index,
      model_name: modelName,
      minute_count: 0,
      day_count: 0,
      tpm_count: 0,
      tpd_count: 0,
      updated_minute_at: now,
      updated_day_at: now,
      is_blocked: false,
    };

    const currentState = refreshQuotaState(rawState);

    // KIỂM TRA TOÀN BỘ QUOTA (Request + Token)
    if (
      !currentState.is_blocked &&
      currentState.minute_count < rpm &&
      currentState.day_count < rpd &&
      (currentState.tpm_count + estimatedTokenCost) < tpm &&
      currentState.tpd_count < tpd
    ) {
      return { apiKey: apiKeys[index], keyIndex: index, state: currentState };
    }
  }

  throw new Error(`Tất cả Groq API keys đã kịch Quota (Requests hoặc Tokens) cho model: ${modelName}`);
};

const upsertKeyState = async (state) => {
  const { error } = await supabase.from("api_key_states").upsert(state, {
    onConflict: "key_index,model_name",
  });
  if (error) {
    console.error(`❌ Supabase Key State Update Error: ${error.message}`);
  }
};

// Cập nhật hàm Record để ghi nhận Token Usage
const recordKeyUsage = async (keyInfo, modelName, tokenUsage) => {
  // Lấy tổng token đã dùng từ API response (tính cả input + output)
  const tokensUsed = tokenUsage?.total_tokens || 0;

  await upsertKeyState({
    ...keyInfo.state,
    minute_count: keyInfo.state.minute_count + 1,
    day_count: keyInfo.state.day_count + 1,
    tpm_count: keyInfo.state.tpm_count + tokensUsed,
    tpd_count: keyInfo.state.tpd_count + tokensUsed,
    model_name: modelName,
  });
};

const markKeyQuotaExceeded = async (keyInfo, modelName) => {
  const { rpm, rpd, tpm, tpd } = getLimits();
  // Đánh dấu chạm đỉnh RPM và TPM để key này bị bỏ qua trong phút hiện tại
  await upsertKeyState({
    ...keyInfo.state,
    minute_count: rpm,
    tpm_count: tpm,
    day_count: Math.max(keyInfo.state.day_count, rpd),
    tpd_count: Math.max(keyInfo.state.tpd_count, tpd),
    model_name: modelName,
  });
};

const markKeyBlocked = async (keyInfo, modelName) => {
  await upsertKeyState({
    ...keyInfo.state,
    is_blocked: true,
    model_name: modelName,
  });
};

/**
 * Hàm gọi API Groq có Rotate Key & Quản lý Token
 */
export const generateGroqContent = async ({
  modelName = GROQ_MODELS[0],
  systemInstruction = "You are a helpful AI assistant. Respond strictly in valid JSON format.",
  prompt = "",
  temperature = 0.3,
} = {}) => {
  const apiKeys = getApiKeys();
  const excludedIndices = new Set();
  let attempts = 0;
  let lastError = null;

  while (excludedIndices.size < apiKeys.length) {
    let keyInfo;
    try {
      keyInfo = await getAvailableApiKey(modelName, excludedIndices, apiKeys);
    } catch (err) {
      return {
        success: false,
        error: { code: "ALL_KEYS_EXHAUSTED", message: errorMessage(err) },
        meta: { modelName, attempts },
      };
    }

    try {
      const groq = new Groq({ apiKey: keyInfo.apiKey });

      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt },
        ],
        model: modelName,
        response_format: { type: "json_object" },
        temperature,
      });

      // LẤY SỐ TOKEN TỪ RESPONSE VÀ GHI VÀO DB
      const tokenUsage = completion.usage;
      await recordKeyUsage(keyInfo, modelName, tokenUsage);

      const rawText = completion.choices[0]?.message?.content || "";
      let parsedJson = null;
      try {
        parsedJson = JSON.parse(rawText);
      } catch (parseErr) {
        console.warn("⚠️ Không thể parse JSON từ Output:", rawText);
      }

      return {
        success: true,
        data: { text: rawText, json: parsedJson },
        meta: { modelName, keyIndexUsed: keyInfo.keyIndex, attempts, tokensUsed: tokenUsage?.total_tokens },
      };
    } catch (error) {
      attempts += 1;
      lastError = error;

      if (isBadRequestError(error)) {
        console.error(`❌ Lỗi Client Format (400): ${errorMessage(error)}`);
        throw error;
      }

      excludedIndices.add(keyInfo.keyIndex);

      if (isKeyBlockedError(error)) {
        console.error(`❌ Groq Key #${keyInfo.keyIndex} bị Blocked. Thử key khác...`);
        await markKeyBlocked(keyInfo, modelName);
        continue;
      }

      if (isRateLimitError(error)) {
        console.error(`⚠️ Groq Key #${keyInfo.keyIndex} vượt Quota (Token/Request). Thử key khác...`);
        await markKeyQuotaExceeded(keyInfo, modelName);
        continue;
      }

      console.warn(`⏳ Groq Key #${keyInfo.keyIndex} gặp lỗi (${errorMessage(error)}). Thử key khác...`);
    }
  }

  return {
    success: false,
    error: {
      code: "ALL_KEYS_EXHAUSTED",
      message: `Tất cả keys đều thất bại cho model ${modelName}. Lỗi cuối: ${errorMessage(lastError)}`,
    },
    meta: { modelName, attempts },
  };
};

export const callGroqWithFallback = async ({
  prompt,
  systemInstruction,
  temperature = 0.2,
}) => {
  let lastError = null;
  const modelCandidates = [...GROQ_MODELS]; // Copy mảng để tránh thay đổi gốc

  for (const modelName of modelCandidates) {
    const response = await generateGroqContent({
      modelName,
      prompt,
      systemInstruction,
      temperature,
    });

    if (response.success && response.data.json) {
      return response.data.json;
    }

    if (response.success && response.data.text) {
      try {
        return JSON.parse(response.data.text);
      } catch (err) {
        lastError = new Error(`JSON từ ${modelName} bị lỗi: ${err.message}`);
        continue;
      }
    }

    lastError = new Error(
      response.error?.message || `Lỗi gọi Groq Model: ${modelName}`,
    );
  }

  throw new Error(
    `Không thể xử lý yêu cầu AI: ${lastError?.message || "Lỗi không xác định"}`,
  );
};

export default generateGroqContent;