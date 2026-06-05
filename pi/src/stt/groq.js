import logger from '../logger.js';

const GROQ_API_KEY = process.env.GROQ_API_KEY;

/**
 * Transcribe a WAV audio buffer using Groq Whisper API.
 * Returns the transcribed text or null on failure.
 */
export async function transcribe(audioBuffer) {
  if (!GROQ_API_KEY) {
    logger.error('GROQ_API_KEY not set');
    return null;
  }

  try {
    const startTime = Date.now();

    // Build multipart form data manually
    const boundary = '----NinjaBoundary' + Date.now();

    const pre = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`
    );
    const mid = Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n`
    );
    const post = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n--${boundary}--\r\n`
    );

    const body = Buffer.concat([pre, audioBuffer, mid, post]);

    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: body,
    });

    const text = await resp.text();
    const duration = Date.now() - startTime;

    if (!resp.ok) {
      logger.error({ status: resp.status, body: text }, 'Groq STT error');
      return null;
    }

    const trimmed = text.trim();
    logger.info({ text: trimmed, duration }, 'STT result');
    return trimmed || null;
  } catch (e) {
    logger.error({ err: e }, 'Groq STT failed');
    return null;
  }
}
