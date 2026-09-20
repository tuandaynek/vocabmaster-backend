import { generateGeminiContent } from "./geminiService.js";
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Danh sách các model Flash đang chạy ổn định để fallback nếu 1 model gặp sự cố
const PREFERRED_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
];

const STRICT_EXAMINER_INSTRUCTION = `Bạn là một Giám khảo IELTS Speaking vô cùng khắt khe, thực tế và nhất quán. Bám sát IELTS Speaking Band Descriptors chính thức, không cho điểm động viên và luôn chấm bảo thủ hơn khoảng 0.5 band khi chất lượng bài nói nằm giữa hai mức. Đánh giá năng lực thực tế thể hiện trong bài, không đánh giá tiềm năng của thí sinh.`;

const INCREMENTAL_MODEL_ANSWER_RULES = `
    QUY TẮC BẮT BUỘC CHO upgradedModelAnswer (Incremental Upgrade):
    - Giữ nguyên ít nhất 70-80% khung xương, ý tưởng, thông tin cá nhân và thứ tự phát triển câu của bài gốc.
    - Không thêm ý tưởng, ví dụ hoặc lập luận mới mà candidate chưa nói; không biến bài thành một bài mẫu hoàn toàn khác.
    - Chỉ sửa lỗi ngữ pháp đã phát hiện, thay các từ/cụm từ nối rập khuôn (ví dụ "The first thing is" -> "First and foremost", "Another thing is" -> "Additionally"), và nâng cấp tối đa 2-3 từ/cụm từ lặp hoặc đơn điệu thành collocations tự nhiên hơn.
    - Giữ giọng văn và mức độ tự nhiên gần với candidate để người học nhận ra bài của mình; không nhồi từ vựng C1/C2 xa lạ.
    - Nếu không có lỗi hoặc điểm yếu rõ ràng, chỉ chỉnh nhẹ dấu câu, ngữ pháp và độ tự nhiên; không over-engineer.
`;

const getTranscriptText = (transcript) => {
  if (Array.isArray(transcript)) {
    return transcript
      .filter((item) => item?.sender === "user")
      .map((item) => item.text || "")
      .join(" ");
  }
  return transcript || "";
};

const applyStrictFluencyCap = (score, transcript, pauseAnalysis = []) => {
  const text = getTranscriptText(transcript).toLowerCase();
  const repeatedConnectorCount = (text.match(/\b(first|another|the first thing is|another thing is)\b/g) || []).length;
  const repeatedWordCount = ["reduce", "think"].some(
    (word) => (text.match(new RegExp(`\\b${word}\\b`, "g")) || []).length > 2,
  );
  const longPauseCount = pauseAnalysis.filter((pause) => pause.type === "LONG_PAUSE").length;

  if (repeatedConnectorCount > 2 || repeatedWordCount || longPauseCount >= 2) {
    return Math.min(score, 6.5);
  }
  return score;
};

/**
 * Helper gọi generateGeminiContent và thử lần lượt qua các model nếu model trước thất bại
 */
const callGeminiWithFallback = async ({ contents, config, systemInstruction }) => {
  let lastError = null;

  for (const modelName of PREFERRED_MODELS) {
    const response = await generateGeminiContent({
      modelName,
      contents,
      config,
      systemInstruction,
    });

    if (response.success) {
      return response.data;
    }

    lastError = response.error;
    console.warn(`⚠️ Model ${modelName} thất bại, chuyển sang model kế tiếp... Lỗi:`, response.error?.message);
  }

  throw new Error(`Tất cả các model Gemini đều không thể xử lý request. Lỗi cuối: ${lastError?.message || "Unknown error"}`);
};

/**
 * 1. Xử lý phản hồi của User & Đưa ra Follow-up (Dựa trên ngữ nghĩa & độ sâu câu trả lời)
 */
export const processChatStep = async ({ question, targetBand, history, userResponse }) => {
  const systemInstruction = `You are an official, highly professional IELTS Speaking Examiner for Part 1. Keep your prompts clean, concise, and natural.`;

  const prompt = `
    Target Band: ${targetBand || "7.0"}
    Current Question: "${question}"
    Conversation History: ${JSON.stringify(history || [])}
    Candidate's Latest Response: "${userResponse}"

    EVALUATION & CRITERIA RULES:
    1. Assess if the candidate's latest response (combined with prior history for this question) fully answers the topic with sufficient elaboration, reasoning, or examples suitable for Band ${targetBand}.
    2. IF THE ANSWER IS TOO BRIEF or ONE-WORD/ONE-SENTENCE (e.g., "I'm a student", "I like Math"):
       - "needsFollowUp": true
       - Ask ONE concise follow-up question ("followUpQuestion") prompting them to expand (e.g. "Why did you choose that field?" or "What do you enjoy most about it?").
    3. IF THE ANSWER IS ADEQUATE & SATISFIES BAND ${targetBand}:
       - "needsFollowUp": false
       - "followUpQuestion": ""
    4. HARD STOP RULE: If the history shows the candidate has already answered 3 or 4 follow-ups for THIS single question, set "needsFollowUp": false regardless, to prevent endless looping.

    STRICT FORMATTING RULES:
    - DO NOT include conversational filler/praise in "followUpQuestion" (STRICTLY NO: "That sounds fascinating!", "That makes sense", "Great job").
    - Ask ONLY the raw question directly.
    - DO NOT attach generic advice or tips (e.g., NO: "To get Band 7.0, aim for 3-4 sentences...").

    Return ONLY a JSON object matching this schema:
    {
      "needsFollowUp": boolean,
      "followUpQuestion": string
    }
  `;

  const data = await callGeminiWithFallback({
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    },
    systemInstruction,
  });

  return data.json || JSON.parse(data.text);
};

/**
 * 2. Gợi ý Collocations từ Tiếng Việt (KHÔNG viết toàn bộ câu)
 */
export const generateCollocations = async ({ vietnamesePhrase, currentQuestion }) => {
  const systemInstruction = `You are an IELTS Speaking Vocabulary Coach specializing in high-level collocations (Band 7.0+).`;

  const prompt = `
    Current IELTS Question: "${currentQuestion || ""}"
    Candidate's Vietnamese Input: "${vietnamesePhrase}"

    STRICT RULES:
    - Provide 3 to 5 advanced C1/C2 English collocations or phrase chunks matching the candidate's intent.
    - DO NOT write full sentences or model answers. Provide ONLY word combinations/collocations.

    Return ONLY a JSON array matching this schema:
    [
      {
        "phrase": string (e.g., "heavy academic workload"),
        "ipa": string (e.g., "/ˈhev.i ˌæk.əˈdem.ɪk ˈwɜːk.ləʊd/"),
        "meaning": string (Vietnamese translation),
        "note": string (short usage note or context)
      }
    ]
  `;

  const data = await callGeminiWithFallback({
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    },
    systemInstruction,
  });

  return data.json || JSON.parse(data.text);
};

/**
 * 3. Gợi ý Idea Hints & Cấu trúc trả lời
 */
export const generateIdeaHints = async ({ question, history = [] }) => {
  const systemInstruction = `You are an IELTS Speaking Content Coach helping candidates structure their ideas based on their conversation history.`;

  const prompt = `
    IELTS Speaking Question: "${question}"
    Conversation History so far: ${JSON.stringify(history || [])}

    Tasks:
    1. "answerStructure": Provide 3-4 step-by-step structural guidelines tailored to help the candidate expand or clarify their current response.
    2. "prompts": Provide 3 reflective WH-questions to help the candidate brainstorm their next points independently.

    Return ONLY a JSON object matching this schema:
    {
      "answerStructure": [string],
      "prompts": [string]
    }
  `;

  const data = await callGeminiWithFallback({
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    },
    systemInstruction,
  });

  return data.json || JSON.parse(data.text);
};

/**
 * 4. Chấm điểm & Đánh giá tổng hợp (Response bằng Tiếng Việt, phân tách rõ ràng Idea Strategy & Collocations)
 */
export const evaluateSession = async ({ question, targetBand, fullTranscript }) => {
  const systemInstruction = `${STRICT_EXAMINER_INSTRUCTION} Hãy nhận xét hoàn toàn bằng TIẾNG VIỆT dễ hiểu, đi thẳng vào vấn đề và mang tính xây dựng cao.`;

  const prompt = `
    Target Band: ${targetBand || "7.0"}
    IELTS Question: "${question}"
    Full Conversation Transcript: ${JSON.stringify(fullTranscript)}

    YÊU CẦU ĐÁNH GIÁ (Trả về hoàn toàn bằng TIẾNG VIỆT trong phần feedback):
    1. Band Scores: Chấm điểm 4 tiêu chí. Nếu dữ liệu đầu vào là dạng Text (chưa phải Audio/Voice), hãy đặt "pronunciation": null.
    2. Idea Strategy Feedback (Tư duy phát triển ý):
       - Đóng vai Giám khảo phân tích xem câu trả lời đã thuyết phục chưa.
       - Chỉ ra các điểm logic bị "hổng" (ví dụ: Giám khảo sẽ thắc mắc điều gì nếu candidate dừng ở ý đó?).
       - Hướng dẫn cách kết nối ví dụ quay trở lại trả lời đúng trọng tâm câu hỏi chính.
    3. Grammar Corrections (Chỉ tập trung vào LỖI NGỮ PHÁP thuần túy):
       - Lỗi cấu trúc, mệnh đề quan hệ, sai dạng động từ (ví dụ: make + O + bare V).
    4. Advanced Collocations & Vocabulary (Nâng cấp từ vựng & Diễn đạt tự nhiên):
       - Trích xuất các cụm từ user dùng chưa tự nhiên và đề xuất Collocation chuẩn Band 7.0+ để user dễ lưu lại học.
    5. Upgraded Model Answer: Viết lại bài mẫu hoàn chỉnh Band 7.0+ dựa đúng trên ý tưởng thực tế của candidate.
    6. Coherence & Idea Development: Nhận xét mạch logic, discourse markers, lặp từ và cách mở rộng câu.
    7. Strict Fluency & Coherence scoring:
       - Nếu bài lặp cấu trúc nối ý như "First...", "Another..." hoặc lặp một từ vựng như "reduce", "think" quá 2 lần, hoặc ý bị đứt đoạn/ngập ngừng, điểm fluencyAndCoherence KHÔNG ĐƯỢC vượt quá 6.5.
       - Phân biệt lỗi nhỏ với lỗi lặp lại có hệ thống; không nâng điểm chỉ vì bài có đủ độ dài.
       - Chấm theo band descriptor thực tế và trừ khoảng 0.5 band khi bằng chứng nằm sát ranh giới, không làm tròn lên để động viên.
    ${INCREMENTAL_MODEL_ANSWER_RULES}

    Return ONLY a JSON object matching this schema:
    {
      "scores": {
        "fluencyAndCoherence": number,
        "lexicalResource": number,
        "grammaticalRange": number,
        "pronunciation": number | null,
        "overall": number
      },
      "ideaStrategyFeedback": {
        "analysis": "Đánh giá cách phát triển ý của bài nói bằng tiếng Việt",
        "examinerMindset": "Giám khảo nghĩ gì khi nghe câu trả lời này? (Ví dụ: 'Ủa vậy môn đó nâng cao tư duy ra sao?')",
        "actionableTip": "Lời khuyên cụ thể để khắc phục"
      },
      "coherenceFeedback": {
        "statusTag": "Trạng thái mạch lạc ngắn gọn",
        "analysis": "Phân tích mạch logic, từ nối và phát triển ý bằng tiếng Việt",
        "actionableTip": "Một lời khuyên cụ thể bằng tiếng Việt"
      },
      "criteriaFeedback": {
        "fluencyAndCoherence": "Nhận xét chi tiết bằng Tiếng Việt",
        "lexicalResource": "Nhận xét chi tiết bằng Tiếng Việt",
        "grammaticalRange": "Nhận xét chi tiết bằng Tiếng Việt"
      },
      "grammarCorrections": [
        {
          "original": "câu/cụm từ lỗi",
          "corrected": "câu/cụm từ đã sửa",
          "explanation": "giải thích chi tiết bằng Tiếng Việt"
        }
      ],
      "collocationUpgrades": [
        {
          "original": "cụm từ diễn đạt chưa tự nhiên",
          "upgrade": "Collocation tự nhiên chuẩn native",
          "meaning": "Nghĩa tiếng Việt",
          "example": "Ví dụ ứng dụng"
        }
      ],
      "upgradedModelAnswer": "Bài mẫu tiếng Anh được sửa và nâng cấp trực tiếp trên bài gốc, không phải một bài mới"
    }
  `;

  const data = await callGeminiWithFallback({
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    },
    systemInstruction,
  });

  const llmResult = data.json || JSON.parse(data.text);
  return {
    bandScores: {
      fluencyCoherence: applyStrictFluencyCap(
        llmResult.scores?.fluencyAndCoherence ?? 0,
        fullTranscript,
      ),
      lexicalResource: llmResult.scores?.lexicalResource ?? 0,
      grammarAccuracy: llmResult.scores?.grammaticalRange ?? 0,
      pronunciation: null,
      overall: llmResult.scores?.overall ?? 0,
    },
    strategyFeedback: {
      examinerPerspective: llmResult.ideaStrategyFeedback?.examinerMindset || llmResult.ideaStrategyFeedback?.analysis || "",
      actionableAdvice: llmResult.ideaStrategyFeedback?.actionableTip || "",
    },
    coherenceFeedback: llmResult.coherenceFeedback,
    grammarCorrections: llmResult.grammarCorrections || [],
    lexicalUpgrades: llmResult.collocationUpgrades || [],
    pronunciationFeedback: [],
    fluencyFeedback: { pacingAndPauses: "", chunkingTip: "" },
    sampleAnswer: llmResult.upgradedModelAnswer || "",
  };
};

/**
 * 1. Thuật toán tính toán độ ngắt nghỉ (Pause Detection) từ Word Timestamps
 */
const analyzeFluencyPauses = (words) => {
  if (!words || words.length < 2) return [];

  const pauses = [];
  for (let i = 0; i < words.length - 1; i++) {
    const currentWordEnd = words[i].end;
    const nextWordStart = words[i + 1].start;
    const gap = nextWordStart - currentWordEnd; // Đơn vị: Giây (s)

    if (gap >= 1.2) {
      // Ngắt dài (Lỗi nặng/trung bình)
      pauses.push({
        afterWord: words[i].word,
        gapSeconds: Number(gap.toFixed(2)),
        type: 'LONG_PAUSE', // Vẽ vạch/dấu đỏ trên UI
      });
    } else if (gap >= 0.5) {
      // Ngắt vừa
      pauses.push({
        afterWord: words[i].word,
        gapSeconds: Number(gap.toFixed(2)),
        type: 'MEDIUM_PAUSE', // Vẽ vạch/dấu vàng trên UI
      });
    }
  }

  return pauses;
};

/**
 * 2. Pipeline xử lý Audio + LLM Parallel Processing
 */
export const evaluateAudioSession = async ({ audioBuffer, mimeType, question, targetBand, history }) => {
  // --- BƯỚC 1: Gọi Groq Cloud Whisper API để Speech-to-Text & Lấy Timestamps ---
  // Tạo File object từ Buffer để gửi cho Groq SDK
  const audioFile = new File([audioBuffer], 'speaking_session.webm', { type: mimeType || 'audio/webm' });

  const transcription = await groq.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-large-v3',
    response_format: 'verbose_json', // Yêu cầu trả về thông tin chi tiết từng từ & timestamp
    timestamp_granularities: ['word'],
    language: 'en',
  });

  const fullTranscript = transcription.text;
  const wordTimestamps = transcription.words || []; // Array: [{ word, start, end }]
  
  // Phân tích độ ngắt nghỉ cho UI Fluency
  const pauseAnalysis = analyzeFluencyPauses(wordTimestamps);

  // --- BƯỚC 2: Gọi Gemini LLM chấm điểm Ngữ nghĩa (Text Evaluation) ---
  const systemInstruction = `${STRICT_EXAMINER_INSTRUCTION} Nhận xét hoàn toàn bằng TIẾNG VIỆT dễ hiểu, đi thẳng vào vấn đề và mang tính xây dựng.`;

  const prompt = `
    Target Band: ${targetBand || "7.0"}
    IELTS Question: "${question}"
    Full Conversation History: ${JSON.stringify(history || [])}
    Final Transcribed Candidate Answer: "${fullTranscript}"

    YÊU CẦU ĐÁNH GIÁ (Trả về hoàn toàn bằng TIẾNG VIỆT):
    1. Scores: Chấm điểm các tiêu chí (0.0 - 9.0). Chấm Pronunciation theo Intelligibility: chỉ phạt khi lỗi phát âm làm người nghe hiểu nhầm/không nhận diện được từ. Bỏ qua elision và weak forms tự nhiên khi nói nhanh.
    2. Idea Strategy Feedback (Tư duy phát triển ý):
       - Góc nhìn Giám khảo: Giám khảo thắc mắc/chưa hài lòng điều gì? (vd: 'Môn đó giúp nâng cao tư duy ra sao?').
       - Hướng dẫn cải thiện cụ thể.
    3. Grammar Corrections: Sửa các lỗi NGỮ PHÁP thuần túy.
    3. Coherence & Idea Development: Đánh giá mạch logic, discourse markers, lặp từ và cách nối/mở rộng câu.
    4. Advanced Collocations: Trích xuất cụm từ chưa tự nhiên và đề xuất Collocation chuẩn Band 7.0+.
    5. Pronunciation Feedback:
       - Dựa trên transcript, chọn các từ/cụm từ candidate có khả năng phát âm sai hoặc cần chú ý trọng âm.
       - Với mỗi mục, trả về từ, IPA chuẩn, lỗi thường gặp, mẹo sửa bằng tiếng Việt và severity là "CRITICAL" nếu ảnh hưởng nghĩa hoặc "MINOR" nếu chỉ là lỗi nhẹ/trọng âm.
    6. Fluency Chunking:
       - Đề xuất cách chia câu trả lời thành các Thought Groups tự nhiên để candidate luyện ngắt nhịp.
    7. Strict Fluency & Coherence scoring:
       - Nếu bài lặp cấu trúc nối ý như "First...", "Another..." hoặc lặp một từ vựng như "reduce", "think" quá 2 lần, hoặc khoảng dừng/ngập ngừng làm đứt mạch câu, điểm fluencyAndCoherence KHÔNG ĐƯỢC vượt quá 6.5.
       - Dùng word timestamps và pause analysis làm bằng chứng, nhưng không phạt các khoảng dừng tự nhiên giữa Thought Groups.
       - Bám sát Band Descriptors, chấm bảo thủ hơn khoảng 0.5 band ở vùng ranh giới và không cho điểm động viên.
    ${INCREMENTAL_MODEL_ANSWER_RULES}

    Return ONLY JSON:
    {
      "scores": {
        "fluencyAndCoherence": number,
        "lexicalResource": number,
        "grammaticalRange": number,
        "pronunciation": number,
        "overall": number
      },
      "ideaStrategyFeedback": {
        "examinerMindset": "Góc nhìn Giám khảo bằng tiếng Việt",
        "analysis": "Phân tích cách triển khai ý",
        "actionableTip": "Lời khuyên thực thi"
      },
      "coherenceFeedback": {
        "statusTag": "Trạng thái mạch lạc ngắn gọn",
        "analysis": "Phân tích coherence bằng tiếng Việt",
        "actionableTip": "Lời khuyên cụ thể bằng tiếng Việt"
      },
      "grammarCorrections": [
        { "original": "...", "corrected": "...", "explanation": "..." }
      ],
      "collocationUpgrades": [
        { "original": "...", "upgrade": "...", "meaning": "...", "example": "..." }
      ],
      "pronunciationFeedback": [
        { "word": "...", "ipa": "...", "issue": "Lỗi phát âm/trọng âm cần chú ý bằng tiếng Việt", "tip": "Mẹo luyện phát âm bằng tiếng Việt", "severity": "CRITICAL" }
      ],
      "fluencyChunkingTip": "Hướng dẫn ngắt nhịp theo Thought Groups cho chính câu trả lời này bằng tiếng Việt",
      "upgradedModelAnswer": "Bài mẫu tiếng Anh được sửa và nâng cấp trực tiếp trên bài gốc, không phải một bài mới"
    }
  `;

  const geminiResponse = await callGeminiWithFallback({
    contents: prompt,
    config: { responseMimeType: "application/json" },
    systemInstruction,
  });

  const llmResult = geminiResponse.json || JSON.parse(geminiResponse.text);

  // --- BƯỚC 3: Tổng hợp kết quả từ Audio Analysis và LLM ---
  const longPauseCount = pauseAnalysis.filter((pause) => pause.type === "LONG_PAUSE").length;
  const mediumPauseCount = pauseAnalysis.filter((pause) => pause.type === "MEDIUM_PAUSE").length;

  let pacingText = "Tốc độ nói của bạn khá tự nhiên và giữ được nhịp ổn định.";
  if (longPauseCount > 0) {
    pacingText = `Bài nói có ${longPauseCount} khoảng dừng dài (>1.2s) và ${mediumPauseCount} khoảng dừng vừa. Hãy chú ý nối ý mượt mà hơn để tránh bị khựng.`;
  } else if (mediumPauseCount > 2) {
    pacingText = `Bài nói có ${mediumPauseCount} khoảng dừng ngắn. Điều này giúp ngắt nhịp tự nhiên nhưng cần tránh ngắt giữa các cụm danh từ/động từ liền mạch.`;
  }

  return {
    transcript: fullTranscript,
    wordTimestamps, // Dữ liệu thô để render chuỗi từ trên UI
    pauseAnalysis,  // Vị trí các khoảng dừng để render vạch xám/vàng/đỏ
    bandScores: {
      fluencyCoherence: applyStrictFluencyCap(
        llmResult.scores?.fluencyAndCoherence ?? 0,
        fullTranscript,
        pauseAnalysis,
      ),
      lexicalResource: llmResult.scores?.lexicalResource ?? 0,
      grammarAccuracy: llmResult.scores?.grammaticalRange ?? 0,
      pronunciation: llmResult.scores?.pronunciation ?? null,
      overall: llmResult.scores?.overall ?? 0,
    },
    strategyFeedback: {
      examinerPerspective:
        llmResult.ideaStrategyFeedback?.examinerMindset ||
        llmResult.ideaStrategyFeedback?.analysis ||
        "",
      actionableAdvice: llmResult.ideaStrategyFeedback?.actionableTip || "",
    },
    coherenceFeedback: llmResult.coherenceFeedback,
    grammarCorrections: llmResult.grammarCorrections || [],
    lexicalUpgrades: llmResult.collocationUpgrades || [],
    pronunciationFeedback: llmResult.pronunciationFeedback || [],
    fluencyFeedback: {
      pacingAndPauses: pacingText,
      chunkingTip:
        llmResult.fluencyChunkingTip ||
        "Nên ngắt hơi theo từng cụm ý nghĩa (Thought groups) thay vì dừng đột ngột giữa câu.",
    },
    sampleAnswer: llmResult.upgradedModelAnswer || "",
  };
};