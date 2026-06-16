import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';
import { TOOLS, executeTool } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_SUFFIX = `

Output format — STRICT JSON only, no markdown:
{"text":"your reply here","mood":"face_state"}

Valid moods: idle, happy, sad, angry, surprised, sleeping, confused, focused, scared

You have tools available. Use them when the user asks you to do things like add tasks, switch screens, check habits, etc. After using a tool, respond naturally about what you did.`;

function loadPrompt() {
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
const MAX_HISTORY = 3;

let client = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return client;
}

/**
 * Send message to Claude with tool support.
 * Calls onSentence(sentenceText) for each sentence.
 * Returns { mood } when done.
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

    // First call — may include tool use
    let response = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: loadPrompt(),
      messages: conversationHistory,
      tools: TOOLS,
    });

    // Handle tool use loop (Claude may call multiple tools)
    while (response.stop_reason === 'tool_use') {
      const toolResults = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const result = await executeTool(block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }

      conversationHistory.push({ role: 'assistant', content: response.content });
      conversationHistory.push({ role: 'user', content: toolResults });

      // Get Claude's response after tool execution
      response = await getClient().messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: loadPrompt(),
        messages: conversationHistory,
      });
    }

    // Extract text from final response
    let fullRaw = '';
    for (const block of response.content) {
      if (block.type === 'text') fullRaw += block.text;
    }

    const duration = Date.now() - startTime;

    // Parse JSON response
    let textContent = '';
    let mood = 'idle';
    try {
      const cleaned = fullRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      textContent = parsed.text || '';
      mood = parsed.mood || 'idle';
    } catch {
      textContent = fullRaw;
    }

    // Split into sentences and deliver via onSentence
    let sentenceCount = 0;
    const sentences = textContent.match(/[^.!?。！？]+[.!?。！？]+/g) || [textContent];
    for (const s of sentences) {
      const trimmed = s.trim();
      if (trimmed) {
        onSentence(trimmed);
        sentenceCount++;
      }
    }

    logger.info({ raw: fullRaw.substring(0, 80), duration, sentences: sentenceCount }, 'LLM done');

    conversationHistory.push({ role: 'assistant', content: fullRaw });
    return { mood };
  } catch (e) {
    logger.error({ err: e.message }, 'Claude failed');
    return null;
  }
}
