// services/vocab/vocabService.js
import { supabase } from "../lib/supabase.js"; // Đã điều chỉnh path phù hợp với folder services/vocab/
import { ensureAudioUrl } from "../utils/audio.js";
import { callGroqWithFallback } from "../lib/groq.js";
import { buildSrsUpdatePayload, calculateNextReview } from "../utils/srs.js";

// ==========================================
// UTILS
// ==========================================

// Helper cắt mảng thành các chunk nhỏ (ví dụ: 5 từ / chunk)
const chunkArray = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

// Helper parse JSON an toàn từ phản hồi của LLM
const parseSafeJSON = (rawResponse) => {
  if (typeof rawResponse !== "string") return rawResponse;
  try {
    const cleanJson = rawResponse
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    return JSON.parse(cleanJson);
  } catch (err) {
    throw new Error(
      `Lỗi parse JSON từ AI: ${err.message}. Dữ liệu thô: ${rawResponse}`,
    );
  }
};

// ==========================================
// 1. EXTRACTOR PHASE (TÌM TỪ VỰNG)
// ==========================================

export const EXTRACTOR_SYSTEM_INSTRUCTION = `Bạn là chuyên gia từ vựng tiếng Anh. Nhiệm vụ của bạn là trích xuất từ vựng từ PASSAGE dựa chính xác vào Tiêu chí (Focus Mode) được yêu cầu.

BẮT BUỘC trả về JSON Object có cấu trúc:
{
  "words": [
    {
      "word": "autonomous",
      "meaning": "tự chủ, độc lập",
      "context_sentence": "and therefore see them as an autonomous threat."
    }
  ]
}

QUY TẮC NGHIÊM NGẶT THEO FOCUS MODE:
- Nếu Focus Mode là "IELTS Academic" hoặc "SAT / GMAT": TỰ ĐỘNG BỎ TẤT CẢ CỤM TỪ (Noun phrases, Collocations). CHỈ ĐƯỢC CHỌN TỪ ĐƠN (Single Words) như: "autonomous", "trigger", "convey", "physiological". TUYỆT ĐỐI CẤM chứa dấu cách (space) trong trường "word"!
- Nếu Focus Mode là "Collocations & Phrasal Verbs": BẮT BUỘC CHỈ chọn cụm từ (2 từ trở lên) như: "stress reaction", "collective fear". TUYỆT ĐỐI CẤM lấy từ đơn.

Cảnh báo: Nếu Focus Mode là "IELTS Academic" mà trả về cụm từ như "bad news" hay "stress reaction" là VI PHẠM YÊU CẦU.`;

const buildExtractorPrompt = ({
  passage,
  limit,
  focusMode,
  mustIncludeWords,
}) => {
  // Tạo rule riêng cho từng mode để truyền trực tiếp vào Prompt
  let modeConstraint = "";
  if (focusMode.includes("Collocations")) {
    modeConstraint = `CHỈ chọn các CỤM TỪ (2 từ trở lên, ví dụ: "stress reaction"). KHÔNG lấy từ đơn.`;
  } else {
    modeConstraint = `CHỈ chọn TỪ ĐƠN HỌC THUẬT (Single Words, ví dụ: "trigger", "convey", "physiological"). TUYỆT ĐỐI CẤM lấy cụm 2-3 từ như "bad news", "stress reaction", "heart rates". Mỗi item trong "word" CHỈ ĐƯỢC LÀ 1 TỪ DUY NHẤT.`;
  }

  return `
YÊU CẦU BẮT BUỘC:
1. SỐ LƯỢNG: Tìm và trích xuất ĐÚNG BẰNG HOẶC ÍT HƠN ${limit} items (Tối thiểu 5, tối đa ${limit}).
2. QUY TẮC FOCUS MODE (${focusMode}): ${modeConstraint}
3. LOẠI BỎ TRÙNG LẶP: Các từ/cụm từ trong "words" phải là Duy Nhất (Unique).

Từ BẮT BUỘC phải có (nếu xuất hiện trong đoạn): ${mustIncludeWords || "Không có"}

PASSAGE:
"${passage}"`;
};

// ==========================================
// 2. ANALYZER PHASE (PHÂN TÍCH CHUYÊN SÂU)
// ==========================================

export const ANALYZER_SYSTEM_INSTRUCTION = `Bạn là chuyên gia ngôn ngữ học. Nhiệm vụ: Phân tích sâu danh sách từ vựng dựa trên WORD và CONTEXT_SENTENCE được cung cấp.

BẮT BUỘC trả về JSON Object có cấu trúc:
{
  "data": [
    {
      "word": "autonomous",
      "slug": "autonomous",
      "meaning": "tự chủ, độc lập",
      "pos": "adjective",
      "ipa": "/ɔːˈtɒn.ə.məs/",
      "prefix_suffix": {
        "prefix": "auto-",
        "prefix_meaning": "tự bản thân",
        "root": "nom",
        "suffix": "-ous",
        "suffix_meaning": "tính từ chỉ đặc tính"
      },
      "word_family": [
        { "word": "autonomy", "pos": "noun", "meaning": "sự tự trị" }
      ],
      "collocations": [
        {
          "phrase": "autonomous threat",
          "type": "adj + n",
          "meaning": "mối đe dọa tự chủ",
          "usage_note": "Thường dùng trong bối cảnh công nghệ, AI"
        }
      ],
      "context_sentence": "and therefore see them as an autonomous threat.",
      "usage_note": "Dùng để mô tả máy móc hoặc hệ thống có khả năng tự hoạt động không cần con người."
    }
  ]
}

QUY TẮC:
1. Kết quả đặt trong key "data". CẤM trả về JSON Array ở cấp ngoài cùng.
2. Nếu có dấu ngoặc kép trong text, đổi thành dấu ngoặc đơn '. CẤM dùng dấu \\" bên trong chuỗi.`;

export const buildAnalyzerPrompt = (extractedItems) => {
  return `Phân tích sâu danh sách từ vựng sau dựa vào context_sentence của từng từ:
${JSON.stringify(extractedItems, null, 2)}`;
};

// ==========================================
// MAIN FUNCTION
// ==========================================

// Helper delay chống dính Rate Limit 429
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const extractVocabWithAI = async ({
  passage,
  limit = 9,
  focusMode = "IELTS Academic",
  mustIncludeWords = [],
}) => {
  const safePassage = typeof passage === "string" ? passage.trim() : "";
  if (!safePassage) throw new Error("Passage is required");

  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 20);
  const requiredWords = Array.isArray(mustIncludeWords)
    ? mustIncludeWords.filter(Boolean).join(", ")
    : "";

  // --------------------------------------------------
  // BƯỚC 1: Gọi AI trích xuất danh sách từ thô (Extractor)
  // --------------------------------------------------
  const extractorPrompt = buildExtractorPrompt({
    passage: safePassage,
    limit: safeLimit,
    focusMode,
    mustIncludeWords: requiredWords,
  });

  const rawExtractedWords = await callGroqWithFallback({
    prompt: extractorPrompt,
    systemInstruction: EXTRACTOR_SYSTEM_INSTRUCTION,
    temperature: 0.1,
  });

  const parsedExtractor = parseSafeJSON(rawExtractedWords);

  let wordList = parsedExtractor?.words || parsedExtractor?.data || [];

  if (!Array.isArray(wordList) || wordList.length === 0) {
    throw new Error("Không tìm thấy từ vựng nào phù hợp với yêu cầu.");
  }

  // Lọc trùng lặp ngay phía JS để đảm bảo an toàn
  const seen = new Set();
  wordList = wordList
    .filter((item) => {
      const w = item?.word?.trim().toLowerCase();
      if (!w || seen.has(w)) return false;
      seen.add(w);
      return true;
    })
    .slice(0, safeLimit);

  // --------------------------------------------------
  // BƯỚC 2: Chia nhỏ danh sách từ (Chunking)
  // --------------------------------------------------
  const chunks = chunkArray(wordList.slice(0, safeLimit), 3);
  const finalResults = [];
  const processedWords = new Set(); // Set theo dõi các từ đã được thêm để chống trùng

  // --------------------------------------------------
  // BƯỚC 3: Gọi AI phân tích sâu từng Chunk (Analyzer)
  // --------------------------------------------------
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Nếu từ chunk thứ 2 trở đi, delay 1 giây để hồi TPM/RPM cho Groq
    if (i > 0) {
      await delay(1000);
    }

    // 🔥 SỬA LỖI 1: Chỉ truyền chunk, KHÔNG truyền safePassage vào đây nữa!
    const analyzerPrompt = buildAnalyzerPrompt(chunk);

    const rawAnalysis = await callGroqWithFallback({
      prompt: analyzerPrompt,
      systemInstruction: ANALYZER_SYSTEM_INSTRUCTION,
      temperature: 0.1, // Hạ temp xuống 0.1 để AI tuân thủ strict output
    });

    const parsedChunk = parseSafeJSON(rawAnalysis);

    let items = [];
    if (Array.isArray(parsedChunk?.data)) {
      items = parsedChunk.data;
    } else if (Array.isArray(parsedChunk)) {
      items = parsedChunk;
    }

    // 🔥 SỬA LỖI 2: Đẩy vào finalResults có qua bộ lọc Deduplicate (Chống lặp từ)
    if (items.length > 0) {
      for (const item of items) {
        if (!item?.word) continue;
        const normalizedWord = item.word.trim().toLowerCase();

        // Chỉ push nếu từ này chưa từng xuất hiện trong finalResults
        if (!processedWords.has(normalizedWord)) {
          processedWords.add(normalizedWord);
          finalResults.push(item);
        }
      }
    } else {
      console.warn("Một chunk phân tích bị lỗi hoặc rỗng, đã bỏ qua.", chunk);
    }
  }

  return finalResults;
};

// ==========================================
// 2. GLOBAL DICTIONARY (SEARCH & LIST)
// ==========================================

export const fetchGlobalDictionary = async ({
  search = "",
  pos = "",
  wordType = "",
  page = 1,
  limit = 9,
} = {}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 9, 50));

  let query = supabase
    .from("global_words")
    .select("*", { count: "exact" })
    .order("word", { ascending: true });

  if (pos && pos !== "all") {
    query = query.eq("pos", pos);
  }

  if (wordType && wordType !== "all") {
    query = query.eq("word_type", wordType);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message || "Failed to load global dictionary");
  }

  const normalizedSearch = search.trim().toLowerCase();
  const filtered = (data || []).filter((item) => {
    if (!normalizedSearch) return true;

    const values = [
      item.word,
      item.slug,
      item.pos,
      item.word_type,
      Array.isArray(item.meanings)
        ? item.meanings.flatMap((meaning) => [
            meaning?.meaning,
            meaning?.example,
            meaning?.translation,
            meaning?.note,
            meaning?.explanation,
            meaning?.synonym,
            meaning?.antonym,
          ])
        : [],
      Array.isArray(item.context_sentences) ? item.context_sentences : [],
    ]
      .flat()
      .filter(Boolean);

    return values.some((value) =>
      String(value).toLowerCase().includes(normalizedSearch),
    );
  });

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / safeLimit));
  const currentPage = Math.min(safePage, totalPages);
  const start = (currentPage - 1) * safeLimit;
  const end = start + safeLimit;

  const paged = filtered.slice(start, end).map((item) => ({
    ...item,
    meanings: Array.isArray(item.meanings) ? item.meanings : [],
    context_sentences: Array.isArray(item.context_sentences)
      ? item.context_sentences
      : [],
  }));

  return {
    data: paged,
    pagination: {
      page: currentPage,
      limit: safeLimit,
      total: totalCount,
      totalPages,
    },
  };
};

// ==========================================
// 3. SAVE VOCABULARY LIST & HELPERS
// ==========================================

const slugify = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const jsonObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const jsonArray = (value) => (Array.isArray(value) ? value : []);

const normalizeEntry = (entry) => {
  const word = String(entry?.word ?? "").trim();
  if (!word) return null;

  return {
    word,
    slug: String(entry?.slug ?? "").trim() || slugify(word),
    meaning: String(entry?.meaning ?? "").trim() || "",
    pos: String(entry?.pos ?? "").trim() || null,
    ipa: String(entry?.ipa ?? "").trim() || null,
    word_family: jsonArray(entry?.word_family),
    prefix_suffix: jsonObject(entry?.prefix_suffix),
    collocations: jsonArray(entry?.collocations),
    context_sentence: String(entry?.context_sentence ?? "").trim() || null,
  };
};

const findGlobalWord = async ({ word, slug }) => {
  const { data: byWord, error: wordError } = await supabase
    .from("global_words")
    .select("*")
    .ilike("word", word)
    .maybeSingle();

  if (wordError)
    throw new Error(`Lỗi tìm global_word theo word: ${wordError.message}`);
  if (byWord) return byWord;

  const { data: bySlug, error: slugError } = await supabase
    .from("global_words")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (slugError)
    throw new Error(`Lỗi tìm global_word theo slug: ${slugError.message}`);
  return bySlug;
};

const createOrUpdateGlobalWord = async (entry) => {
  const existing = await findGlobalWord(entry);

  const rawPayload = {
    word: entry.word,
    slug: entry.slug,
    meaning: entry.meaning,
    pos: entry.pos,
    ipa: entry.ipa,
    word_family: entry.word_family,
    prefix_suffix: entry.prefix_suffix,
    context_sentence: entry.context_sentence,
    collocations: entry.collocations,
  };

  if (existing) {
    const updatePayload = Object.fromEntries(
      Object.entries(rawPayload).filter(
        ([_, v]) =>
          v !== null && v !== "" && (Array.isArray(v) ? v.length > 0 : true),
      ),
    );

    const { data, error } = await supabase
      .from("global_words")
      .update(updatePayload)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error)
      throw new Error(
        `Cập nhật global_words thất bại "${entry.word}": ${error.message}`,
      );
    return data;
  }

  const { data, error } = await supabase
    .from("global_words")
    .insert(rawPayload)
    .select("*")
    .single();

  if (error)
    throw new Error(
      `Thêm mới global_words thất bại "${entry.word}": ${error.message}`,
    );
  return data;
};

const upsertUserVocabulary = async ({ userId, wordId, contextSentence }) => {
  const nextReview = new Date(Date.now() + 60 * 1000).toISOString();

  const { data: existingUserVocab } = await supabase
    .from("user_vocabularies")
    .select("*")
    .eq("user_id", userId)
    .eq("word_id", wordId)
    .maybeSingle();

  if (existingUserVocab) {
    const { error } = await supabase
      .from("user_vocabularies")
      .update({
        context_sentence: contextSentence,
      })
      .eq("id", existingUserVocab.id);

    if (error)
      throw new Error(`Cập nhật user_vocabularies thất bại: ${error.message}`);
  } else {
    const { error } = await supabase.from("user_vocabularies").insert({
      user_id: userId,
      word_id: wordId,
      context_sentence: contextSentence,
      status: "learning",
      step: 0,
      interval: 1.0,
      ease_factor: 2.5,
      next_review: nextReview,
    });

    if (error)
      throw new Error(`Thêm mới user_vocabularies thất bại: ${error.message}`);
  }
};

export async function saveVocabularyList({ vocabList, userId }) {
  try {
    if (!userId)
      throw new Error("Unauthorized: Thiếu user_id hợp lệ từ token xác thực");
    if (!Array.isArray(vocabList) || !vocabList.length) {
      throw new Error("vocabList bắt buộc phải là một mảng không rỗng");
    }

    const entries = [
      ...new Map(
        vocabList
          .map(normalizeEntry)
          .filter(Boolean)
          .map((entry) => [entry.slug || entry.word.toLowerCase(), entry]),
      ).values(),
    ];

    if (!entries.length)
      throw new Error(
        "Không tìm thấy từ vựng hợp lệ nào trong danh sách gửi lên",
      );

    const savedWords = [];

    for (const entry of entries) {
      const globalWord = await createOrUpdateGlobalWord(entry);

      if (!globalWord.audio_url) {
        try {
          globalWord.audio_url = await ensureAudioUrl(globalWord.word, {
            table: "global_words",
            targetField: "word",
            recordId: globalWord.id,
          });
        } catch (audioErr) {
          console.warn(
            `[saveVocabularyList] Lỗi tạo audio cho từ "${globalWord.word}":`,
            audioErr?.message,
          );
        }
      }

      await upsertUserVocabulary({
        userId,
        wordId: globalWord.id,
        contextSentence: entry.context_sentence,
      });

      savedWords.push(globalWord.id);
    }

    return {
      success: true,
      savedCount: savedWords.length,
      words: savedWords,
      message: `Đã lưu thành công ${savedWords.length} từ vào kho từ vựng cá nhân.`,
    };
  } catch (error) {
    console.error("[saveVocabularyList] Thất bại:", error?.message || error);
    throw error;
  }
}

// ==========================================
// 4. USER VOCABULARY LIST & DELETE
// ==========================================

export const fetchUserVocabularyList = async ({ userId }) => {
  if (!userId) {
    throw new Error("Unauthorized: Thiếu user_id hợp lệ từ token xác thực");
  }

  const { data, error } = await supabase
    .from("user_vocabularies")
    .select(
      `
      id,
      user_id,
      word_id,
      context_sentence,
      status,
      step,
      interval,
      ease_factor,
      next_review,
      created_at,
      global_words (
        id,
        word,
        slug,
        meaning,
        pos,
        ipa,
        prefix_suffix,
        word_family,
        context_sentence,
        collocations,
        created_at
      )
    `,
    )
    .eq("user_id", userId)
    .not("word_id", "is", null)
    .order("next_review", { ascending: true });

  if (error) {
    throw new Error(
      error.message || "Thất bại khi lấy danh sách từ vựng của người dùng",
    );
  }

  return (data || []).map((item) => ({
    id: item.id,
    user_id: item.user_id,
    word_id: item.word_id,
    context_sentence: item.context_sentence,
    status: item.status,
    step: item.step,
    interval: item.interval,
    ease_factor: item.ease_factor,
    next_review: item.next_review,
    created_at: item.created_at,
    global_words: item.global_words || null,
  }));
};

export const removeUserVocabularyEntry = async ({ userId, vocabId }) => {
  if (!userId) {
    throw new Error(
      "Unauthorized: Missing valid user ID from authentication token",
    );
  }

  if (!vocabId) {
    throw new Error("Vocabulary id is required");
  }

  const { data, error } = await supabase
    .from("user_vocabularies")
    .delete()
    .eq("id", vocabId)
    .eq("user_id", userId)
    .not("word_id", "is", null)
    .select("id");

  if (error) {
    throw new Error(
      error.message || "Failed to delete vocabulary from personal dictionary",
    );
  }

  if (!data || data.length === 0) {
    throw new Error(
      "Vocabulary not found or you do not have permission to delete it",
    );
  }

  return {
    deletedId: data[0].id,
  };
};

// ==========================================
// 5. SRS REVIEW & DUE CARDS
// ==========================================

export const fetchDueCards = async ({ userId, limit = 20 }) => {
  if (!userId) {
    throw new Error("Unauthorized: Thiếu user_id hợp lệ từ token xác thực");
  }

  const nowIso = new Date().toISOString();

  const baseSelect = `
    id,
    user_id,
    word_id,
    context_sentence,
    status,
    step,
    interval,
    ease_factor,
    next_review,
    created_at,
    global_words (
      id,
      word,
      slug,
      meaning,
      pos,
      ipa,
      prefix_suffix,
      word_family,
      context_sentence,
      collocations,
      created_at
    )
  `;

  const { data: dueCards, error: dueError } = await supabase
    .from("user_vocabularies")
    .select(baseSelect)
    .eq("user_id", userId)
    .not("word_id", "is", null)
    .lte("next_review", nowIso)
    .neq("status", "mastered")
    .order("next_review", { ascending: true })
    .limit(limit);

  if (dueError) {
    throw new Error(
      dueError.message || "Thất bại khi lấy danh sách thẻ cần ôn tập",
    );
  }

  if ((dueCards || []).length > 0) {
    return dueCards.map((item) => ({
      ...item,
      global_words: item.global_words || null,
    }));
  }

  const { data: fallbackCards, error: fallbackError } = await supabase
    .from("user_vocabularies")
    .select(baseSelect)
    .eq("user_id", userId)
    .not("word_id", "is", null)
    .eq("status", "learning")
    .order("next_review", { ascending: true })
    .limit(limit);

  if (fallbackError) {
    throw new Error(
      fallbackError.message || "Thất bại khi lấy danh sách thẻ ôn tập dự phòng",
    );
  }

  return (fallbackCards || []).map((item) => ({
    ...item,
    global_words: item.global_words || null,
  }));
};

export const reviewVocabularyEntry = async ({
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
    .not("word_id", "is", null)
    .maybeSingle();

  if (fetchError || !record) {
    throw new Error(
      fetchError?.message || "Không tìm thấy bản ghi ôn tập từ vựng này",
    );
  }

  if (userId && record.user_id !== userId) {
    throw new Error("Bạn không có quyền ôn tập bản ghi từ vựng này");
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
    .select(
      `
      id,
      user_id,
      word_id,
      context_sentence,
      status,
      step,
      interval,
      ease_factor,
      next_review,
      created_at,
      global_words (
        id,
        word,
        slug,
        meaning,
        pos,
        ipa,
        prefix_suffix,
        word_family,
        context_sentence,
        collocations
      )
    `,
    )
    .single();

  if (updateError || !data) {
    throw new Error(updateError?.message || "Cập nhật bản ghi ôn tập thất bại");
  }

  return {
    success: true,
    data,
  };
};
