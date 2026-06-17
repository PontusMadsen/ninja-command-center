/**
 * Claude tool definitions + execution for voice commands.
 */

import logger from '../logger.js';

const BASE = `http://localhost:${process.env.WEB_PORT || 8888}`;

async function apiPost(path, body = {}) {
  const res = await fetch(`${BASE}/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${BASE}/api/${path}`);
  return res.json();
}

async function apiPut(path, body = {}) {
  const res = await fetch(`${BASE}/api/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiDel(path) {
  const res = await fetch(`${BASE}/api/${path}`, { method: 'DELETE' });
  return res.json();
}

// Tool definitions for Claude
export const TOOLS = [
  {
    name: 'play_crossscreen',
    description: 'Play a crossscreen animation across all 3 displays. The ninja runs across all screens. Use when user asks for the ninja run, crossscreen animation, or something cool.',
    input_schema: {
      type: 'object',
      properties: {
        gif: { type: 'string', description: 'GIF filename (default: ninja_run_crossscreen.gif)' },
      },
    },
  },
  {
    name: 'add_task',
    description: 'Add a new task/todo item',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The task text' },
        priority: { type: 'number', description: 'Priority 1-3 (1=high)', default: 2 },
      },
      required: ['text'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as done by searching for it by name',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Text to search for in task names' },
      },
      required: ['search'],
    },
  },
  {
    name: 'list_tasks',
    description: 'Get current tasks for today',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'switch_screen',
    description: 'Change what module is displayed on a screen. Screen 0 = left display, screen 2 = right display. Available modules: clock, spotify, todo, habits, gif',
    input_schema: {
      type: 'object',
      properties: {
        screen: { type: 'number', description: '0 for left screen, 2 for right screen' },
        module: { type: 'string', description: 'Module ID: clock, spotify, todo, habits, gif' },
      },
      required: ['screen', 'module'],
    },
  },
  {
    name: 'check_habit',
    description: 'Mark a habit as done today by searching for it by name',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Text to search for in habit names' },
      },
      required: ['search'],
    },
  },
  {
    name: 'trigger_nudge',
    description: 'Make the ninja say a random nudge/reminder. Optionally specify category: hydration, posture, movement, eyes, break, bored, chaotic, dark_haiku, encouragement',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Nudge category (optional)' },
      },
    },
  },
];

// Tool execution
// Callback for side effects (e.g., updating screen defaults)
let _onScreenSwitch = null;
export function setOnScreenSwitch(fn) { _onScreenSwitch = fn; }

export async function executeTool(name, input) {
  logger.info({ tool: name, input }, 'Executing tool');

  try {
    switch (name) {
      case 'add_task': {
        const result = await apiPost('tasks', { text: input.text, priority: input.priority || 2 });
        return { success: true, task: input.text };
      }

      case 'complete_task': {
        const data = await apiGet('tasks?date=' + new Date().toISOString().slice(0, 10));
        const tasks = data.tasks || [];
        const match = tasks.find(t => !t.done && t.text.toLowerCase().includes(input.search.toLowerCase()));
        if (!match) return { success: false, error: 'Task not found: ' + input.search };
        await apiPut('tasks/' + match.id, { done: true });
        return { success: true, task: match.text };
      }

      case 'list_tasks': {
        const data = await apiGet('tasks?date=' + new Date().toISOString().slice(0, 10));
        const tasks = (data.tasks || []).filter(t => !t.done);
        return { tasks: tasks.map(t => t.text), count: tasks.length };
      }

      case 'switch_screen': {
        await apiPost('screens/' + input.screen, { moduleId: input.module });
        if (_onScreenSwitch) _onScreenSwitch(input.screen, input.module);
        return { success: true, screen: input.screen, module: input.module };
      }

      case 'check_habit': {
        const data = await apiGet('habits?date=' + new Date().toISOString().slice(0, 10));
        const habits = data.habits || [];
        const match = habits.find(h => h.name.toLowerCase().includes(input.search.toLowerCase()));
        if (!match) return { success: false, error: 'Habit not found: ' + input.search };
        await apiPost('habits/' + match.id + '/check', {});
        return { success: true, habit: match.name };
      }

      case 'trigger_nudge': {
        const result = await apiPost('nudges/now', { category: input.category });
        return result;
      }

      case 'play_crossscreen': {
        const result = await apiPost('crossscreen/play', { gif: input.gif });
        return result;
      }

      default:
        return { error: 'Unknown tool: ' + name };
    }
  } catch (e) {
    logger.error({ tool: name, err: e.message }, 'Tool execution failed');
    return { error: e.message };
  }
}
