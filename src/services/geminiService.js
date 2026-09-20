import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabase } from "../lib/supabase.js";

const DEFAULT_LIMIT_RPM = 4;
const DEFAULT_LIMIT_RPD = 14;
const MINUTE_WINDOW_MS = 80 * 1000;
const DAY_WINDOW_MS = 24 * 60 * 60 * 1000;

// Helper delay ngẫu nhiên tránh anti-bot detection của Google
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getRandomJitter = (min = 100, max = 300) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const getApiKeys = () =>
  (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

const getPositiveLimit = (value, fallback) => {
  const limit = Number.parseInt(value, 10);
  return Number.isFinite(limit) && limit > 0 ? limit : fallback;
};

const getLimits = () => ({
  rpm: getPositiveLimit(process.env.GEMINI_LIMIT_RPM, DEFAULT_LIMIT_RPM),
  rpd: getPositiveLimit(process.env.GEMINI_LIMIT_RPD, DEFAULT_LIMIT_RPD),
});

const buildResponse = ({
  success,
  modelName,
  keyIndexUsed = null,
  attempts = 0,
  text = "",
  json = null,
  rawResponse = null,
  error = null,
}) => ({
  success,
  data: { text, json, rawResponse },
  meta: { modelName, keyIndexUsed, attempts },
  error,
});

const errorMessage = (error) =>
  error instanceof Error ? error.message : String(error?.message || error);

// Phân loại lỗi Rate Limit / Tải cao để Retry
const isRetryableError = (error) => {
  const status = error?.status || error?.statusCode || error?.response?.status;
  const message = errorMessage(error).toLowerCase();
  return (
    status === 429 ||
    status === 503 ||
    message.includes("429") ||
    message.includes("quota exceeded") ||
    message.includes("resource exhausted") ||
    message.includes("503") ||
    message.includes("service unavailable")
  );
};

// Phân loại lỗi Key bị Khóa / Không hợp lệ để Block vĩnh viễn
const isKeyBlockedError = (error) => {
  const status = error?.status || error?.statusCode || error?.response?.status;
  const message = errorMessage(error).toLowerCase();
  return (
    status === 403 ||
    status === 400 ||
    message.includes("403") ||
    message.includes("api key not valid") ||
    message.includes("api_key_invalid") ||
    message.includes("permission_denied")
  );
};

const refreshQuotaState = (state) => {
  const now = new Date();
  const updatedMinute = new Date(state.updated_minute_at);
  const updatedDay = new Date(state.updated_day_at);
  let minuteCount = state.minute_count;
  let dayCount = state.day_count;
  let updatedMinuteAt = state.updated_minute_at;
  let updatedDayAt = state.updated_day_at;

  if (now - updatedMinute >= MINUTE_WINDOW_MS) {
    minuteCount = 0;
    updatedMinuteAt = now.toISOString();
  }

  if (
    now - updatedDay >= DAY_WINDOW_MS ||
    now.getUTCDate() !== updatedDay.getUTCDate() ||
    now.getUTCMonth() !== updatedDay.getUTCMonth() ||
    now.getUTCFullYear() !== updatedDay.getUTCFullYear()
  ) {
    dayCount = 0;
    updatedDayAt = now.toISOString();
  }

  return {
    ...state,
    minute_count: minuteCount,
    day_count: dayCount,
    updated_minute_at: updatedMinuteAt,
    updated_day_at: updatedDayAt,
  };
};

const getAvailableApiKey = async (modelName, excludedIndices, apiKeys) => {
  if (!apiKeys.length) {
    throw new Error("Không tìm thấy GEMINI_API_KEYS hoặc GEMINI_API_KEY trong .env");
  }

  const { data: states, error } = await supabase
    .from("api_key_states")
    .select("*")
    .eq("model_name", modelName);

  if (error) {
    throw new Error(`Không thể đọc trạng thái API key: ${error.message}`);
  }

  const stateMap = new Map((states || []).map((state) => [state.key_index, state]));
  const now = new Date().toISOString();
  const { rpm, rpd } = getLimits();

  for (let index = 0; index < apiKeys.length; index += 1) {
    if (excludedIndices.has(index)) continue;

    const state = stateMap.get(index) || {
      key_index: index,
      model_name: modelName,
      minute_count: 0,
      day_count: 0,
      updated_minute_at: now,
      updated_day_at: now,
      is_blocked: false,
    };
    const currentState = refreshQuotaState(state);

    if (
      !currentState.is_blocked &&
      currentState.minute_count < rpm &&
      currentState.day_count < rpd
    ) {
      return { apiKey: apiKeys[index], keyIndex: index, state: currentState };
    }
  }

  throw new Error(`Tất cả API keys đã chạm quota của model ${modelName}`);
};

const upsertKeyState = async (state) => {
  const { error } = await supabase.from("api_key_states").upsert(state, {
    onConflict: "key_index,model_name",
  });

  if (error) {
    console.error(`❌ Lỗi Upsert Key State: ${error.message}`);
  }
};

const recordKeyUsage = async (keyInfo, modelName) => {
  await upsertKeyState({
    key_index: keyInfo.keyIndex,
    model_name: modelName,
    minute_count: keyInfo.state.minute_count + 1,
    day_count: keyInfo.state.day_count + 1,
    updated_minute_at: keyInfo.state.updated_minute_at,
    updated_day_at: keyInfo.state.updated_day_at,
    is_blocked: false,
  });
};

const markKeyQuotaExceeded = async (keyInfo, modelName) => {
  const { rpm, rpd } = getLimits();
  await upsertKeyState({
    key_index: keyInfo.keyIndex,
    model_name: modelName,
    minute_count: rpm,
    day_count: rpd,
    updated_minute_at: keyInfo.state.updated_minute_at,
    updated_day_at: keyInfo.state.updated_day_at,
    is_blocked: false,
  });
};

// Cưỡng chế khóa vĩnh viễn Key hỏng/bị cấm
const markKeyBlocked = async (keyInfo, modelName) => {
  await upsertKeyState({
    key_index: keyInfo.keyIndex,
    model_name: modelName,
    minute_count: keyInfo.state.minute_count,
    day_count: keyInfo.state.day_count,
    updated_minute_at: keyInfo.state.updated_minute_at,
    updated_day_at: keyInfo.state.updated_day_at,
    is_blocked: true,
  });
};

const generateWithKey = async ({
  apiKey,
  modelName,
  contents,
  config,
  systemInstruction,
}) => {
  const generativeAI = new GoogleGenerativeAI(apiKey);
  const modelOptions = { model: modelName };
  if (config && Object.keys(config).length) {
    modelOptions.generationConfig = config;
  }
  if (systemInstruction) {
    modelOptions.systemInstruction = systemInstruction;
  }

  const model = generativeAI.getGenerativeModel(modelOptions);
  if (typeof contents === "string") {
    return model.generateContent(contents);
  }

  if (
    !Array.isArray(contents) &&
    contents &&
    typeof contents === "object" &&
    Array.isArray(contents.contents)
  ) {
    return model.generateContent(contents);
  }

  return model.generateContent({
    contents: Array.isArray(contents) ? contents : [contents],
  });
};

// Parse JSON thông minh (loại bỏ Markdown ```json ... ```)
const parseJson = (text) => {
  if (!text) return null;
  try {
    const cleanedText = text.replace(/```json\n?|```/g, "").trim();
    const parsed = JSON.parse(cleanedText);
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

export const generateGeminiContent = async ({
  modelName,
  contents,
  config = {},
  systemInstruction,
} = {}) => {
  if (
    typeof modelName !== "string" ||
    !modelName.trim() ||
    (typeof contents !== "string" &&
      !Array.isArray(contents) &&
      (typeof contents !== "object" || contents === null))
  ) {
    return buildResponse({
      success: false,
      modelName: typeof modelName === "string" ? modelName : "",
      error: {
        code: "UNKNOWN_ERROR",
        message: "modelName và contents là các tham số bắt buộc hợp lệ",
      },
    });
  }

  const normalizedModelName = modelName.trim();
  const apiKeys = getApiKeys();
  const excludedIndices = new Set();
  let attempts = 0;
  let lastRetryableError = null;

  while (excludedIndices.size < apiKeys.length) {
    let keyInfo;
    try {
      keyInfo = await getAvailableApiKey(
        normalizedModelName,
        excludedIndices,
        apiKeys
      );
    } catch (error) {
      const exhausted =
        !apiKeys.length ||
        excludedIndices.size >= apiKeys.length ||
        errorMessage(error).startsWith("Tất cả API keys đã chạm quota");
      return buildResponse({
        success: false,
        modelName: normalizedModelName,
        attempts,
        error: {
          code: exhausted ? "ALL_KEYS_EXHAUSTED" : "UNKNOWN_ERROR",
          message: lastRetryableError
            ? `${errorMessage(error)}. Lỗi cuối: ${errorMessage(lastRetryableError)}`
            : errorMessage(error),
        },
      });
    }

    try {
      // Delay ngẫu nhiên nhẹ nếu đây là lần retry
      if (attempts > 0) {
        await sleep(getRandomJitter(150, 350));
      }

      const result = await generateWithKey({
        apiKey: keyInfo.apiKey,
        modelName: normalizedModelName,
        contents,
        config,
        systemInstruction,
      });
      await recordKeyUsage(keyInfo, normalizedModelName);

      const rawResponse = result?.response ?? result;
      const text = rawResponse?.text?.() ?? "";
      return buildResponse({
        success: true,
        modelName: normalizedModelName,
        keyIndexUsed: keyInfo.keyIndex,
        attempts,
        text,
        json: parseJson(text),
        rawResponse,
      });
    } catch (error) {
      attempts += 1;
      excludedIndices.add(keyInfo.keyIndex);

      // Trầm trọng 1: Key bị khóa / Invalid -> Đánh dấu is_blocked = true
      if (isKeyBlockedError(error)) {
        console.warn(`🔒 Key #${keyInfo.keyIndex} bị khóa hoặc invalid. Đang block vĩnh viễn...`);
        await markKeyBlocked(keyInfo, normalizedModelName);
        continue;
      }

      // Trầm trọng 2: Lỗi 429/503 -> Đánh dấu kịch trần Quota & Chuyển Key
      if (isRetryableError(error)) {
        lastRetryableError = error;
        await markKeyQuotaExceeded(keyInfo, normalizedModelName);
        continue;
      }

      // Lỗi logic / Prompt sai định dạng -> Ngắt ngay lập tức
      return buildResponse({
        success: false,
        modelName: normalizedModelName,
        keyIndexUsed: keyInfo.keyIndex,
        attempts,
        error: { code: "UNKNOWN_ERROR", message: errorMessage(error) },
      });
    }
  }

  return buildResponse({
    success: false,
    modelName: normalizedModelName,
    attempts,
    error: {
      code: "ALL_KEYS_EXHAUSTED",
      message: `Không có API key khả dụng cho model ${normalizedModelName}. Lỗi cuối: ${errorMessage(lastRetryableError)}`,
    },
  });
};

export default generateGeminiContent;