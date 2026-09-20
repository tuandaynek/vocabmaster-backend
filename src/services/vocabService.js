// services/vocab/vocabService.js
import dotenv from "dotenv";
import { supabase } from "../lib/supabase.js"; // Đã điều chỉnh path phù hợp với folder services/vocab/
import { ensureAudioUrl } from "./audioService.js";
import { generateGeminiContent } from "./geminiService.js";
import { buildSrsUpdatePayload, calculateNextReview } from "../utils/srs.js";

dotenv.config();

// ==========================================
// 1. EXTRACT VOCABULARY WITH AI (GEMINI)
// ==========================================

const DEFAULT_MODEL_CANDIDATES = ["gemini-3.5-flash", "gemini-3.6-flash"];

const modelCandidates = [
  ...new Set([
    ...(process.env.GEMINI_MODEL || "")
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean),
    ...DEFAULT_MODEL_CANDIDATES,
  ]),
];

const deepDiveResponseSchema = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      word: { type: "STRING" },
      slug: { type: "STRING" },
      meaning: { type: "STRING" },
      pos: { type: "STRING" },
      ipa: { type: "STRING" },
      prefix_suffix: {
        type: "OBJECT",
        properties: {
          prefix: { type: "STRING" },
          prefix_meaning: { type: "STRING" },
          root: { type: "STRING" },
          suffix: { type: "STRING" },
          suffix_meaning: { type: "STRING" },
        },
      },
      word_family: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            word: { type: "STRING" },
            pos: { type: "STRING" },
            meaning: { type: "STRING" },
          },
          required: ["word", "pos", "meaning"],
        },
      },
      collocations: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            phrase: { type: "STRING" },
            type: { type: "STRING" },
            meaning: { type: "STRING" },
            usage_note: { type: "STRING" },
          },
          required: ["phrase", "type", "meaning"],
        },
      },
      context_sentence: { type: "STRING" },
    },
    required: [
      "word",
      "slug",
      "pos",
      "ipa",
      "prefix_suffix",
      "word_family",
      "collocations",
      "context_sentence",
      "meaning",
    ],
  },
};

const buildPrompt = ({ passage, limit, focusMode, mustIncludeWords }) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 20);
  const requiredWords = Array.isArray(mustIncludeWords)
    ? mustIncludeWords.filter(Boolean).join(", ")
    : "";

  return `
You are an expert English vocabulary educator. Extract up to ${safeLimit} key words or phrases from the passage.
Focus mode: ${focusMode}.
Priority words that appear in the passage MUST be included: ${requiredWords || "none"}.

Return ONLY a valid JSON array. Every object must contain exactly:
- word: original target word/phrase
- slug: lowercase kebab-case identifier
- meaning: primary Vietnamese translation/definition of the main word
- pos: part of speech (noun, verb, adjective, adverb...)
- ipa: clean IPA transcription
- prefix_suffix: object detailing morphological structure
- word_family: array of related word family forms [{ word, pos, meaning }]
- collocations: array of collocations/phrasal verbs [{ phrase, type, meaning, usage_note }]
- context_sentence: exact sentence from the passage containing the extracted word/phrase

Use Vietnamese for all meanings and usage_note.

PASSAGE:
"${passage}"
`.trim();
};

export const extractVocabWithGemini = async ({
  passage,
  limit = 10,
  focusMode = "IELTS Academic",
  mustIncludeWords = [],
}) => {
  const safePassage = typeof passage === "string" ? passage.trim() : "";
  if (!safePassage) throw new Error("Passage is required");

  let lastError = null;

  for (const modelName of modelCandidates) {
    try {
      const prompt = buildPrompt({
        passage: safePassage,
        limit,
        focusMode,
        mustIncludeWords,
      });

      const result = await generateGeminiContent({
        modelName,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: deepDiveResponseSchema,
          temperature: 0.2,
        },
      });

      if (!result.success) {
        throw new Error(result.error?.message || "Gemini execution failed");
      }

      const parsed = result.data.json || JSON.parse(result.data.text || "[]");

      if (!Array.isArray(parsed)) {
        throw new Error("Gemini response is not a valid JSON array");
      }

      return parsed.slice(0, Math.min(Math.max(Number(limit) || 10, 1), 20));
    } catch (error) {
      lastError = error;
      console.warn(
        `[vocabService] Model ${modelName} thất bại:`,
        error?.message || error,
      );
    }
  }

  throw new Error(
    `Tất cả các mô hình Gemini đều thất bại: ${lastError?.message || "Lỗi không xác định"}`,
  );
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
    .select(`
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
    `)
    .eq("user_id", userId)
    .not("word_id", "is", null)
    .order("next_review", { ascending: true });

  if (error) {
    throw new Error(
      error.message || "Thất bại khi lấy danh sách từ vựng của người dùng"
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
