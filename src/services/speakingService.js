import { callGroqWithFallback } from '../lib/groq.js';
import Groq, { toFile } from 'groq-sdk';

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
 * 1. Xử lý phản hồi của User & Đưa ra Follow-up (Dựa trên ngữ nghĩa & độ sâu câu trả lời)
 */
export const processChatStep = async ({ question, targetBand, history, userResponse }) => {
  const systemInstruction = `You are an official, highly professional IELTS Speaking Examiner for Part 1. Keep your prompts clean, concise, and natural.
STRICT JSON OUTPUT REQUIREMENT:
Return ONLY a valid JSON object matching this schema (No markdown codeblocks):
{
  "needsFollowUp": boolean,
  "followUpQuestion": string
}`;

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
  `.trim();

  return callGroqWithFallback({
    prompt,
    systemInstruction,
    temperature: 0.2,
  });
};

/**
 * 2. Gợi ý Collocations từ Tiếng Việt (KHÔNG viết toàn bộ câu)
 */
export const generateCollocations = async ({ vietnamesePhrase, currentQuestion, targetBand }) => {
  const systemInstruction = `You are an IELTS Speaking Vocabulary Coach specializing in natural collocations (Band ${targetBand || "7.0"}+).
STRICT JSON OUTPUT REQUIREMENT:
Return ONLY a valid JSON array matching this schema (No markdown codeblocks):
[
  {
    "phrase": "heavy academic workload",
    "ipa": "/ˈhev.i ˌæk.əˈdem.ɪk ˈwɜːk.ləʊd/",
    "meaning": "khối lượng học tập nặng nề",
    "note": "short usage note or context"
  }
]`;

  const prompt = `
Target Band: ${targetBand || "7.0"}
Current IELTS Question: "${currentQuestion || ""}"
Candidate's Vietnamese Input: "${vietnamesePhrase}"

STRICT RULES:
- Provide 1 to 3 most natural English collocations or phrase chunks matching the candidate's intent.
- DO NOT write full sentences or model answers. Provide ONLY word combinations/collocations.
  `.trim();

  return callGroqWithFallback({
    prompt,
    systemInstruction,
    temperature: 0.2,
  });
};

/**
 * 3. Gợi ý Idea Hints & Cấu trúc trả lời
 */
export const generateIdeaHints = async ({ question, history = [] }) => {
  const systemInstruction = `You are an IELTS Speaking Content Coach helping candidates structure their ideas based on their conversation history.
STRICT JSON OUTPUT REQUIREMENT:
Return ONLY a valid JSON object matching this schema (No markdown codeblocks):
{
  "answerStructure": ["step 1...", "step 2..."],
  "prompts": ["question 1...", "question 2..."]
}`;

  const prompt = `
IELTS Speaking Question: "${question}"
Conversation History so far: ${JSON.stringify(history || [])}

Tasks:
1. "answerStructure": Provide 3-4 step-by-step structural guidelines tailored to help the candidate expand or clarify their current response.
2. "prompts": Provide 3 reflective WH-questions to help the candidate brainstorm their next points independently.
  `.trim();

  return callGroqWithFallback({
    prompt,
    systemInstruction,
    temperature: 0.2,
  });
};

/**
 * 1. Thuật toán tính toán độ ngắt nghỉ (Pause Detection) từ Word Timestamps
 */
const analyzeFluencyPauses = (words) => {
  if (!words || words.length < 2) return [];

  const pauses = [];
  
  // Thời lượng tối đa hợp lý cho 1 từ đơn (giây). 
  // Nếu Whisper báo 1 từ kéo dài > 0.9s, khả năng cao 80% phần sau là khoảng lặng.
  const MAX_EXPECTED_WORD_DURATION = 0.85; 

  for (let i = 0; i < words.length - 1; i++) {
    const currentWord = words[i];
    const nextWord = words[i + 1];

    const rawWordDuration = currentWord.end - currentWord.start;
    
    // 1. Ước tính điểm kết thúc thực tế của từ (loại bỏ khoảng lặng bị Whisper nuốt vào)
    let estimatedRealEnd = currentWord.end;
    if (rawWordDuration > MAX_EXPECTED_WORD_DURATION) {
      // Giới hạn thời gian nói của từ, phần còn lại coi như Pause
      estimatedRealEnd = currentWord.start + MAX_EXPECTED_WORD_DURATION;
    }

    // 2. Tính gap thực sự giữa 2 từ
    const realGap = nextWord.start - estimatedRealEnd;

    // Bỏ qua nếu timestamp bị đè (overlap do lặp lại audio)
    if (realGap < 0.4) continue;

    const gapSeconds = Number(realGap.toFixed(2));

    if (gapSeconds >= 1.2) {
      pauses.push({
        afterWord: currentWord.word,
        gapSeconds,
        type: 'LONG_PAUSE', // Ngắt dài (>1.2s)
      });
    } else if (gapSeconds >= 0.5) {
      pauses.push({
        afterWord: currentWord.word,
        gapSeconds,
        type: 'MEDIUM_PAUSE', // Ngắt vừa (0.5s - 1.2s)
      });
    }
  }

  return pauses;
};

/**
 * 2. Pipeline xử lý Audio + LLM Parallel Processing
 */
export const evaluateSpeakingSession = async ({
  question,
  targetBand = "7.0",
  fullTranscript: inputTranscript,
  audioBuffer,
  mimeType = "audio/webm",
}) => {
  const isAudioSession = Boolean(audioBuffer);
  let finalTranscript = inputTranscript || "";
  let wordTimestamps = [];
  let pauseAnalysis = [];
  let lowConfidenceWords = [];

  // ==========================================
  // BƯỚC 1: XỬ LÝ AUDIO VÀ STT (NẾU CÓ FILE AUDIO)
  // ==========================================
  if (isAudioSession && audioBuffer) {
    const apiKeys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    if (!apiKeys.length) {
      throw new Error("Không tìm thấy GROQ_API_KEYS trong biến môi trường");
    }

    const groq = new Groq({ apiKey: apiKeys[0] });
    const fileForGroq = await toFile(audioBuffer, "speaking_session.webm", {
      type: mimeType,
    });

    const transcription = await groq.audio.transcriptions.create({
      file: fileForGroq,
      model: "whisper-large-v3",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
      language: "en",
    });

    finalTranscript = transcription.text;
    wordTimestamps = transcription.words || [];

    // Phân tích khoảng dừng ngắt nghỉ (Fluency) từ timestamps thực tế
    pauseAnalysis = analyzeFluencyPauses(wordTimestamps);

    lowConfidenceWords = (transcription.words || [])
    .filter((w) => w.probability < 0.7)
    .map((w) => w.word);
  }

  // ==========================================
  // BƯỚC 2: BUILD PROMPT DÙNG CHUNG CHO LLM
  // ==========================================
  const systemInstruction = `${STRICT_EXAMINER_INSTRUCTION} Nhận xét hoàn toàn bằng TIẾNG VIỆT dễ hiểu, đi thẳng vào vấn đề và mang tính xây dựng cao.
BẮT BUL BẮT BUỘC trả về duy nhất 1 JSON Object tuân thủ theo đúng Schema sau (Không bọc Markdown codeblock):
{
  "scores": {
    "fluencyAndCoherence": 6.5,
    "lexicalResource": 7.0,
    "grammaticalRange": 6.5,
    "pronunciation": ${isAudioSession ? "7.0" : "null"},
    "overall": 6.8
  },
  "ideaStrategyFeedback": {
    "examinerMindset": "Góc nhìn/Thắc mắc của Giám khảo khi nghe câu trả lời",
    "analysis": "Phân tích cách triển khai ý",
    "actionableTip": "Lời khuyên cải thiện cụ thể"
  },
  "coherenceFeedback": {
    "statusTag": "Trạng thái mạch lạc ngắn gọn",
    "analysis": "Phân tích mạch logic, từ nối và phát triển ý",
    "actionableTip": "Lời khuyên cụ thể"
  },
  "grammarCorrections": [
    { "original": "câu gốc bị lỗi", "corrected": "câu đã sửa", "explanation": "giải thích chi tiết bằng tiếng Việt" }
  ],
  "collocationUpgrades": [
    { "original": "cụm từ chưa tự nhiên", "upgrade": "Collocation chuẩn Band 7.0+", "meaning": "Nghĩa tiếng Việt", "example": "Ví dụ" }
  ],
  "pronunciationFeedback": [
    { "word": "từ phát âm chưa chuẩn", "ipa": "/IPA/", "issue": "Lỗi trọng âm/phát âm cụ thể", "tip": "Cách khắc phục bằng tiếng Việt", "severity": "CRITICAL" }
  ],
  "fluencyChunkingTip": "Hướng dẫn ngắt nhịp theo Thought Groups bằng tiếng Việt",
  "upgradedModelAnswer": "Bài mẫu nâng cấp trực tiếp dựa trên ý tưởng gốc của candidate"
}`;

  const prompt = `
Target Band: ${targetBand}
IELTS Question: "${question}"
Candidate Answer Transcript: "${finalTranscript}"
Data Input Type: ${isAudioSession ? "VOICE_AUDIO (Có dữ liệu âm thanh thực tế)" : "TEXT_ONLY (Chỉ có văn bản)"}

${
  isAudioSession
    ? `=== DỮ LIỆU ÂM THANH THỰC TẾ TỪ WHISPER AUDIO ===
- Các từ bị nghi ngờ phát âm sai/mờ/nuốt âm (Whisper Confidence < 75%): ${
        lowConfidenceWords.length > 0 ? JSON.stringify(lowConfidenceWords) : "Không có (Phát âm khá rõ ràng)"
      }
- Phân tích khoảng dừng (Pauses): Tìm thấy ${pauseAnalysis.filter((p) => p.type === "LONG_PAUSE").length} khoảng dừng dài (>1.2s) và ${pauseAnalysis.filter((p) => p.type === "MEDIUM_PAUSE").length} khoảng dừng vừa.
==================================================`
    : ""
}

YÊU CẦU ĐÁNH GIÁ (Trả về toàn bộ bằng TIẾNG VIỆT):
1. Scores:
   - Chấm điểm các tiêu chí (0.0 - 9.0).
   ${
     isAudioSession
       ? `- Chấm Pronunciation dựa trên độ rõ ràng của từ (dựa theo danh sách từ có độ tự tin thấp bên trên) và khả năng gây hiểu nhầm.`
       : `- Đặt "pronunciation": null vì dữ liệu đầu vào là TEXT_ONLY.`
   }
2. Idea Strategy Feedback (Tư duy phát triển ý):
   - Phân tích góc nhìn Giám khảo: Điểm nào chưa thuyết phục? Giám khảo thắc mắc điều gì?
   - Hướng dẫn kết nối ví dụ/lý do để quay về đúng trọng tâm câu hỏi.
3. Grammar Corrections: Sửa các lỗi NGỮ PHÁP thuần túy (cấu trúc, chia thì, mệnh đề).
4. Advanced Collocations: Trích xuất cụm từ chưa tự nhiên và nâng cấp sang Collocation Band 7.0+.
5. Pronunciation Feedback ${isAudioSession ? "(TẬP TRUNG PHÂN TÍCH)" : "(Bỏ qua nếu là Text)"}:
   ${
     isAudioSession
       ? `- BẮT BUỘC tập trung phân tích các từ nằm trong danh sách "Từ bị nghi ngờ phát âm sai/mờ" ở trên (hoặc các từ dễ sai trọng âm/nuốt âm trong bản transcript). Chỉ rõ lỗi IPA, trọng âm và mẹo sửa.`
       : `- Trả về mảng rỗng [].`
   }
6. Fluency & Coherence Scoring (Chấm điểm chặt chẽ):
   - Kết hợp danh sách các khoảng dừng (Pauses) đã phân tích bên trên: Nếu có quá nhiều khoảng dừng dài hoặc bị lặp cấu trúc/từ vựng, điểm fluencyAndCoherence KHÔNG ĐƯỢC vượt quá 6.5.
   - Trừ khoảng 0.5 band ở vùng ranh giới, không nâng điểm để động viên.
${INCREMENTAL_MODEL_ANSWER_RULES}

Trả về đúng 1 JSON Object.
`.trim();

  // ==========================================
  // BƯỚC 3: GỌI LLM CHẤM ĐIỂM
  // ==========================================
  const llmResult = await callGroqWithFallback({
    prompt,
    systemInstruction,
    temperature: 0.2,
  });

  // ==========================================
  // BƯỚC 4: TỔNG HỢP & NORMALIZE KẾT QUẢ
  // ==========================================
  // Tính toán Pacing/Pause cho Fluency nếu là Audio
  let pacingText = "N/A (Chế độ chấm Văn bản)";
  if (isAudioSession) {
    const longPauseCount = pauseAnalysis.filter((p) => p.type === "LONG_PAUSE").length;
    const mediumPauseCount = pauseAnalysis.filter((p) => p.type === "MEDIUM_PAUSE").length;

    if (longPauseCount > 0) {
      pacingText = `Bài nói có ${longPauseCount} khoảng dừng dài (>1.2s) và ${mediumPauseCount} khoảng dừng vừa. Hãy chú ý liên kết ý mượt mà hơn để tránh ngắt nhịp đứt đoạn.`;
    } else if (mediumPauseCount > 2) {
      pacingText = `Bài nói có ${mediumPauseCount} khoảng dừng ngắn. Việc ngắt nhịp khá tự nhiên nhưng lưu ý không ngắt giữa cụm danh/động từ liền mạch.`;
    } else {
      pacingText = "Tốc độ nói của bạn rất tự nhiên, duy trì được nhịp độ ổn định và lưu hoát.";
    }
  }

  return {
    transcript: finalTranscript,
    wordTimestamps, // Mảng rỗng [] nếu là Text
    pauseAnalysis,  // Mảng rỗng [] nếu là Text
    bandScores: {
      fluencyCoherence: applyStrictFluencyCap(
        llmResult.scores?.fluencyAndCoherence ?? 0,
        finalTranscript,
        pauseAnalysis,
      ),
      lexicalResource: llmResult.scores?.lexicalResource ?? 0,
      grammarAccuracy: llmResult.scores?.grammaticalRange ?? 0,
      pronunciation: isAudioSession ? (llmResult.scores?.pronunciation ?? 0) : null,
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
    pronunciationFeedback: isAudioSession ? (llmResult.pronunciationFeedback || []) : [],
    fluencyFeedback: {
      pacingAndPauses: pacingText,
      chunkingTip:
        llmResult.fluencyChunkingTip ||
        "Nên ngắt hơi theo từng cụm ý nghĩa (Thought groups) thay vì dừng đột ngột giữa câu.",
    },
    sampleAnswer: llmResult.upgradedModelAnswer || "",
  };
};