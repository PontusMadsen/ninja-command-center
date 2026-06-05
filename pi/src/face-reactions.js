/**
 * Face reaction mappings — maps events to animation choices.
 * Picks randomly from arrays for variety.
 */

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Task events
export function taskComplete() { return pick(['love', 'love2', 'happy_2', 'hehe']); }
export function allTasksDone() { return pick(['star', 'wow']); }
export function taskAdded() { return 'squint'; }

// Habit events
export function habitChecked() { return pick(['smile', 'happy_2', 'hehe']); }
export function allHabitsDone() { return pick(['star', 'wow', 'hand_some']); }
export function streakMilestone() { return 'star'; }

// Focus events
export function focusStart() { return 'squint'; }
export function focusComplete() { return pick(['star', 'wow', 'happy_2']); }
export function breakStart() { return pick(['music', 'sakura']); }

// Angry keywords in voice response
export function angryReaction() { return pick(['angry', 'angry2', 'angry3', 'fumin', 'yell']); }

// Voice pipeline
export function wakeWordDetected() { return 'WHAT'; }
export function listening() { return 'WHAT'; }
export function thinking() { return 'squint'; }
export function speaking() { return 'talking'; }

// Conversation moods from Claude
const MOOD_MAP = {
  idle: 'default',
  happy: pick(['smile', 'happy_2', 'hehe']),
  sad: pick(['cry', 'cry2']),
  angry: pick(['angry', 'angry2', 'angry3']),
  surprised: 'WHAT',
  sleeping: 'sleeping',
  confused: pick(['dizzy', 'WHAT']),
  focused: 'squint',
  scared: 'scared',
  talking: 'talking',
};

export function moodFace(mood) {
  // Re-randomize each call for sad/happy/angry
  if (mood === 'happy') return pick(['smile', 'happy_2', 'hehe']);
  if (mood === 'sad') return pick(['cry', 'cry2']);
  if (mood === 'angry') return pick(['angry', 'angry2', 'angry3']);
  if (mood === 'confused') return pick(['dizzy', 'WHAT']);
  return MOOD_MAP[mood] || mood;
}

// Idle — used by idle-behaviors.js
export const FUN_ANIMS = ['up_size_down', 'sakura', 'rain', 'hehe', 'hihi', 'bee', 'wow', 'star', 'hand_some', 'music'];
export const QUICK_FACES = [
  { state: 'dizzy', duration: 1500 },
  { state: 'WHAT', duration: 800 },
  { state: 'smile', duration: 1200 },
  { state: 'scared', duration: 1000 },
  { state: 'happy_2', duration: 1000 },
];

// Angry keywords to detect in responses
export const ANGRY_KEYWORDS = ['stupid', 'stop', 'shut up', 'idiot', 'dumb', 'hate', 'ugly', 'useless', 'バカ', 'うるさい'];

export function hasAngryKeyword(text) {
  const lower = text.toLowerCase();
  return ANGRY_KEYWORDS.some(k => lower.includes(k));
}
