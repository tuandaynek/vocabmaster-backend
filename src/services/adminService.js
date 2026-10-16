import { ensureAudioUrl } from "../utils/audio.js";
import { supabase } from "../lib/supabase.js";
import { callGroqWithFallback } from "../lib/groq.js";

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