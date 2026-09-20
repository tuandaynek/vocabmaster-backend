import { supabase } from "../lib/supabase.js";
import { ensureAudioUrl } from "./audioService.js";
import { buildSrsUpdatePayload, calculateNextReview } from "../utils/srs.js";
import { generateGeminiContent } from "./geminiService.js";


const COLLOCATION_SELECT = `
  id,
  user_id,
  collocation_id,
  context_sentence,
  status,
  step,
  interval,
  ease_factor,
  next_review,
  created_at,
  global_collocations (
    id,
    phrase,
    meaning,
    type,
    topic,
    cefr_level,
    pattern,
    base_sentence,
    audio_url,
    drill_variations,
    created_at
  )
`;

const MODEL_CANDIDATES = [
  ...(process.env.GEMINI_MODEL || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean),
  "gemini-3.5-flash",
  "gemini-3.6-flash",
];

const callGeminiWithFallback = async ({
  contents,
  systemInstruction,
  schema,
}) => {
  let lastError = null;

  for (const modelName of [...new Set(MODEL_CANDIDATES)]) {
    const response = await generateGeminiContent({
      modelName,
      contents,
      systemInstruction,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.2,
      },
    });

    if (response.success) {
      if (response.data.json) return response.data.json;
      try {
        return JSON.parse(response.data.text);
      } catch (error) {
        lastError = new Error(
          `Gemini trả về JSON không hợp lệ: ${error.message}`,
        );
        continue;
      }
    }

    lastError = new Error(response.error?.message || "Gemini request failed");
  }

  throw new Error(
    `Không thể xử lý yêu cầu Writing bằng Gemini: ${lastError?.message || "Unknown error"}`,
  );
};

export const fetchGlobalCollocations = async ({
  search = "",
  type = "all",
  topic = "all",
  cefr = "all",
  page = 1,
  limit = 9,
} = {}) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Math.min(Number(limit) || 9, 50));
  const offset = (pageNum - 1) * limitNum;

  let query = supabase
    .from("global_collocations")
    .select("*", { count: "exact" });

  if (search && search.trim()) {
    const cleanSearch = search.trim();
    query = query.or(
      `phrase.ilike.%${cleanSearch}%,meaning.ilike.%${cleanSearch}%`,
    );
  }

  if (type && type !== "all") {
    query = query.eq("type", type);
  }

  if (topic && topic !== "all") {
    query = query.eq("topic", topic);
  }

  if (cefr && cefr !== "all") {
    query = query.eq("cefr_level", cefr);
  }

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limitNum - 1);

  if (error) {
    throw new Error(`Database Error (Collocations): ${error.message}`);
  }

  const total = count || 0;

  return {
    data: data || [],
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    },
  };
};

export const saveCollocationsList = async ({
  selectedCollocations = [],
  userId,
}) => {
  if (!userId) {
    throw new Error("Unauthorized: Thiếu user_id hợp lệ từ token xác thực");
  }

  if (!Array.isArray(selectedCollocations) || !selectedCollocations.length) {
    throw new Error("Invalid payload: Missing selectedCollocations or userId");
  }

  const savedItems = [];

  for (const item of selectedCollocations) {
    const collocationId = item.collocation_id || item.id;
    if (!collocationId) continue;

    const { data: existing, error: existingError } = await supabase
      .from("user_vocabularies")
      .select("id")
      .eq("user_id", userId)
      .eq("collocation_id", collocationId)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existing) {
      savedItems.push(existing);
      continue;
    }

    const { data: colData, error: colError } = await supabase
      .from("global_collocations")
      .select("base_sentence, phrase")
      .eq("id", collocationId)
      .single();

    if (colError || !colData) {
      throw new Error(colError?.message || "Collocation not found");
    }

    const { data: inserted, error } = await supabase
      .from("user_vocabularies")
      .insert({
        user_id: userId,
        collocation_id: collocationId,
        context_sentence: colData.base_sentence || colData.phrase || "",
        status: "learning",
        step: 0,
        interval: 1.0,
        ease_factor: 2.5,
        next_review: new Date().toISOString(),
        source_skill: "COLLOCATION"
      })
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    savedItems.push(inserted);
  }

  return {
    savedCount: savedItems.length,
    savedItems,
  };
};

export const bulkInsertCollocations = async (collocationsArray) => {
  if (!Array.isArray(collocationsArray) || collocationsArray.length === 0) {
    throw new Error("Dữ liệu nhập vào phải là một mảng collocations hợp lệ.");
  }

  const validItems = collocationsArray.filter(
    (item) => item?.phrase && item?.meaning,
  );
  if (validItems.length === 0) {
    throw new Error("Không có bản ghi nào hợp lệ (thiếu phrase hoặc meaning).");
  }

  const formattedData = [];
  for (const item of validItems) {
    const cleanPhrase = String(item.phrase || "").trim();
    let audioUrl = "";

    try {
      audioUrl = await ensureAudioUrl(cleanPhrase, {
        table: "global_collocations",
        targetField: "phrase",
      });
    } catch (err) {
      console.warn(`Lỗi tạo audio cho cụm "${cleanPhrase}":`, err.message);
    }

    formattedData.push({
      phrase: cleanPhrase,
      type: String(item.type || "lexical").trim(),
      meaning: String(item.meaning || "").trim(),
      pattern: String(item.pattern || "").trim(),
      topic: String(item.topic || "General").trim(),
      cefr_level: String(item.cefr_level || "B2")
        .trim()
        .toUpperCase(),
      base_sentence: String(item.base_sentence || "").trim(),
      drill_variations: Array.isArray(item.drill_variations)
        ? item.drill_variations
        : [],
      audio_url: audioUrl,
    });
  }

  const { data, error } = await supabase
    .from("global_collocations")
    .upsert(formattedData, { onConflict: "phrase" })
    .select();

  if (error) {
    throw new Error(`Lỗi khi lưu collocations: ${error.message}`);
  }

  return {
    success: true,
    insertedCount: data?.length || 0,
    data,
  };
};

export const fetchUserCollocationList = async ({ userId }) => {
  if (!userId) {
    throw new Error("Unauthorized: Thiếu user_id hợp lệ từ token xác thực");
  }

  const { data, error } = await supabase
    .from("user_vocabularies")
    .select(COLLOCATION_SELECT)
    .eq("user_id", userId)
    .not("collocation_id", "is", null)
    .order("next_review", { ascending: true });

  if (error) {
    throw new Error(error.message || "Thất bại khi lấy danh sách collocation");
  }

  return data || [];
};

export const fetchDueCollocationCards = async ({ userId, limit = 20 }) => {
  if (!userId) {
    throw new Error("Unauthorized: Thiếu user_id hợp lệ từ token xác thực");
  }

  const nowIso = new Date().toISOString();

  const { data: dueCards, error: dueError } = await supabase
    .from("user_vocabularies")
    .select(COLLOCATION_SELECT)
    .eq("user_id", userId)
    .not("collocation_id", "is", null)
    .lte("next_review", nowIso)
    .neq("status", "mastered")
    .order("next_review", { ascending: true })
    .limit(limit);

  if (dueError) {
    throw new Error(dueError.message || "Thất bại khi lấy collocation đến hạn");
  }

  if ((dueCards || []).length > 0) {
    return dueCards;
  }

  const { data: fallbackCards, error: fallbackError } = await supabase
    .from("user_vocabularies")
    .select(COLLOCATION_SELECT)
    .eq("user_id", userId)
    .not("collocation_id", "is", null)
    .eq("status", "learning")
    .order("next_review", { ascending: true })
    .limit(limit);

  if (fallbackError) {
    throw new Error(
      fallbackError.message || "Thất bại khi lấy collocation ôn tập dự phòng",
    );
  }

  return fallbackCards || [];
};

export const reviewCollocationEntry = async ({
  user_vocab_id,
  rating,
  userId,
}) => {
  if (!user_vocab_id) {
    throw new Error("user_vocab_id là tham số bắt buộc");
  }

  if (!rating || !["again", "hard", "good", "easy"].includes(rating)) {
    throw new Error(
      "Rating không hợp lệ. Các giá trị cho phép: again, hard, good, easy",
    );
  }

  const { data: record, error: fetchError } = await supabase
    .from("user_vocabularies")
    .select("*")
    .eq("id", user_vocab_id)
    .not("collocation_id", "is", null)
    .maybeSingle();

  if (fetchError || !record) {
    throw new Error(
      fetchError?.message || "Không tìm thấy bản ghi ôn tập collocation này",
    );
  }

  if (userId && record.user_id !== userId) {
    throw new Error("Bạn không có quyền ôn tập bản ghi collocation này");
  }

  const srsUpdate = buildSrsUpdatePayload(
    calculateNextReview({
      rating,
      currentStep: record.step,
      currentInterval: record.interval,
      easeFactor: record.ease_factor,
    }),
  );

  const { data, error: updateError } = await supabase
    .from("user_vocabularies")
    .update(srsUpdate)
    .eq("id", user_vocab_id)
    .select(COLLOCATION_SELECT)
    .single();

  if (updateError || !data) {
    throw new Error(updateError?.message || "Cập nhật collocation thất bại");
  }

  return {
    success: true,
    data,
  };
};

export const getPhase1Data = async (collocationId) => {
  // 1. Định nghĩa danh sách các trường cần lấy
  const fields = ["id", "phrase", "meaning", "audio_url", "base_sentence"];

  // 2. Chuyển đổi danh sách trường thành chuỗi query
  const selectQuery = fields.join(", ");

  // 3. Thực hiện truy vấn
  const { data, error } = await supabase
    .from("global_collocations")
    .select(selectQuery)
    .eq("id", collocationId)
    .single();

  if (error || !data) {
    throw new Error("Collocation not found");
  }

  // 4. Định nghĩa hàm để chuyển đổi tên trường từ snake_case sang camelCase (nếu cần)
  const toCamelCase = (str) =>
    str.replace(/_([a-z])/g, (g) => g[1].toUpperCase());

  // 5. Gom gọn kết quả trả về bằng cách duyệt qua các trường
  const responseData = {};
  fields.forEach((field) => {
    // Chuyển 'id' thành 'collocationId', còn lại giữ nguyên hoặc camelCase
    const key = field === "id" ? "collocationId" : toCamelCase(field);
    responseData[key] = data[field];
  });

  return responseData;
};

export const getNextCollocation = async () => {
  const { data, error } = await supabase
    .from("global_collocations")
    .select("id, phrase, meaning, audio_url, base_sentence")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
};

// Định nghĩa schema cho Gemini sinh đúng mảng 3 variations
const variationsSchema = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: { type: "NUMBER" },
      type: { type: "STRING" },
      sentence: { type: "STRING" },
      note: { type: "STRING" },
    },
    required: ["id", "type", "sentence", "note"],
  },
};

export const getCollocationVariationsService = async (collocationId, userId) => {
  if (!collocationId) {
    throw new Error("Missing collocationId");
  }

  // 1. Lấy thông tin Collocation & drill_variations từ bảng 'global_collocations'
  const { data: collocation, error: colError } = await supabase
    .from("global_collocations")
    .select("base_sentence, phrase, drill_variations")
    .eq("id", collocationId)
    .single();

  if (colError || !collocation) {
    throw new Error(colError?.message || "Không tìm thấy collocation trong database!");
  }

  const baseSentence = collocation.base_sentence || "";
  const phrase = collocation.phrase || "";
  let currentVariations = Array.isArray(collocation.drill_variations)
    ? collocation.drill_variations
    : [];

  // 2. Lấy trạng thái `step` của user từ bảng user_vocabularies
  let userStep = 0;
  if (userId) {
    const { data: userVocab } = await supabase
      .from("user_vocabularies")
      .select("step")
      .eq("user_id", userId)
      .eq("collocation_id", collocationId)
      .maybeSingle();

    if (userVocab && typeof userVocab.step === "number") {
      userStep = userVocab.step;
    }
  }

  // 3. Kiểm tra điều kiện gọi AI:
  // len(drill_variations) <( userStep * 3)  AND  len(drill_variations) < 9
  // userStep++ vì mặc định đang là 0
  userStep++;
  const canGenerateWithAI =
    currentVariations.length < (userStep * 3) && currentVariations.length < 9;

  if (canGenerateWithAI) {
    try {
      const systemInstruction =
        "Bạn là một chuyên gia thiết kế bài tập IELTS Speaking & Collocation. Hãy tạo ra các câu biến thể tự nhiên, đúng ngữ pháp và trả về định dạng JSON chính xác.";

      const prompt = `
Given the base sentence: "${baseSentence}"
and target collocation phrase: "${phrase}"

Generate 3 gentle progressive sentence variations for a student to practice speaking.
Rules:
1. Every variation MUST include the exact phrase "${phrase}".
2. Keep vocabulary natural, simple, and accessible for everyday conversation (IELTS 5.5 - 6.5).
3. Explanation notes MUST be written in Vietnamese (e.g. "Thay 'products' ➔ 'goods'").
4. Variation 1: Synonym swap (replace 1-2 words).
5. Variation 2: Structure shift (e.g. change subject/sentence pattern).
6. Variation 3: Gentle upgrade from Variation 2 for IELTS Speaking. Add a natural speaking starter (e.g., "Honestly...", "In my opinion...", "Actually...") or slightly refine the vocabulary (e.g. 'minimal packaging'), BUT keep the tone spoken, natural, and friendly. DO NOT use formal IELTS Writing academic phrases like "As conscious consumers" or "It is imperative that".

Return JSON matching the schema with exactly 3 items. Assign IDs sequentially starting from ${currentVariations.length + 1}.
`.trim();

      // Gọi Gemini bằng helper của bro
      const newGeneratedVars = await callGeminiWithFallback({
        contents: prompt,
        systemInstruction,
        schema: variationsSchema,
      });

      if (Array.isArray(newGeneratedVars) && newGeneratedVars.length > 0) {
        // Append 3 câu mới vào danh sách hiện tại (giới hạn cứng tối đa 9 phần tử)
        const updatedVariations = [...currentVariations, ...newGeneratedVars].slice(0, 9);

        // Lưu cập nhật lại vào bảng global_collocations
        await supabase
          .from("global_collocations")
          .update({ drill_variations: updatedVariations })
          .eq("id", collocationId);

        // Trả về đúng 3 câu mới vừa generate
        return newGeneratedVars;
      }
    } catch (aiError) {
      console.warn("Lỗi khi generate câu bằng Gemini, fallback về dữ liệu DB:", aiError.message);
      // Nếu Gemini có sự cố, drop xuống logic trả dữ liệu DB bên dưới
    }
  }

  // 4. Nếu KHÔNG ĐỦ ĐIỀU KIỆN GENERATE (hoặc Gemini lỗi) -> Lấy dữ liệu từ DB
  // Trường hợp A: DB có sẵn đủ câu theo lượt học của user
  if (currentVariations.length >= userStep * 3) {
    return currentVariations.slice(userStep * 3 - 3, userStep * 3);
  }

  // Trường hợp B: Lần học thứ 4+ (userStep đã lớn hoặc DB đã full 9 câu) -> Random 3 câu
  if (currentVariations.length >= 3) {
    const shuffled = [...currentVariations].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 3);
  }

  // Trường hợp C: Dữ liệu dự phòng nếu mảng quá ít câu
  return currentVariations;
};

export const completePhase3Service = async ({ collocationId, userId, rating = "good" }) => {
  if (!collocationId || !userId) {
    throw new Error("Thiếu collocationId hoặc userId!");
  }

  // 1. Tìm bản ghi tương ứng trong user_vocabularies
  const { data: record, error: fetchError } = await supabase
    .from("user_vocabularies")
    .select("id, step, interval, ease_factor")
    .eq("user_id", userId)
    .eq("collocation_id", collocationId)
    .maybeSingle();

  if (fetchError || !record) {
    throw new Error(fetchError?.message || "Không tìm thấy từ vựng này trong danh sách của user!");
  }

  // 2. Tính toán các thông số SRS mới dựa vào thuật toán sẵn có
  const srsUpdate = buildSrsUpdatePayload(
    calculateNextReview({
      rating, // Mặc định 'good' khi hoàn thành xong phase, hoặc client truyền lên (again, hard, good, easy)
      currentStep: record.step,
      currentInterval: record.interval,
      easeFactor: record.ease_factor,
    })
  );

  // 3. Cập nhật lại bản ghi trong Database
  const { data: updatedData, error: updateError } = await supabase
    .from("user_vocabularies")
    .update({
      ...srsUpdate,
      // Tăng step lên +1 để lần sau gọi variations AI sẽ biết user đã tiến lên lượt mới
      step: record.step + 1, 
      status: "learning",
    })
    .eq("id", record.id)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Lỗi cập nhật SRS: ${updateError.message}`);
  }

  return updatedData;
};