import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_SUFFIX = `

Output format — STRICT JSON only, no markdown:
{"text":"your reply here","mood":"face_state"}

Valid moods: idle, happy, sad, angry, surprised, sleeping, confused, focused, scared`;

function loadPrompt() {
  // Try user-customized personality first, then default
  const userPath = join(__dirname, '../../data/personality.md');
  const defaultPath = join(__dirname, '../personality/ninja-base.md');
  try {
    return readFileSync(userPath, 'utf-8').trim() + SYSTEM_SUFFIX;
  } catch {
    try {
      return readFileSync(defaultPath, 'utf-8').trim() + SYSTEM_SUFFIX;
    } catch {
      return 'You are a ninja desk companion. Reply in 1-2 sentences.' + SYSTEM_SUFFIX;
    }
  }
}

const conversationHistory = [];
const MAX_HISTORY = 3; // keep last 3 exchanges (6 messages) for speed

// Reuse client instance
let client = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return client;
}

/**
 * Stream Claude response sentence by sentence.
 * Calls onSentence(sentenceText) for each sentence as it completes.
 * Returns { fullText, mood } when done.
 */
export async function respondStreaming(userText, onSentence) {
  if (!ANTHROPIC_API_KEY) {
    logger.error('ANTHROPIC_API_KEY not set');
    return null;
  }

  try {
    const startTime = Date.now();

    conversationHistory.push({ role: 'user', content: userText });
    if (conversationHistory.length > MAX_HISTORY * 2) {
      conversationHistory.splice(0, 2);
    }

    const stream = getClient().messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: loadPrompt(),
      messages: conversationHistory,
    });

    let fullRaw = '';
    let textBuffer = '';
    let insideJson = false;
    let insideText = false;
    let sentenceBuffer = '';
    let sentenceCount = 0;

    stream.on('text', (chunk) => {
      fullRaw += chunk;

      // Track JSON structure to extract just the "text" value
      for (const ch of chunk) {
        if (!insideJson && ch === '{') {
          insideJson = true;
          continue;
        }
        if (!insideJson) continue;

        textBuffer += ch;

        // Detect "text":" or "text": " pattern to start capturing
        if (!insideText && /\"text\":\s*\"/.test(textBuffer)) {
          insideText = true;
          sentenceBuffer = '';
          textBuffer = '';
          continue;
        }

        if (insideText) {
          // Check for end of text value (unescaped quote)
          if (ch === '"' && !textBuffer.endsWith('\\"')) {
            // Flush remaining sentence
            if (sentenceBuffer.trim()) {
              onSentence(sentenceBuffer.trim());
              sentenceCount++;
            }
            insideText = false;
            continue;
          }

          sentenceBuffer += ch;

          // Check for sentence boundary: space after sentence-ending character
          // Handle both English and Japanese sentence enders
          const trimmed = sentenceBuffer.trim();
          if (trimmed.length > 5 && /[.!?。！？]\s/.test(sentenceBuffer)) {
            const match = sentenceBuffer.match(/^(.*?[.!?。！？])\s(.*)$/);
            if (match) {
              onSentence(match[1].trim());
              sentenceCount++;
              sentenceBuffer = match[2];
            }
          }
        }
      }
    });

    const finalMessage = await stream.finalMessage();
    const duration = Date.now() - startTime;
    logger.info({ raw: fullRaw.substring(0, 80), duration, sentences: sentenceCount }, 'LLM streamed');

    // Parse mood from full response
    let mood = 'idle';
    try {
      const cleaned = fullRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      mood = parsed.mood || 'idle';
    } catch {}

    conversationHistory.push({ role: 'assistant', content: fullRaw });
    return { mood };
  } catch (e) {
    logger.error({ err: e.message }, 'Claude stream failed');
    return null;
  }
}
