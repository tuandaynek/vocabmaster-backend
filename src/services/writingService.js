import { callGroqWithFallback } from "../lib/groq.js";

const requireText = (value, name) => {
  if (!value || typeof value !== "string" || !value.trim()) {
    throw new Error(`Tham số '${name}' không hợp lệ hoặc bị trống.`);
  }
  return value.trim();
};

/**
 * Lập Outline phân tích đề bài IELTS Writing Task 2
 */
export const generateEssayOutline = async (questionText) => {
  const question = requireText(questionText, "questionText");

  const systemInstruction = `Bạn là IELTS Writing Task 2 Counselor. Hướng dẫn phân tích đề bằng tiếng Việt, chính xác, thực tế và không viết bài hoàn chỉnh thay thí sinh.
BẮT BUỘC trả về duy nhất 1 JSON Object tuân thủ theo cấu trúc sau (Không bọc Markdown codeblock):
{
  "essayType": "Loại bài essay (vd: Opinion, Discussion, Cause & Effect...)",
  "keywords": [
    { "word": "từ khóa", "explanation": "giải thích ý nghĩa" }
  ],
  "pitfalls": ["bẫy cần tránh 1", "bẫy cần tránh 2"],
  "structure": {
    "introduction": "Hướng dẫn viết Mở bài",
    "body1": "Hướng dẫn viết Thân bài 1",
    "body2": "Hướng dẫn viết Thân bài 2",
    "conclusion": "Hướng dẫn viết Kết luận"
  },
  "brainstorming": {
    "body1Ideas": ["ý tưởng 1", "ý tưởng 2"],
    "body2Ideas": ["ý tưởng 1", "ý tưởng 2"]
  },
  "usefulVocabulary": [
    { "phrase": "cụm từ tiếng Anh", "meaning": "nghĩa tiếng Việt" }
  ]
}`;

  const prompt = `Phân tích đề IELTS Writing Task 2 sau đây trước khi thí sinh viết bài:
"${question}"

Xác định đúng essay type, giải thích từ khóa và bẫy, đề xuất cấu trúc 4 phần (mở bài, thân bài 1, thân bài 2, kết luận), brainstorm hai luận điểm cân bằng và cung cấp từ vựng hữu ích. Trả về đúng JSON format.`.trim();

  return callGroqWithFallback({
    prompt,
    systemInstruction,
    temperature: 0.2,
  });
};

/**
 * Xử lý Tutor Chat trợ giúp Socratic Step-by-Step
 */
export const handleTutorChat = async (
  questionText,
  chatHistory,
  userMessage,
  targetBand = "6.5"
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
          (item) => item && (item.role === "user" || item.role === "assistant")
        )
        .slice(-12)
        .map((item) => ({
          role: item.role,
          content:
            typeof item.content === "string" ? item.content.slice(0, 4000) : "",
        }))
    : [];

  const systemInstruction = `Bạn là giáo viên IELTS Writing Task 2 tận tụy, nghiêm túc nhưng gần gũi. Luôn trả lời bằng tiếng Việt; chỉ dùng tiếng Anh cho câu mẫu, collocations và vocabulary.
Trả về kết quả dưới dạng JSON Object với key "reply" chứa nội dung câu trả lời.
Ví dụ format JSON: { "reply": "Nội dung phản hồi..." }

CẤM (STRICT NEGATIVE CONSTRAINTS):
- CẤM ĐỀ CẬP, TÓM TẮT HOẶC LIỆT KÊ NỘI DUNG CỦA CẢ HAI THÂN BÀI (Body 1 & Body 2) TRONG CÙNG MỘT TIN NHẮN.
- CẤM tự ý nhảy sang Body 2 khi chưa chốt xong Body 1.
- CẤM dùng từ vựng đao to búa lớn/gượng ép (như 'instantaneous retrieval', 'vast repositories').

LUỒNG SOCRATIC STEP-BY-STEP (CHỈ XỬ LÝ 1 BƯỚC TẠI MỘT THỜI ĐIỂM):
- BƯỚC 1 (Chốt góc nhìn): Học viên chọn Agree/Disagree/Balanced -> Xác nhận ngắn + HỎI NGAY ý tưởng thô cho BODY 1. (DỪNG LẠI TẠI ĐÂY, KHÔNG NHẮC TỚI BODY 2).
- BƯỚC 2 (Đào sâu Body 1): Thảo luận & gợi ý Collocations cho Body 1. Xử lý xong hoàn toàn mới hỏi sang Body 2.
- BƯỚC 3 (Đào sâu Body 2): Thảo luận & gợi ý Collocations cho Body 2.

QUY TẮC FORMAT BẮT BUỘC TRONG VALUE CỦA "reply":
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
Bạn đang nghĩ đến những lý do cụ thể nào khiến người đọc ưu tiên tài liệu online hơn ở Body 1?`.trim();

  const prompt = `Đề bài IELTS Writing Task 2:
${question}

Target Band:
${normalizedBand}

Lịch sử hội thoại:
${JSON.stringify(history)}

Tin nhắn mới nhất của học viên:
"${message}"

YÊU CẦU QUAN TRỌNG:
Dựa vào tin nhắn mới nhất, hãy xác định cuộc hội thoại đang ở BƯỚC NÀO trong luồng (Bước 1: Chốt góc nhìn -> Bước 2: Body 1 -> Bước 3: Body 2).
TUYỆT ĐỐI CHỈ phản hồi đúng bước đó. CẤM gom nội dung của cả 2 body vào tin nhắn này! Trả về JSON Object.`.trim();

  return callGroqWithFallback({
    prompt,
    systemInstruction,
    temperature: 0.2,
  });
};

/**
 * YÊU CẦU 2: HÀM EVALUATE ESSAY (Chấm bài IELTS Writing Task 2)
 */
export const evaluateEssay = async (questionText, userEssay, targetBand = "6.5") => {
  if (!questionText?.trim() || !userEssay?.trim()) {
    throw new Error("questionText và userEssay là bắt buộc.");
  }

  const systemInstruction = `Bạn là Giám khảo IELTS Writing Task 2 Senior nổi tiếng cực kỳ BẢO THỦ, KHẮT KHE và TRỪ ĐIỂM THẲNG TAY. Bạn chấm đúng theo quy chuẩn IELTS Band Descriptors thực tế của IDP/BC. 
TUYỆT ĐỐI KHÔNG nâng điểm vì tiềm năng, KHÔNG 'nương tay' cho thái độ tích cực. Nếu bài có lỗi logic nghiêm trọng, phạt thẳng điểm Task Response xuống 5.5 hoặc 6.0.

BẮT BUỘC trả về đúng định dạng JSON chuẩn theo đúng Schema sau (Không kèm markdown codeblock):
{
  "bandScores": {
    "taskResponse": 6.0,
    "coherenceCohesion": 6.5,
    "lexicalResource": 6.0,
    "grammaticalRange": 6.0,
    "overall": 6.0
  },
  "counselorSummary": "Nhận xét thẳng thắn bằng Tiếng Việt (3-4 câu), chỉ rõ lý do bị trừ điểm.",
  "criteriaDiagnostics": {
    "taskResponse": { "strengths": ["..."], "weaknesses": ["..."], "actionPlan": "..." },
    "coherenceCohesion": { "strengths": ["..."], "weaknesses": ["..."], "actionPlan": "..." },
    "lexicalResource": { "strengths": ["..."], "weaknesses": ["..."], "actionPlan": "..." },
    "grammaticalRange": { "strengths": ["..."], "weaknesses": ["..."], "actionPlan": "..." }
  },
  "inlineCorrections": [
    {
      "originalSentence": "Câu gốc bị lỗi",
      "correctedSentence": "Câu sửa chuẩn Tiếng Anh",
      "explanation": "Giải thích lỗi bằng Tiếng Việt",
      "type": "Grammar"
    }
  ],
  "highValueVocabulary": [
    {
      "originalPhrase": "cụm gốc",
      "bandUpgrade": "cụm nâng cấp Band ${targetBand}+",
      "contextExample": "Ví dụ câu Tiếng Anh"
    }
  ],
  "incrementalUpgradedEssay": "Bài viết mẫu Band ${targetBand} bằng Tiếng Anh, phân tách rõ các đoạn bằng 2 lần xuống dòng (\\n\\n)"
}`;

  const prompt = `
Đề bài IELTS Writing Task 2:
"${questionText}"

Bài viết của thí sinh:
"${userEssay}"

Hãy chấm bài theo đúng quy tắc BẢO THỦ, KHẮT KHE đã nêu ở System Instruction và trả về duy nhất 1 JSON Object.
  `.trim();

  return callGroqWithFallback({
    prompt,
    systemInstruction,
    temperature: 0.2,
  });
};