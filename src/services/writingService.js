import dotenv from "dotenv";
import { generateGeminiContent } from "./geminiService.js";

dotenv.config();

const MODEL_CANDIDATES = [
  ...(process.env.GEMINI_MODEL || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean),
  "gemini-3.5-flash",
  "gemini-3.6-flash",
];

const outlineSchema = {
  type: "OBJECT",
  properties: {
    essayType: { type: "STRING" },
    keyTermsAnalysis: { type: "STRING" },
    recommendedStructure: { type: "STRING" },
    brainstormedIdeas: {
      type: "OBJECT",
      properties: {
        body1: {
          type: "OBJECT",
          properties: {
            mainPoint: { type: "STRING" },
            supportingIdeas: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["mainPoint", "supportingIdeas"],
        },
        body2: {
          type: "OBJECT",
          properties: {
            mainPoint: { type: "STRING" },
            supportingIdeas: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["mainPoint", "supportingIdeas"],
        },
      },
      required: ["body1", "body2"],
    },
    usefulVocab: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          word: { type: "STRING" },
          meaning: { type: "STRING" },
        },
        required: ["word", "meaning"],
      },
    },
  },
  required: [
    "essayType",
    "keyTermsAnalysis",
    "recommendedStructure",
    "brainstormedIdeas",
    "usefulVocab",
  ],
};

const evaluationSchema = {
  type: "OBJECT",
  properties: {
    bandScores: {
      type: "OBJECT",
      properties: {
        taskResponse: { type: "NUMBER" },
        coherenceCohesion: { type: "NUMBER" },
        lexicalResource: { type: "NUMBER" },
        grammaticalRange: { type: "NUMBER" },
        overall: { type: "NUMBER" },
      },
      required: [
        "taskResponse",
        "coherenceCohesion",
        "lexicalResource",
        "grammaticalRange",
        "overall",
      ],
    },
    counselorSummary: { type: "STRING" },
    criteriaDiagnostics: {
      type: "OBJECT",
      properties: {
        taskResponse: {
          type: "OBJECT",
          properties: {
            strengths: { type: "ARRAY", items: { type: "STRING" } },
            weaknesses: { type: "ARRAY", items: { type: "STRING" } },
            actionPlan: { type: "STRING" },
          },
          required: ["strengths", "weaknesses", "actionPlan"],
        },
        coherenceCohesion: {
          type: "OBJECT",
          properties: {
            strengths: { type: "ARRAY", items: { type: "STRING" } },
            weaknesses: { type: "ARRAY", items: { type: "STRING" } },
            actionPlan: { type: "STRING" },
          },
          required: ["strengths", "weaknesses", "actionPlan"],
        },
        lexicalResource: {
          type: "OBJECT",
          properties: {
            strengths: { type: "ARRAY", items: { type: "STRING" } },
            weaknesses: { type: "ARRAY", items: { type: "STRING" } },
            actionPlan: { type: "STRING" },
          },
          required: ["strengths", "weaknesses", "actionPlan"],
        },
        grammaticalRange: {
          type: "OBJECT",
          properties: {
            strengths: { type: "ARRAY", items: { type: "STRING" } },
            weaknesses: { type: "ARRAY", items: { type: "STRING" } },
            actionPlan: { type: "STRING" },
          },
          required: ["strengths", "weaknesses", "actionPlan"],
        },
      },
      required: [
        "taskResponse",
        "coherenceCohesion",
        "lexicalResource",
        "grammaticalRange",
      ],
    },
    inlineCorrections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          originalSentence: { type: "STRING" },
          correctedSentence: { type: "STRING" },
          explanation: { type: "STRING" },
          type: {
            type: "STRING",
            enum: ["Grammar", "Vocabulary", "Task Response", "Coherence"],
          },
        },
        required: [
          "originalSentence",
          "correctedSentence",
          "explanation",
          "type",
        ],
      },
    },
    highValueVocabulary: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          originalPhrase: { type: "STRING" },
          band8Upgrade: { type: "STRING" },
          contextExample: { type: "STRING" },
        },
        required: ["originalPhrase", "band8Upgrade", "contextExample"],
      },
    },
    incrementalUpgradedEssay: { type: "STRING" },
  },
  required: [
    "bandScores",
    "counselorSummary",
    "criteriaDiagnostics",
    "inlineCorrections",
    "highValueVocabulary",
    "incrementalUpgradedEssay",
  ],
};

const tutorChatSchema = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
  },
  required: ["reply"],
};

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

const requireText = (value, fieldName) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
};

export const generateEssayOutline = async (questionText) => {
  const question = requireText(questionText, "questionText");
  return callGeminiWithFallback({
    schema: outlineSchema,
    systemInstruction:
      "Bạn là IELTS Writing Task 2 Counselor. Hướng dẫn phân tích đề bằng tiếng Việt, chính xác, thực tế và không viết bài hoàn chỉnh thay thí sinh.",
    contents: `
Phân tích đề IELTS Writing Task 2 sau đây trước khi thí sinh viết bài:
"${question}"

Xác định đúng essay type, giải thích từ khóa và bẫy, đề xuất cấu trúc 4 phần (mở bài, thân bài 1, thân bài 2, kết luận), brainstorm hai luận điểm cân bằng và cung cấp từ vựng hữu ích. Trả về đúng JSON schema, không thêm Markdown.
`.trim(),
  });
};

export const handleTutorChat = async (
  questionText,
  chatHistory,
  userMessage,
  targetBand = "6.5",
) => {
  const question = requireText(questionText, "questionText");
  const message = requireText(userMessage, "userMessage");
  const allowedBands = ["6.0", "6.5", "7.0", "7.5", "8.0", "8.5", "9.0"];
  const normalizedBand = allowedBands.includes(String(targetBand))
    ? String(targetBand)
    : "7.0";
  const history = Array.isArray(chatHistory)
    ? chatHistory
        .filter(
          (item) => item && (item.role === "user" || item.role === "assistant"),
        )
        .slice(-12)
        .map((item) => ({
          role: item.role,
          content:
            typeof item.content === "string" ? item.content.slice(0, 4000) : "",
        }))
    : [];

  return callGeminiWithFallback({
    schema: tutorChatSchema,
    systemInstruction: `
Bạn là giáo viên IELTS Writing Task 2 tận tụy, nghiêm túc nhưng gần gũi. Luôn trả lời bằng tiếng Việt; chỉ dùng tiếng Anh cho câu mẫu, collocations và vocabulary.

CẤM (STRICT NEGATIVE CONSTRAINTS):
- CẤM ĐỀ CẬP, TÓM TẮT HOẶC LIỆT KÊ NỘI DUNG CỦA CẢ HAI THÂN BÀI (Body 1 & Body 2) TRONG CÙNG MỘT TIN NHẮN.
- CẤM tự ý nhảy sang Body 2 khi chưa chốt xong Body 1.
- CẤM dùng từ vựng đao to búa lớn/gượng ép (như 'instantaneous retrieval', 'vast repositories').

LUỒNG SOCRATIC STEP-BY-STEP (CHỈ XỬ LÝ 1 BƯỚC TẠI MỘT THỜI ĐIỂM):
- BƯỚC 1 (Chốt góc nhìn): Học viên chọn Agree/Disagree/Balanced -> Xác nhận ngắn + HỎI NGAY ý tưởng thô cho BODY 1. (DỪNG LẠI TẠI ĐÂY, KHÔNG NHẮC TỚI BODY 2).
- BƯỚC 2 (Đào sâu Body 1): Thảo luận & gợi ý Collocations cho Body 1. Xử lý xong hoàn toàn mới hỏi sang Body 2.
- BƯỚC 3 (Đào sâu Body 2): Thảo luận & gợi ý Collocations cho Body 2.

QUY TẮC FORMAT BẮT BUỘC:
- Tối đa 120-150 từ mỗi phản hồi.
- Bắt buộc dùng Markdown: **bôi đậm**, dấu gạch đầu dòng (-) cho danh sách, và 2 lần xuống dòng (\\n\\n) giữa 3 phần.
- Mọi phản hồi BẮT BUỘC gồm đúng 3 phần theo thứ tự sau:

🎯 **Đánh giá hướng đi:**
[1 câu ngắn nhận xét góc nhìn hoặc ý tưởng hiện tại của học viên]

💡 **Gợi ý tự nhiên (Target Band ${normalizedBand}):**
- **Định hướng:** [1-2 câu gợi ý cho ĐÚNG MỘT KHỔ THÂN BÀI đang thảo luận]
- **Collocations nên dùng:** **[collocation 1]**, **[collocation 2]**, **[collocation 3]**

💬 **Định hướng tiếp theo:**
[Đúng 1 câu hỏi mở ngắn để học viên tự nghĩ ý tiếp theo]

MẪU PHẢN HỒI BẮT BUỘC KHI HỌC VIÊN VỪA CHỌN TRUNG LẬP (FEW-SHOT):

🎯 **Đánh giá hướng đi:**
Lựa chọn hướng đi trung lập và phản biện từ 'nobody' là cực kỳ thông minh! Hướng đi này giúp bài viết rất chặt chẽ.

💡 **Gợi ý tự nhiên (Target Band ${normalizedBand}):**
- **Định hướng:** Ở Body 1, chúng ta nên giải thích lý do vì sao tài liệu trực tuyến miễn phí lại bùng nổ và chiếm ưu thế.
- **Collocations nên dùng:** **free online sources**, **instant access**, **digital reading**.

💬 **Định hướng tiếp theo:**
Bạn đang nghĩ đến những lý do cụ thể nào khiến người đọc ưu tiên tài liệu online hơn ở Body 1?

Áp dụng cấu trúc 3 phần rõ ràng trên cho mọi phản hồi. Không thêm phần nào khác.

IMPORTANT FORMATTING RULES:
- ALWAYS format your response using standard Markdown.
- Use DOUBLE LINE BREAKS (\n\n) between different paragraphs or ideas.
- Use bullet points (*) for lists of points or vocabulary suggestions. NEVER collapse bullet points into a single continuous paragraph.
- Use bold (**text**) for key terms or labels.
`.trim(),
    contents: `
Đề bài IELTS Writing Task 2:
${question}

Target Band:
${normalizedBand}

Lịch sử hội thoại:
${JSON.stringify(history)}

Tin nhắn mới nhất của học viên:
"${message}"

YÊU CẦU QUAN TRỌNG:
Dựa vào tin nhắn mới nhất, hãy xác định cuộc hội thoại đang ở BƯỚC NÀO trong luồng (Bước 1: Chốt góc nhìn -> Bước 2: Body 1 -> Bước 3: Body 2).
TUYỆT ĐỐI CHỈ phản hồi đúng bước đó. CẤM gom nội dung của cả 2 body vào tin nhắn này!
`.trim(),
  });
};

export const evaluateEssay = async (questionText, userEssay, targetBand = "6.5") => {
  const question = requireText(questionText, "questionText");
  const essay = requireText(userEssay, "userEssay");
  return callGeminiWithFallback({
    schema: evaluationSchema,
    systemInstruction:
      "Bạn là Giám khảo IELTS Writing Task 2 Senior nổi tiếng cực kỳ BẢO THỦ, KHẮT KHE và TRỪ ĐIỂM THẲNG TAY. Bạn chấm đúng theo quy chuẩn IELTS Band Descriptors thực tế của IDP/BC. TUYỆT ĐỐI KHÔNG nâng điểm vì tiềm năng, KHÔNG 'nương tay' cho thái độ tích cực. Nếu bài có lỗi logic nghiêm trọng (lạc đề nhẹ, lập luận đi ngược thực tế), điểm Task Response TỐI ĐA chỉ là 5.5 hoặc 6.0. TOÀN BỘ các phần nhận xét (counselorSummary, strengths, weaknesses, actionPlan, explanation) BẮT BUỘC VIẾT BẰNG TIẾNG VIỆT tự nhiên, sâu sắc và thẳng thắn. Các câu ví dụ, từ vựng và bài incrementalUpgradedEssay giữ nguyên bằng Tiếng Anh.",
    contents: `
Đề bài IELTS Writing Task 2:
"${question}"

Bài viết của thí sinh:
"${essay}"

Hãy chấm bài theo tiêu chuẩn TRỪ ĐIỂM NGHIÊM NGẶT với các quy tắc sau:

1. ĐÁNH GIÁ ĐIỂM SỐ (Bảo thủ 100%):
   - Task Response: Chiếu thẳng lỗi logic (ví dụ: đưa ý không liên quan, lập luận sai thực tế). Nếu luận điểm thiếu tính thuyết phục, phạt thẳng xuống 5.5 - 6.0.
   - Coherence & Cohesion: Soi kỹ việc dùng sai từ nối (ví dụ: dùng 'By contrast' sai ngữ cảnh) và các câu bị ngắt kết nối ý.
   - Lexical Resource: Trừ điểm các từ vựng vụng về, dịch thô từ tiếng Việt (ví dụ: 'realistic feelings', 'entertainment places').
   - Grammatical Range: Trừ điểm nếu cấu trúc câu lặp lại đơn điệu dạng Subject + Verb hoặc mắc lỗi giới từ/diễn đạt.

2. YÊU CẦU NỘI DUNG NGUYÊN BẢN TRẢ VỀ JSON:
   - counselorSummary: Nhận xét thẳng thắn bằng Tiếng Việt (3-4 câu), chỉ rõ lý do vì sao bài viết bị 'bóp' điểm và cần sửa gấp điểm yếu cốt lõi nào.
   - criteriaDiagnostics: Phân tích 4 tiêu chí bằng Tiếng Việt. Phần 'weaknesses' phải mổ xẻ gắt gao, không khen chung chung. Phần 'actionPlan' đưa ra giải pháp khắc phục cụ thể.
   - inlineCorrections: Nhặt ra tất cả các câu vụng về, đưa ra cách sửa (Tiếng Anh) và GIẢI THÍCH LỖI BẰNG TIẾNG VIỆT rõ ràng vì sao viết như vậy bị trừ điểm.
   - highValueVocabulary: Trích xuất cụm từ nâng band (gốc, nâng cấp Band 8.0+, ví dụ Tiếng Anh).
   - incrementalUpgradedEssay: Bài viết mẫu Band ${targetBand} bằng Tiếng Anh, phân tách rõ các đoạn bằng 2 lần xuống dòng (\\n\\n).

Trả về đúng JSON Schema.
`.trim(),
  });
};
