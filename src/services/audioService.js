import { generateVocabAudio } from '../lib/elevenlabs.js';
import { supabase } from '../lib/supabase.js';

/**
 * 1. Call ElevenLabs API lấy Buffer audio
 */
export async function fetchAudioBuffer(text) {
  const base64 = await generateVocabAudio(text);
  return Buffer.from(base64, 'base64');
}

/**
 * 2. Hàm tổng quát: Lấy hoặc Tạo + Lưu Audio vào Storage & DB
 * 
 * @param {string} textToSpeech - Đoạn văn bản cần tạo audio (word, collocation, sentence,...)
 * @param {Object} options
 * @param {string} [options.table='global_words'] - Tên bảng DB (vd: 'global_collocations', 'global_words')
 * @param {string} [options.targetField='phrase'] - Cột chứa text để query (vd: 'phrase', 'word', 'text')
 * @param {string|number} [options.recordId] - ID của record cần update audio_url
 * @param {string} [options.bucket='vocab-audios'] - Tên Storage Bucket trên Supabase
 * @param {string} [options.audioColumn='audio_url'] - Tên cột chứa link audio trong DB
 */
export async function ensureAudioUrl(textToSpeech, options = {}) {
  const {
    table = 'global_words',
    targetField = 'phrase',
    recordId = null,
    bucket = 'vocab-audios',
    audioColumn = 'audio_url',
  } = options;

  if (!textToSpeech || !textToSpeech.trim()) {
    throw new Error('Vui lòng cung cấp văn bản để tạo audio.');
  }

  const cleanText = textToSpeech.trim();

  // 1. Kiểm tra Cache trong DB (Ưu tiên check theo recordId, sau đó đến targetField)
  if (recordId) {
    const { data } = await supabase
      .from(table)
      .select(audioColumn)
      .eq('id', recordId)
      .maybeSingle();

    if (data && data[audioColumn]) return data[audioColumn];
  } else {
    const { data } = await supabase
      .from(table)
      .select(`id, ${audioColumn}`)
      .eq(targetField, cleanText)
      .maybeSingle();

    if (data && data[audioColumn]) return data[audioColumn];
  }

  // 2. Tạo Audio từ ElevenLabs & Upload lên Supabase Storage
  const audioBuffer = await fetchAudioBuffer(cleanText);
  
  // Sanitize tên file để tránh lỗi ký tự đặc biệt
  const safeFileName = cleanText
    .toLowerCase()
    .replace(/[^a-z0-9]/gi, '_')
    .slice(0, 50); // Giới hạn độ dài tên file
  const fileName = `${safeFileName}_${Date.now()}.mp3`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(fileName, audioBuffer, { contentType: 'audio/mpeg', upsert: true });

  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(fileName);

  const publicUrl = publicUrlData.publicUrl;

  // 3. Update lại DB nếu có recordId hoặc tìm thấy ID
  if (recordId) {
    await supabase
      .from(table)
      .update({ [audioColumn]: publicUrl })
      .eq('id', recordId);
  }

  return publicUrl;
}