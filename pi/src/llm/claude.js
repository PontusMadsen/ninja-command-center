import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

let systemPrompt = '';
try {
  systemPrompt = readFileSync(join(__dirname, '../personality/ninja-base.md'), 'utf-8');
} catch (e) {
  systemPrompt = 'You are a ninja desk companion. Reply in 1-2 sentences. Output JSON: {"text":"...","mood":"idle"}';
}

const conversationHistory = [];
const MAX_HISTORY = 5;

/**
 * Send user text to Claude Haiku. Returns { text, mood } or null on failure.
 */
export async function respond(userText, context = {}) {
  if (!ANTHROPIC_API_KEY) {
    logger.error('ANTHROPIC_API_KEY not set');
    return null;
  }

  try {
    const startTime = Date.now();
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    conversationHistory.push({ role: 'user', content: userText });
    if (conversationHistory.length > MAX_HISTORY * 2) {
      conversationHistory.splice(0, 2);
    }

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: systemPrompt,
      messages: conversationHistory,
    });

    const raw = response.content[0].text;
    const duration = Date.now() - startTime;
    logger.info({ raw: raw.substring(0, 80), duration }, 'LLM response');

    // Try to parse JSON response (strip markdown code blocks if present)
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      conversationHistory.push({ role: 'assistant', content: raw });
      return { text: parsed.text || raw, mood: parsed.mood || 'idle' };
    } catch {
      // If not JSON, use raw text
      conversationHistory.push({ role: 'assistant', content: raw });
      return { text: raw, mood: 'idle' };
    }
  } catch (e) {
    logger.error({ err: e.message }, 'Claude failed');
    return null;
  }
}
