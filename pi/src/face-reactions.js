/**
 * Face reaction mappings — maps events to animation choices.
 * Picks randomly from arrays for variety.
 */

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Task events
export function taskComplete() { return pick(['happy', 'hehe']); }
export function allTasksDone() { return pick(['surprised', 'happy']); }
export function taskAdded() { return 'focused'; }

// Habit events
export function habitChecked() { return pick(['hehe', 'happy']); }
export function allHabitsDone() { return pick(['surprised', 'happy']); }
export function streakMilestone() { return 'surprised'; }

// Focus events
export function focusStart() { return 'focused'; }
export function focusComplete() { return pick(['surprised', 'happy']); }
export function breakStart() { return pick(['happy', 'idle']); }

// Angry keywords in voice response
export function angryReaction() { return pick(['angry', 'yell']); }

// Voice pipeline
export function wakeWordDetected() { return 'surprised'; }
export function listening() { return 'focused'; }
export function thinking() { return 'confused'; }
export function speaking() { return 'talking'; }

// Conversation moods from Claude
const MOOD_MAP = {
  idle: 'idle',
  happy: 'happy',
  sad: 'sad',
  angry: 'angry',
  surprised: 'surprised',
  sleeping: 'sleeping',
  confused: 'confused',
  focused: 'focused',
  scared: 'scared',
  talking: 'talking',
};

export function moodFace(mood) {
  if (mood === 'confused') return pick(['dizzy', 'confused']);
  return MOOD_MAP[mood] || mood;
}

// Idle — used by idle-behaviors.js (directory names for playOnce)
export const FUN_ANIMS = ['ninja_happy', 'ninja_surprised', 'ninja_dizzy', 'smile', 'ninja_confused'];
export const QUICK_FACES = [
  { state: 'ninja_dizzy', duration: 1500 },
  { state: 'ninja_surprised', duration: 800 },
  { state: 'smile', duration: 1200 },
  { state: 'ninja_scared', duration: 1000 },
  { state: 'ninja_happy', duration: 1000 },
];

// Angry keywords to detect in responses
export const ANGRY_KEYWORDS = ['stupid', 'stop', 'shut up', 'idiot', 'dumb', 'hate', 'ugly', 'useless', 'バカ', 'うるさい'];

export function hasAngryKeyword(text) {
  const lower = text.toLowerCase();
  return ANGRY_KEYWORDS.some(k => lower.includes(k));
}
