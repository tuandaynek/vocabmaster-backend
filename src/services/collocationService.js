import { supabase } from "../lib/supabase.js";
import { buildSrsUpdatePayload, calculateNextReview } from "../utils/srs.js";
import { callGroqWithFallback } from "../lib/groq.js";
import { generateGeminiContent } from "./geminiService.js";
import { grantUserXp, XP_RULES } from "../utils/xpCalculation.js";

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
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
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
    `Không thể xử lý yêu cầu Gemini: ${lastError?.message || "Unknown error"}`,
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
        source_skill: "COLLOCATION",
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

export const getCollocationVariationsService = async (
  collocationId,
  userId,
) => {
  if (!collocationId) {
    throw new Error("Missing collocationId");
  }

  // 1. Lấy thông tin Collocation từ DB
  const { data: collocation, error: colError } = await supabase
    .from("global_collocations")
    .select("id, phrase, meaning, base_sentence, drill_variations")
    .eq("id", collocationId)
    .single();

  if (colError || !collocation) {
    throw new Error(
      colError?.message || "Không tìm thấy collocation trong database!",
    );
  }

  // 2. Lấy tiến trình học (step) của user
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

  // 3. Phân luồng Active Recall vs Passive Drill

  // LUỒNG ACTIVE (Từ lần học thứ 2 trở đi: step >= 1)
  if (userStep >= 1) {
    return {
      mode: "ACTIVE",
      step: userStep,
      collocation: {
        id: collocation.id,
        phrase: collocation.phrase,
        meaning: collocation.meaning,
        baseSentence: collocation.base_sentence,
      },
      // Có thể mở rộng trả về gợi ý/chủ đề đặt câu
      instructions:
        userStep === 1
          ? "Hãy đặt 1 câu đơn hoặc câu ghép tự nhiên chứa cụm từ này."
          : "Hãy viết một đoạn văn ngắn (2-3 câu) hoặc kết hợp cụm từ này vào ngữ cảnh IELTS Speaking.",
    };
  }

  // LUỒNG PASSIVE DRILL (Lần đầu gặp: step === 0)
  let variations = Array.isArray(collocation.drill_variations)
    ? collocation.drill_variations
    : [];

  // Nếu DB chưa có câu variation nào, generate 1 LẦN DUY NHẤT và lưu cứng lại vào DB
  if (variations.length === 0) {
    try {
      const systemInstruction =
        "Bạn là một chuyên gia thiết kế bài tập IELTS Speaking & Collocation. Hãy tạo ra các câu biến thể tự nhiên, đúng ngữ pháp và trả về định dạng JSON chính xác.";

      const prompt = `
Given the base sentence: "${collocation.base_sentence || ""}"
and target collocation phrase: "${collocation.phrase || ""}"

Generate 3 gentle progressive sentence variations for a student to practice speaking.
Rules:
1. Every variation MUST include the exact phrase "${collocation.phrase}".
2. Keep vocabulary natural, simple, and accessible for everyday conversation (IELTS 5.5 - 6.5).
3. Explanation notes MUST be written in Vietnamese (e.g. "Thay 'products' ➔ 'goods'").
4. Variation 1: Synonym swap (replace 1-2 words).
5. Variation 2: Structure shift (e.g. change subject/sentence pattern).
6. Variation 3: Gentle upgrade from Variation 2 for IELTS Speaking. Add a natural speaking starter (e.g., "Honestly...", "In my opinion...", "Actually...") or slightly refine the vocabulary, BUT keep the tone spoken, natural, and friendly.

Return JSON matching the schema with exactly 3 items. Assign IDs 1, 2, 3.
`.trim();

      const newGeneratedVars = await callGeminiWithFallback({
        contents: prompt,
        systemInstruction,
        schema: variationsSchema,
      });

      if (Array.isArray(newGeneratedVars) && newGeneratedVars.length > 0) {
        variations = newGeneratedVars;
        // Lưu cố định vào database
        await supabase
          .from("global_collocations")
          .update({ drill_variations: variations })
          .eq("id", collocationId);
      }
    } catch (aiError) {
      console.warn(
        "Lỗi khi generate câu bằng Gemini cho lần đầu:",
        aiError.message,
      );
    }
  }

  return {
    mode: "DRILL",
    step: 0,
    variations: variations.slice(0, 3),
  };
};

export const completeReviewService = async ({
  collocationId,
  userId,
  rating = "good",
}) => {
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
    throw new Error(
      fetchError?.message ||
        "Không tìm thấy từ vựng này trong danh sách của user!",
    );
  }

  // 2. Tính toán SRS mới
  const srsUpdate = buildSrsUpdatePayload(
    calculateNextReview({
      rating,
      currentStep: record.step,
      currentInterval: record.interval,
      easeFactor: record.ease_factor,
    }),
  );

  // 3. Cập nhật lại bản ghi trong Database
  const { data: updatedData, error: updateError } = await supabase
    .from("user_vocabularies")
    .update({
      ...srsUpdate,
      step: record.step + 1,
      status: "learning",
    })
    .eq("id", record.id)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Lỗi cập nhật SRS: ${updateError.message}`);
  }

  // 4. Tính toán XP dựa trên quy tắc chung
  const xpEarned =
    XP_RULES.COLLOCATION_REVIEW[rating] || XP_RULES.COLLOCATION_REVIEW.good;

  // 5. Gọi helper cộng XP & Streak
  const reward = await grantUserXp({
    userId,
    xpEarned,
    collocationsLearned: 1,
  });

  return {
    ...updatedData,
    reward,
  };
};

// ============================================================================
// ==================== ACTIVE RECALL PHASES (1, 2, 3) ========================
// ============================================================================

export const getPhase1TranslationService = async ({
  collocationId,
  userId,
}) => {
  if (!collocationId) throw new Error("Missing collocationId");

  // 1. Lấy thông tin cụm từ bao gồm cả cột cached phase1_translation
  const { data: collocation, error: colError } = await supabase
    .from("global_collocations")
    .select("id, phrase, meaning, base_sentence, phase1_translation")
    .eq("id", collocationId)
    .single();

  if (colError || !collocation) {
    throw new Error(
      colError?.message || "Không tìm thấy collocation trong database!",
    );
  }

  // 2. Nếu đã có cache dữ liệu trong Database thì trả về luôn (không tốn quota)
  if (
    collocation.phase1_translation &&
    typeof collocation.phase1_translation === "object" &&
    collocation.phase1_translation.vi_sentence
  ) {
    return collocation.phase1_translation;
  }

  // 3. Nếu chưa có cache, gọi Groq để tạo bài tập dịch
  const systemInstruction = `Bạn là một giáo viên tiếng Anh chuyên nghiệp. Nhiệm vụ của bạn là tạo ra một bài tập dịch thuật (từ tiếng Việt sang tiếng Anh) nhằm giúp học viên luyện tập cụm từ mục tiêu. Bạn LUÔN LUÔN chỉ trả về một định dạng JSON duy nhất.`;

  const prompt = `
Target collocation: "${collocation.phrase}"
Meaning: "${collocation.meaning}"
Context/Base sentence: "${collocation.base_sentence || ""}"

Hãy tạo ra một câu tiếng Việt hoàn toàn mới (vi_sentence), mang tính ứng dụng thực tế. Câu này khi dịch sang tiếng Anh phải SỬ DỤNG CHÍNH XÁC cụm từ "${collocation.phrase}".

Trả về JSON theo cấu trúc sau:
{
  "vi_sentence": "Câu tiếng Việt cần dịch",
  "accepted_answer": "Đáp án tiếng Anh gợi ý tự nhiên nhất",
  "suggested_vocab": [
    {
      "word": "từ vựng gợi ý bằng tiếng anh 1",
      "meaning": "giải nghĩa tiếng Việt"
    }
  ]
}
- suggested_vocab: Cung cấp toàn bộ từ vựng gợi ý cốt lõi (bằng tiếng Anh) (ngoài cụm từ mục tiêu) giúp học viên dễ dịch hơn. Giải nghĩa tiếng Việt ngắn gọn.
  `.trim();

  const aiResult = await callGroqWithFallback({
    prompt,
    systemInstruction,
    temperature: 0.3,
  });

  // 4. Lưu kết quả vừa tạo vào cột phase1_translation để dùng lại lần sau
  if (aiResult && aiResult.vi_sentence) {
    const { error: updateError } = await supabase
      .from("global_collocations")
      .update({ phase1_translation: aiResult })
      .eq("id", collocationId);

    if (updateError) {
      console.warn(
        "Lỗi khi cache phase1_translation vào Database:",
        updateError.message,
      );
    }
  }

  return aiResult;
};

// ----------------------------------------------------------------------------

export const evaluatePhase2CollocationService = async ({
  collocationId,
  userSentence,
  userId,
}) => {
  if (!collocationId || !userSentence) {
    throw new Error("Missing collocationId or userSentence");
  }

  const { data: collocation, error: colError } = await supabase
    .from("global_collocations")
    .select("phrase, meaning")
    .eq("id", collocationId)
    .single();

  if (colError || !collocation) {
    throw new Error("Không tìm thấy collocation!");
  }

  const systemInstruction = `Bạn là một giám khảo chấm thi tiếng Anh chuyên nghiệp, khách quan và công bằng.
Nhiệm vụ của bạn là đánh giá câu do học viên tự đặt dựa trên việc sử dụng cụm từ mục tiêu (collocation).
Bạn LUÔN LUÔN chỉ trả về một định dạng JSON duy nhất, không kèm thêm bất kỳ văn bản dẫn dắt nào.`;

const prompt = `
Target collocation: "${collocation.phrase}" (Nghĩa: ${collocation.meaning})
User's sentence: "${userSentence}"

CÁC QUY TẮC ĐÁNH GIÁ (TUÂN THỦ TỰ ĐỘNG KHÁCH QUAN):

1. TRẠNG THÁI (state):
   - "Not completed": KHÔNG sử dụng cụm từ mục tiêu, hoặc câu bị sai ngữ pháp nghiêm trọng dẫn đến mất nghĩa hoàn toàn.
   - "Good": Có dùng cụm từ mục tiêu và hiểu được ý, nhưng mắc LỖI NGỮ PHÁP RÕ RÀNG hoặc diễn đạt đậm chất gượng gạo / Vietlish.
   - "Excellent": Dùng đúng cụm từ mục tiêu, ngữ pháp chuẩn xác và diễn đạt tự nhiên như người bản xứ.

   * NGUYÊN TẮC QUAN TRỌNG ĐỂ TRÁNH CHẤM SAI:
     - CHẤP NHẬN biến thể chia thì, chia ngôi, dạng V-ing / To-V của cụm từ mục tiêu (Ví dụ: với "cut down on", các dạng "cutting down on", "has cut down on" đều HOÀN TOÀN HỢP LỆ).
     - Nếu câu của học viên ĐÚNG NGỮ PHÁP và DIỄN ĐẠT TỰ NHIÊN, BẮT BUỘC phải cho "Excellent" (dù là câu ngắn hay câu đơn giản). KHÔNG ĐƯỢC ép học viên phải viết câu dài / từ vựng phức tạp mới cho Excellent.

2. PHẢN HỒI (feedback):
   - Trả về 1-2 câu nhận xét bằng tiếng Việt.
   - Nếu "Excellent": Khen ngợi điểm làm tốt.
   - Nếu "Good" hoặc "Not completed": Chỉ rõ lỗi sai cụ thể (sai thì, dùng sai giới từ, gượng gạo ở đâu) để học viên sửa.

3. CÂU GỢI Ý (correctedSentence):
   - Nếu state là "Good" hoặc "Not completed": Trả về câu đã sửa chuẩn tự nhiên, giữ nguyên ý đồ của học viên.
   - Nếu state là "Excellent": Trả về null (hoặc chính câu của học viên).

CẤU TRÚC JSON ĐẦU RA:
{
  "state": "Not completed" | "Good" | "Excellent",
  "feedback": "Nhận xét tiếng Việt ngắn gọn (1-2 câu)",
  "correctedSentence": "Câu gợi ý chuẩn bản xứ" | null
}
`.trim();

  const aiResult = await callGroqWithFallback({
    prompt,
    systemInstruction,
    temperature: 0.2,
  });

  if (aiResult && aiResult.state === "Excellent") {
    // 1. Lấy dữ liệu mảng hiện tại
    const { data, error: fetchError } = await supabase
      .from("global_collocations")
      .select("community_sentences")
      .eq("id", collocationId)
      .single();

    if (fetchError) {
      console.error("Lỗi khi lấy dữ liệu:", fetchError);
      return;
    }

    // 2. Thêm userSentence vào mảng hiện tại (nếu null thì khởi tạo mảng mới)
    const currentSentences = data.community_sentences || [];
    const updatedSentences = [...currentSentences, userSentence].slice(-5); // Giữ lại tối đa 5 câu gần nhất

    // 3. Cập nhật mảng mới lên Supabase
    const { error: updateError } = await supabase
      .from("global_collocations")
      .update({ community_sentences: updatedSentences })
      .eq("id", collocationId);

    if (updateError) {
      console.error("Lỗi khi cập nhật community_sentences:", updateError);
    }

    aiResult.communitySentences = updatedSentences; // Trả về mảng sentences mới nhất cho client
  }

  return aiResult;
};

// ----------------------------------------------------------------------------

export const evaluatePhase3CollocationService = async ({
  collocationId,
  userStory,
  userId,
}) => {
  if (!collocationId || !userStory) {
    throw new Error("Missing collocationId or userStory");
  }

  const { data: collocation, error: colError } = await supabase
    .from("global_collocations")
    .select("phrase")
    .eq("id", collocationId)
    .single();

  if (colError || !collocation) {
    throw new Error("Không tìm thấy collocation!");
  }

  const systemInstruction = `Bạn là một cựu giám khảo IELTS Speaking/Writing chuyên nghiệp, khách quan và chính xác.
Nhiệm vụ của bạn là đánh giá đoạn văn của học viên. Bạn LUÔN LUÔN trả về định dạng JSON duy nhất, không thêm bất kỳ văn bản dẫn dắt nào ngoài JSON.`;

const prompt = `
Target collocation: "${collocation.phrase}"
User's story: "${userStory}"

CÁC QUY TẮC ĐÁNH GIÁ (BẮT BUỘC TUÂN THỦ STRICTLY):

1. THANG ĐIỂM & TRẠNG THÁI (state):
   - Score < 70: "Not completed" (isPassed: false)
   - Score 70 - 89: "Good" (isPassed: true) -> Bài viết có lỗi ngữ pháp nhỏ, dùng từ chưa thực sự tự nhiên nhưng hiểu được.
   - Score 90 - 100: "Excellent" (isPassed: true) -> Bài viết chuẩn ngữ pháp, tự nhiên, sử dụng cụm từ mục tiêu mượt mà.
   * LƯU Ý ĐẶC BIỆT: Nếu đoạn văn KHÔNG CÓ LỖI NGỮ PHÁP RÕ RÀNG và diễn đạt tự nhiên, BẮT BUỘC phải cho Score >= 90 và state = "Excellent". Không được tự hạ điểm xuống "Good" nếu người dùng viết đúng.

2. QUY TẮC XỬ LÝ LỖI (highlightedErrors):
   - CHỈ liệt kê vào "highlightedErrors" các lỗi SAI NGỮ PHÁP thực sự, sai ngữ cảnh, hoặc dùng sai cụm từ mục tiêu.
   - TUYỆT ĐỐI KHÔNG coi các văn phong tương đương (ví dụ: Quá khứ đơn vs Hiện tại hoàn thành, "helps me" vs "has helped me", "To achieve this" vs "To achieve this goal") là LỖI SAI.
   - Nếu bài viết của user đã đúng ngữ pháp và tự nhiên, mảng "highlightedErrors" BẮT BUỘC phải là mảng rỗng [] và score phải >= 90.

3. QUY TẮC VIẾT LẠI (correctedStory):
   - Phải sử dụng chính xác cụm từ "${collocation.phrase}".
   - Giữ nguyên ý nghĩa gốc và số lượng câu của bài gốc (khuyến khích đúng 3 câu).
   - Nếu bài của user đã đạt "Excellent" (score >= 90), correctedStory có thể giữ nguyên hoặc chỉ tinh chỉnh cực kỳ nhẹ nhàng.

YÊU CẦU ĐẦU RA (JSON format):
{
  "state": "Not completed" | "Good" | "Excellent",
  "score": number,
  "isPassed": boolean,
  "feedback": "Nhận xét tổng quan bằng tiếng Việt (ngắn gọn, tập trung vào ưu điểm và điểm cần cải thiện nếu có)",
  "correctedStory": "Đoạn văn hoàn chỉnh đã nâng cấp/sửa lỗi",
  "highlightedErrors": [
    {
      "error": "cụm từ sai thực sự trong bài user",
      "correction": "sửa lại cho đúng"
    }
  ]
}
`.trim();

  const aiResult = await callGroqWithFallback({
    prompt,
    systemInstruction,
    temperature: 0.2,
  });

  if (aiResult && aiResult.state === "Excellent") {
    // 1. Lấy dữ liệu mảng hiện tại
    const { data, error: fetchError } = await supabase
      .from("global_collocations")
      .select("community_stories")
      .eq("id", collocationId)
      .single();

    if (fetchError) {
      console.error("Lỗi khi lấy dữ liệu:", fetchError);
      return;
    }

    // 2. Thêm userStory vào mảng hiện tại (nếu null thì khởi tạo mảng mới)
    const currentStories = data.community_stories || [];
    const updatedStories = [...currentStories, userStory].slice(-5); // Giữ lại tối đa 5 câu gần nhất

    // 3. Cập nhật mảng mới lên Supabase
    const { error: updateError } = await supabase
      .from("global_collocations")
      .update({ community_stories: updatedStories })
      .eq("id", collocationId);

    if (updateError) {
      console.error("Lỗi khi cập nhật community_stories:", updateError);
    }

    aiResult.communityStories = updatedStories; // Trả về mảng stories mới nhất cho client

  }

  return aiResult;
};
