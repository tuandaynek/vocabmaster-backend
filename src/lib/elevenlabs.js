import axios from 'axios';

export async function generateVocabAudio(text) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY chưa được cấu hình trong .env');
  }

  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.7,
          similarity_boost: 0.8,
          speed: 0.9,
          style: 0.0,
          use_speaker_boost: true,
        },
      },
      {
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        responseType: 'arraybuffer',
      },
    );

    return Buffer.from(response.data).toString('base64');
  } catch (error) {
    const status = error?.response?.status;
    const detail = error?.response?.data;

    if (status === 401) {
      throw new Error('ElevenLabs: API key không hợp lệ, bị vô hiệu hóa hoặc không có quyền TTS.');
    }

    if (status === 402) {
      throw new Error('ElevenLabs: tài khoản hết credit hoặc chưa kích hoạt TTS.');
    }

    if (status === 400) {
      throw new Error(`ElevenLabs: request không hợp lệ. Detail: ${JSON.stringify(detail)}`);
    }

    throw new Error(`ElevenLabs request failed: ${JSON.stringify(detail ?? error?.message ?? {})}`);
  }
}
