import { generateGeminiContent } from "./geminiService.js";

const normalizeMeaning = (meanings) => {
  if (!Array.isArray(meanings)) return "";
  const first = meanings[0];

  if (!first) return "";
  if (typeof first === "string") return first;
  if (typeof first === "object") {
    return first.meaning || first.vi || first.vietnamese || "";
  }

  return "";
};

const buildFallbackMatch = (message, vocabList) => {
  const normalizedMessage = String(message || "").toLowerCase();
  if (!normalizedMessage || !Array.isArray(vocabList) || !vocabList.length)
    return [];

  return vocabList
    .map((item) => {
      const word = String(item.word || "").toLowerCase();
      const meaning = String(item.meaning || "").toLowerCase();
      const context = String(item.context_sentence || "").toLowerCase();
      const haystack = `${word} ${meaning} ${context}`;

      if (!haystack.trim()) return null;

      const score = [word, meaning, context].reduce((sum, value) => {
        if (!value) return sum;
        return sum + (normalizedMessage.includes(value) ? 2 : 0);
      }, 0);

      return { ...item, _score: score };
    })
    .filter(Boolean)
    .filter((item) => item._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 5)
    .map(({ _score, ...rest }) => rest);
};

export const fetchUserVocabListForTopicMatching = async ({ userId }) => {
  if (!userId) {
    throw new Error("User ID is required");
  }

  const { data, error } = await supabase
    .from("user_vocabularies")
    .select(
      `
      id,
      user_id,
      status,
      context_sentence,
      global_words (
        word,
        meanings
      )
    `,
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      error.message || "Failed to load user vocab for topic matching",
    );
  }

  return (data || [])
    .map((item) => {
      const word = item.global_words?.word || "";
      const meaning = normalizeMeaning(item.global_words?.meanings);

      return {
        word,
        meaning,
        status: item.status || "learning",
        context_sentence: item.context_sentence || "",
      };
    })
    .filter((item) => item.word);
};

export const matchVocabularyByTopic = async ({ message, vocabList }) => {
  const safeMessage = String(message || "").trim();
  if (!safeMessage || !Array.isArray(vocabList) || !vocabList.length) return [];

  // 🔥 Đã nâng cấp Prompt: Mở rộng khả năng chọn từ vựng & gợi ý thêm collocations linh hoạt hơn (3-5 cụm)
  const prompt = `
Bạn là chuyên gia ngôn ngữ Tech/Business.
Tin nhắn người dùng: "${safeMessage}"

Danh sách từ vựng gốc của người dùng:
${vocabList.map((v) => `- ${v.word}: ${v.meaning || ""}`).join("\n")}

NHIỆM VỤ:
1. Chọn ra từ 3 ĐẾN 5 TỪ VỰNG phù hợp nhất trong danh sách trên liên quan đến chủ đề tin nhắn.
2. Với MỖI từ vựng chọn được, gợi ý từ 2 ĐẾN 3 CỤM COLLOCATION TIẾNG ANH (mỗi cụm 2-4 từ) cực kỳ tự nhiên, dễ lồng ghép vào văn cảnh.
3. Tổng số cụm collocation trả về nên nằm trong khoảng 4 ĐẾN 8 CỤM để AI phía sau có đủ kho từ ghép câu.
`.trim();

  try {
    const response = await generateGeminiContent({
      modelName: "gemini-3.5-flash",
      config: {
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              original_word: { type: "STRING" },
              collocations: {
                type: "ARRAY",
                description: "Danh sách cụm từ collocation tự nhiên nhất",
                items: {
                  type: "OBJECT",
                  properties: {
                    collocation: {
                      type: "STRING",
                      description: "Cụm tiếng Anh 2-4 từ tự nhiên",
                    },
                    meaning: {
                      type: "STRING",
                      description: "Nghĩa tiếng Việt tương ứng",
                    },
                  },
                  required: ["collocation", "meaning"],
                },
              },
            },
            required: ["original_word", "collocations"],
          },
        },
      },
      contents: prompt,
    });

    if (response.success && Array.isArray(response.data.json)) {
      return response.data.json;
    }

    if (response.data?.text) {
      const cleanJson = response.data.text
        .replace(/```json\n?|```/g, "")
        .trim();
      return JSON.parse(cleanJson);
    }

    return buildFallbackMatch(safeMessage, vocabList);
  } catch (error) {
    console.warn("Topic matching failed, falling back to local match:", error);
    return buildFallbackMatch(safeMessage, vocabList);
  }
};
