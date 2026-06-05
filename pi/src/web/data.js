/**
 * Simple JSON file-based data store for tasks and habits.
 * Data persists in ~/little-gamers-ninja/pi/data/
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function load(file) {
  const path = join(DATA_DIR, file);
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

function save(file, data) {
  writeFileSync(join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// --- Tasks ---

function loadTasks() { return load('tasks.json') || []; }
function saveTasks(tasks) { save('tasks.json', tasks); }

export function getTasks() {
  carryOverTasks();
  return loadTasks();
}

// Move uncompleted tasks from past days to today + recreate recurring tasks
function carryOverTasks() {
  const tasks = loadTasks();
  const t = today();
  let changed = false;
  const newTasks = [];

  for (const task of tasks) {
    // Carry over uncompleted tasks
    if (!task.done && task.date && task.date < t) {
      task.date = t;
      changed = true;
    }
    // Recreate recurring tasks for today
    if (task.repeat && task.done && task.date && task.date < t) {
      const dow = new Date().getDay(); // 0=Sun
      const shouldCreate =
        task.repeat === 'daily' ||
        (task.repeat === 'weekdays' && dow >= 1 && dow <= 5) ||
        (task.repeat === 'weekly' && new Date(task.date).getDay() === dow);

      if (shouldCreate) {
        // Check if we already created today's instance
        const exists = tasks.some(tt => tt.text === task.text && tt.date === t && !tt.done);
        if (!exists) {
          newTasks.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            text: task.text,
            done: false,
            workspace: task.workspace,
            deadline: null,
            priority: task.priority,
            date: t,
            repeat: task.repeat,
            createdAt: Date.now(),
            completedAt: null,
          });
          changed = true;
        }
      }
    }
  }

  if (newTasks.length > 0) tasks.push(...newTasks);
  if (changed) saveTasks(tasks);
}

export function addTask(text, deadline = null, workspace = 'default', priority = 2, date = null, repeat = null) {
  const tasks = loadTasks();
  const task = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text,
    done: false,
    workspace,
    deadline,
    priority,
    date: date || today(),
    repeat, // null, 'daily', 'weekdays', 'weekly'
    createdAt: Date.now(),
    completedAt: null,
  };
  tasks.push(task);
  saveTasks(tasks);
  return task;
}

export function updateTask(id, updates) {
  const tasks = loadTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx < 0) return null;
  Object.assign(tasks[idx], updates);
  if (updates.done && !tasks[idx].completedAt) tasks[idx].completedAt = Date.now();
  saveTasks(tasks);
  return tasks[idx];
}

export function deleteTask(id) {
  const tasks = loadTasks();
  const filtered = tasks.filter(t => t.id !== id);
  if (filtered.length === tasks.length) return false;
  saveTasks(filtered);
  return true;
}

export function getWorkspaces() {
  const tasks = loadTasks();
  return [...new Set(tasks.map(t => t.workspace))].sort();
}

// --- Habits ---

function loadHabits() { return load('habits.json') || []; }
function saveHabits(habits) { save('habits.json', habits); }

function today() { return new Date().toISOString().slice(0, 10); }

export function getHabits(date = null) {
  const habits = loadHabits();
  const t = date || today();
  return habits.map(h => {
    return {
      ...h,
      checkedOnDate: h.checks?.includes(t) || false,
      streak: calcStreak(h.checks || []),
    };
  });
}

export function addHabit(name, days = [0,1,2,3,4,5,6]) {
  const habits = loadHabits();
  const habit = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    days, // 0=Mon, 1=Tue, ... 6=Sun
    checks: [],
    createdAt: Date.now(),
  };
  habits.push(habit);
  saveHabits(habits);
  return habit;
}

export function updateHabit(id, updates) {
  const habits = loadHabits();
  const habit = habits.find(h => h.id === id);
  if (!habit) return null;
  if (updates.name !== undefined) habit.name = updates.name;
  if (updates.days !== undefined) habit.days = updates.days;
  saveHabits(habits);
  return habit;
}

export function checkHabit(id, date = null) {
  const habits = loadHabits();
  const habit = habits.find(h => h.id === id);
  if (!habit) return null;
  const t = date || today();
  if (!habit.checks) habit.checks = [];
  if (!habit.checks.includes(t)) {
    habit.checks.push(t);
    habit.checks.sort();
  }
  saveHabits(habits);
  return { ...habit, streak: calcStreak(habit.checks) };
}

export function uncheckHabit(id, date = null) {
  const habits = loadHabits();
  const habit = habits.find(h => h.id === id);
  if (!habit) return null;
  const t = date || today();
  habit.checks = (habit.checks || []).filter(d => d !== t);
  saveHabits(habits);
  return { ...habit, streak: calcStreak(habit.checks) };
}

export function deleteHabit(id) {
  const habits = loadHabits();
  const filtered = habits.filter(h => h.id !== id);
  if (filtered.length === habits.length) return false;
  saveHabits(filtered);
  return true;
}

// --- Focus Sessions ---

function loadSessions() { return load('focus_sessions.json') || []; }
function saveSessions(sessions) { save('focus_sessions.json', sessions); }

export function addFocusSession(durationMinutes) {
  const sessions = loadSessions();
  sessions.push({ date: today(), duration: durationMinutes, time: Date.now() });
  saveSessions(sessions);
}

export function getFocusStats() {
  const sessions = loadSessions();
  const t = today();
  const focusToday = sessions.filter(s => s.date === t).reduce((a, s) => a + s.duration, 0);

  // Get Monday of current week
  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7; // Mon=0
  const monday = new Date(now);
  monday.setDate(monday.getDate() - dayOfWeek);
  const mondayStr = monday.toISOString().slice(0, 10);

  const weekSessions = sessions.filter(s => s.date >= mondayStr);
  const focusWeek = weekSessions.reduce((a, s) => a + s.duration, 0);

  // Per-day breakdown for the week
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const ds = d.toISOString().slice(0, 10);
    const m = weekSessions.filter(s => s.date === ds).reduce((a, s) => a + s.duration, 0);
    weekDays.push({ date: ds, m });
  }

  // All-time stats
  const focusTotal = sessions.reduce((a, s) => a + s.duration, 0);
  const totalSessions = sessions.length;

  return { focusToday, focusWeek, focusTotal, totalSessions, weekDays };
}

// --- Conversation Log ---

export function getConversationLog() {
  return load('conversations.json') || [];
}

export function addConversation(user, ninja) {
  const log = getConversationLog();
  log.push({ time: Date.now(), user, ninja });
  if (log.length > 100) log.splice(0, log.length - 100);
  save('conversations.json', log);
  return log;
}

function calcStreak(checks, days = [0,1,2,3,4,5,6]) {
  if (!checks || checks.length === 0) return 0;
  const checkSet = new Set(checks);
  let streak = 0;
  const d = new Date();

  // Walk backwards from today, only counting scheduled days
  for (let i = 0; i < 400; i++) {
    const ds = d.toISOString().slice(0, 10);
    const dow = (d.getDay() + 6) % 7; // 0=Mon

    if (days.includes(dow)) {
      if (checkSet.has(ds)) {
        streak++;
      } else if (i === 0) {
        // Today not checked yet — don't break streak, just skip
      } else {
        break;
      }
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
