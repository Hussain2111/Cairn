// Schema definition, factories and defaults.
//
// SCHEMA_VERSION is bumped whenever the persisted shape changes, and every bump
// gets a migration in migrations.js. Nothing else in the app is allowed to
// assume a shape that isn't produced here.

import { uid } from './ids.js';
import { todayISO, nowStamp } from './dates.js';

export const SCHEMA_VERSION = 4;
export const STORAGE_KEY = 'cairn.state';
export const APP_VERSION = '1.0.0';

export const THREAD_TYPES = ['project', 'study', 'pipeline', 'habit', 'reading'];

export const BANKS = ['sql', 'leetcode', 'gre'];

export const BANK_LABELS = { sql: 'SQL', leetcode: 'LeetCode', gre: 'GRE' };

/** Per-bank extra fields. Same scheduler, different fields. */
export const BANK_FIELDS = {
  sql: [
    { key: 'feature', label: 'SQL feature', type: 'select', options: ['joins', 'aggregation', 'window functions', 'subqueries', 'CTEs', 'set operations', 'indexing', 'other'] },
    { key: 'dialect', label: 'Dialect', type: 'select', options: ['postgres', 'mysql', 'sqlite', 'sql server', 'ansi'] },
  ],
  leetcode: [
    { key: 'pattern', label: 'Pattern', type: 'select', options: ['arrays', 'two pointers', 'sliding window', 'hashing', 'stack', 'binary search', 'linked list', 'trees', 'graphs', 'dynamic programming', 'greedy', 'heap', 'backtracking', 'other'] },
    { key: 'language', label: 'Language', type: 'text' },
  ],
  gre: [
    { key: 'section', label: 'Section', type: 'select', options: ['quantitative', 'verbal', 'analytical writing'] },
    { key: 'questionType', label: 'Question type', type: 'text' },
  ],
};

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

export const APPLICATION_STATUSES = ['applied', 'screening', 'interview', 'offer', 'rejected', 'ghosted'];
export const APPLICATION_SOURCES = ['Hiring Cafe', 'LinkedIn', 'referral', 'direct', 'other'];
export const OUTREACH_CHANNELS = ['LinkedIn', 'Threads', 'email', 'other'];
export const READING_STATUSES = ['to read', 'reading', 'paused', 'finished', 'abandoned'];
export const READING_SOURCES = ['manual', 'pdf'];

export const HABIT_KINDS = ['simple', 'gym'];

/** The primary muscle group an exercise trains. Fixed list, deliberately short. */
export const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'legs', 'arms', 'core'];

export const CHESS_COLOURS = ['white', 'black'];
export const CHESS_RESULTS = ['win', 'loss', 'draw'];
export const CHESS_VENUES = ['chess.com', 'lichess', 'over the board', 'other'];

/** Seeded the first time a gym habit is created, so logging can start at once. */
export const STARTER_EXERCISES = [
  ['Bench press', 'chest'],
  ['Incline dumbbell press', 'chest'],
  ['Push-up', 'chest'],
  ['Pull-up', 'back'],
  ['Barbell row', 'back'],
  ['Lat pulldown', 'back'],
  ['Overhead press', 'shoulders'],
  ['Lateral raise', 'shoulders'],
  ['Squat', 'legs'],
  ['Deadlift', 'legs'],
  ['Leg press', 'legs'],
  ['Romanian deadlift', 'legs'],
  ['Barbell curl', 'arms'],
  ['Triceps pushdown', 'arms'],
  ['Plank', 'core'],
  ['Hanging leg raise', 'core'],
];

export const DEFAULT_SETTINGS = {
  theme: 'system',
  srsIntervals: [0, 2, 7, 21],
  stallDays: 14,
  pipelineIdleDays: 14,
  dayStartHour: 8,
  dayEndHour: 22,
};

// --- factories --------------------------------------------------------------

export function makeLink({ url = '', label = '' } = {}) {
  return { id: uid('lnk'), url, label };
}

export function makeTask({ title = '', due = null, estimateMinutes = null } = {}) {
  return {
    id: uid('task'),
    title,
    done: false,
    doneAt: null,
    due: due || null,
    estimateMinutes: estimateMinutes ?? null,
    notes: '',
    links: [],
    createdAt: nowStamp(),
  };
}

export function makeStep({ title = '' } = {}) {
  return { id: uid('step'), title, notes: '', links: [], tasks: [], createdAt: nowStamp() };
}

export function makeStage({ title = '', doneWhen = '' } = {}) {
  return {
    id: uid('stage'),
    title,
    doneWhen,
    forceUnlocked: false,
    forceCompleted: false,
    forceCompletedAt: null,
    notes: '',
    links: [],
    steps: [],
    createdAt: nowStamp(),
  };
}

export function makeThread({ name = '', type = 'project', description = '' } = {}) {
  return {
    id: uid('thr'),
    name,
    type: THREAD_TYPES.includes(type) ? type : 'project',
    description,
    archived: false,
    notes: '',
    links: [],
    stages: [],
    createdAt: nowStamp(),
  };
}

export function makeAttempt({ date = todayISO(), unaided = false, minutes = null, hesitation = '' } = {}) {
  return { id: uid('att'), date, unaided: !!unaided, minutes: minutes ?? null, hesitation };
}

export function makeQuestion({ bank = 'sql', title = '', url = '', tags = [], difficulty = 'medium', fields = {} } = {}) {
  const created = todayISO();
  return {
    id: uid('q'),
    bank: BANKS.includes(bank) ? bank : 'sql',
    title,
    url,
    tags: [...tags],
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : 'medium',
    fields: { ...fields },
    notes: '',
    attempts: [],
    intervalIndex: 0,
    dueDate: created,
    retired: false,
    retiredAt: null,
    createdAt: created,
  };
}

export function makeApplication(patch = {}) {
  const today = todayISO();
  return {
    id: uid('app'),
    company: '',
    role: '',
    source: 'direct',
    url: '',
    dateApplied: today,
    resumeVersion: '',
    referral: '',
    status: 'applied',
    nextAction: '',
    nextActionDate: null,
    notes: '',
    lastMovedAt: today,
    createdAt: today,
    ...patch,
  };
}

export function makeOutreach(patch = {}) {
  const today = todayISO();
  return {
    id: uid('out'),
    name: '',
    company: '',
    role: '',
    channel: 'LinkedIn',
    url: '',
    dateContacted: today,
    replied: false,
    followUpDate: null,
    notes: '',
    lastMovedAt: today,
    createdAt: today,
    ...patch,
  };
}

/**
 * A habit is a name, a weekly target and a log of dates. `kind: 'gym'` adds
 * sessions on top of that — it never replaces the log, so weekly targets,
 * streaks and the weekly review keep working the same way for both kinds.
 */
export function makeHabit({ name = '', weeklyTarget = 3, kind = 'simple' } = {}) {
  return {
    id: uid('hab'),
    name,
    kind: HABIT_KINDS.includes(kind) ? kind : 'simple',
    weeklyTarget,
    log: [],
    archived: false,
    createdAt: todayISO(),
  };
}

export function makeExercise({ name = '', muscle = 'chest' } = {}) {
  return {
    id: uid('ex'),
    name,
    muscle: MUSCLE_GROUPS.includes(muscle) ? muscle : 'chest',
    retired: false,
    createdAt: todayISO(),
  };
}

export function makeSet({ reps = null, weight = null } = {}) {
  return { id: uid('set'), reps: reps ?? null, weight: weight ?? null };
}

export function makeSessionExercise({ exerciseId = null, sets = [] } = {}) {
  return { id: uid('sx'), exerciseId, sets: [...sets] };
}

export function makeGymSession(patch = {}) {
  return {
    id: uid('gym'),
    habitId: null,
    date: todayISO(),
    startTime: null,
    durationMinutes: null,
    warmup: false,
    warmupMinutes: null,
    exercises: [],
    notes: '',
    createdAt: nowStamp(),
    ...patch,
  };
}

export function makeChessGame(patch = {}) {
  return {
    id: uid('chess'),
    date: todayISO(),
    colour: 'white',
    result: 'win',
    venue: 'chess.com',
    opponentRating: null,
    url: '',
    opening: '',
    // The one required field. A game logged without it isn't logged.
    lesson: '',
    createdAt: nowStamp(),
    ...patch,
  };
}

export function makeBookmark({ page = 1, note = '' } = {}) {
  return { id: uid('bm'), page, note, createdAt: nowStamp() };
}

/**
 * A book. `source: 'pdf'` means the bytes live in IndexedDB under this record's
 * id — everything here stays small enough for localStorage, including the
 * cover, which is a deliberately tiny JPEG.
 */
export function makeReading(patch = {}) {
  return {
    id: uid('read'),
    title: '',
    author: '',
    source: 'manual',
    fileName: '',
    fileSize: 0,
    pageCount: null,
    cover: null,
    position: 0,
    unit: 'page',
    total: null,
    status: 'reading',
    notes: '',
    bookmarks: [],
    lastOpenedAt: null,
    updatedAt: todayISO(),
    createdAt: todayISO(),
    ...patch,
  };
}

/**
 * One start, one end, one activity, one status. A plan and an account of what
 * happened are two blocks, not two time pairs on one — see core/timeblocks.js.
 */
export function makeTimeBlock(patch = {}) {
  return {
    id: uid('blk'),
    date: todayISO(),
    start: '09:00',
    end: '10:00',
    activity: null,
    taskId: null,
    label: '',
    status: 'planned',
    notes: '',
    createdAt: nowStamp(),
    ...patch,
  };
}

export function makeNote({ title = '', body = '', templateId = null, attach = null } = {}) {
  return {
    id: uid('note'),
    title,
    body,
    templateId,
    attach: attach ? { ...attach } : null,
    createdAt: nowStamp(),
    updatedAt: nowStamp(),
  };
}

export function makeTemplate({ name = '', body = '', builtin = false, id = null } = {}) {
  return { id: id || uid('tpl'), name, body, builtin };
}

// --- empty state ------------------------------------------------------------

export function createEmptyState(templates = []) {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      createdAt: nowStamp(),
      updatedAt: nowStamp(),
      appVersion: APP_VERSION,
      writeSeq: 0,
      writerId: null,
    },
    settings: { ...DEFAULT_SETTINGS, srsIntervals: [...DEFAULT_SETTINGS.srsIntervals] },
    threads: [],
    archivedStages: [],
    notes: [],
    noteTemplates: templates,
    questions: [],
    applications: [],
    outreach: [],
    habits: [],
    exercises: [],
    gymSessions: [],
    chessGames: [],
    reading: [],
    timeBlocks: [],
  };
}

/** The collections every valid state must carry, used by the validator. */
export const COLLECTIONS = [
  'threads',
  'archivedStages',
  'notes',
  'noteTemplates',
  'questions',
  'applications',
  'outreach',
  'habits',
  'exercises',
  'gymSessions',
  'chessGames',
  'reading',
  'timeBlocks',
];

export function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
