// Schema definition, factories and defaults.
//
// SCHEMA_VERSION is bumped whenever the persisted shape changes, and every bump
// gets a migration in migrations.js. Nothing else in the app is allowed to
// assume a shape that isn't produced here.

import { uid } from './ids.js';
import { todayISO, nowStamp } from './dates.js';

export const SCHEMA_VERSION = 5;
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

/** The muscle groups an exercise trains. Fixed list, deliberately short. */
export const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'legs', 'arms', 'core'];

/**
 * How the resistance is applied. Not cosmetic: a cable or machine variant of a
 * movement can work where the free-weight variant does not, and that pattern is
 * only visible if the app records which is which.
 *
 * `unspecified` exists for exercises that predate this field or came in from an
 * import that did not say. It is a gap to be filled, not a seventh kind of
 * equipment, and the library says so.
 */
export const EQUIPMENT_TYPES = ['cable', 'machine', 'smith', 'dumbbell', 'barbell', 'bodyweight', 'unspecified'];
export const REAL_EQUIPMENT = EQUIPMENT_TYPES.filter((e) => e !== 'unspecified');

/** Active, never tried, or deliberately stopped. */
export const EXERCISE_STATUSES = ['active', 'untried', 'dropped'];

/**
 * Why an exercise was dropped. These are three different problems — one is a
 * preference, one is an injury signal, one is about the gym — and collapsing
 * them would throw away the only thing that makes the list worth keeping.
 */
export const DROP_REASONS = ['disliked', 'pain', 'unavailable'];

/** Why a planned exercise did not happen. A partial session is normal. */
export const SKIP_REASONS = ['occupied', 'time', 'pain', 'chose not to', 'other'];

/** Whether pain showed up in the movement or afterwards. */
export const PAIN_TIMING = ['during', 'after'];

export const CHESS_COLOURS = ['white', 'black'];
export const CHESS_RESULTS = ['win', 'loss', 'draw'];
export const CHESS_VENUES = ['chess.com', 'lichess', 'over the board', 'other'];

/**
 * Seeded on first use so a session can be logged immediately instead of typing
 * out a library first. [name, primary, secondary[], equipment].
 */
export const STARTER_EXERCISES = [
  ['Bench press', 'chest', ['shoulders', 'arms'], 'barbell'],
  ['Incline dumbbell press', 'chest', ['shoulders'], 'dumbbell'],
  ['Cable fly', 'chest', [], 'cable'],
  ['Chest press machine', 'chest', ['arms'], 'machine'],
  ['Push-up', 'chest', ['core'], 'bodyweight'],
  ['Pull-up', 'back', ['arms'], 'bodyweight'],
  ['Barbell row', 'back', ['arms'], 'barbell'],
  ['Lat pulldown', 'back', ['arms'], 'cable'],
  ['Seated cable row', 'back', ['arms'], 'cable'],
  ['Overhead press', 'shoulders', ['arms'], 'barbell'],
  ['Lateral raise', 'shoulders', [], 'dumbbell'],
  ['Cable lateral raise', 'shoulders', [], 'cable'],
  ['Squat', 'legs', ['core'], 'barbell'],
  ['Smith machine squat', 'legs', ['core'], 'smith'],
  ['Deadlift', 'legs', ['back'], 'barbell'],
  ['Leg press', 'legs', [], 'machine'],
  ['Romanian deadlift', 'legs', ['back'], 'barbell'],
  ['Leg curl', 'legs', [], 'machine'],
  ['Barbell curl', 'arms', [], 'barbell'],
  ['Cable curl', 'arms', [], 'cable'],
  ['Triceps pushdown', 'arms', [], 'cable'],
  ['Plank', 'core', [], 'bodyweight'],
  ['Hanging leg raise', 'core', [], 'bodyweight'],
];

/** The default rotation. Two slots, because that is what an A/B split is. */
export const STARTER_ROUTINES = [
  { name: 'A — push', order: 0 },
  { name: 'B — pull and legs', order: 1 },
];

export const DEFAULT_SETTINGS = {
  theme: 'system',
  srsIntervals: [0, 2, 7, 21],
  stallDays: 14,
  pipelineIdleDays: 14,
  dayStartHour: 8,
  dayEndHour: 22,
  /** Gym sessions per week. The one number the week is judged against. */
  gymWeeklyTarget: 4,
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

export function makeExercise({
  name = '',
  muscle = 'chest',
  secondary = [],
  equipment = 'unspecified',
  status = 'active',
  cues = '',
} = {}) {
  return {
    id: uid('ex'),
    name,
    muscle: MUSCLE_GROUPS.includes(muscle) ? muscle : 'chest',
    secondary: secondary.filter((m) => MUSCLE_GROUPS.includes(m) && m !== muscle),
    equipment: EQUIPMENT_TYPES.includes(equipment) ? equipment : 'unspecified',
    status: EXERCISE_STATUSES.includes(status) ? status : 'active',
    dropReason: null,
    dropNote: '',
    // Coaching notes. These surface automatically when the exercise is logged,
    // which is the only moment they are any use.
    cues,
    createdAt: todayISO(),
  };
}

export function makeSet({ reps = null, weight = null } = {}) {
  return { id: uid('set'), reps: reps ?? null, weight: weight ?? null };
}

export function makeSessionExercise({ exerciseId = null, sets = [], note = '', substitutedFor = null } = {}) {
  return {
    id: uid('sx'),
    exerciseId,
    // A substitution keeps both halves: what was meant to happen and what did.
    substitutedFor,
    sets: [...sets],
    // Free text on purpose. "no tension in the target muscle" and "first two
    // sets locking out at the top" are the useful notes, and neither fits a
    // dropdown.
    note,
  };
}

export function makeSkippedExercise({ exerciseId = null, reason = 'other', note = '' } = {}) {
  return {
    id: uid('skip'),
    exerciseId,
    reason: SKIP_REASONS.includes(reason) ? reason : 'other',
    note,
  };
}

/** A slot in the rotation. Two of these make an A/B split. */
export function makeRoutine({ name = '', order = 0, exerciseIds = [] } = {}) {
  return { id: uid('rot'), name, order, exerciseIds: [...exerciseIds], createdAt: todayISO() };
}

/**
 * Pain is a structured record, not a note. The question it has to answer is
 * whether a location recurs across different exercises or is isolated to one,
 * and a paragraph cannot be grouped.
 */
export function makePainRecord(patch = {}) {
  return {
    id: uid('pain'),
    date: todayISO(),
    location: '',
    exerciseId: null,
    when: 'during',
    note: '',
    sessionId: null,
    createdAt: nowStamp(),
    ...patch,
  };
}

export function makeGymSession(patch = {}) {
  return {
    id: uid('gym'),
    routineId: null,
    date: todayISO(),
    startTime: null,
    endTime: null,
    // Kept explicitly as well as derived from the times, because an imported
    // logbook often records a duration and no clock times at all.
    durationMinutes: null,
    warmup: false,
    warmupMinutes: null,
    exercises: [],
    // A partial session is the normal case, not an error state.
    skipped: [],
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
    exercises: [],
    routines: [],
    gymSessions: [],
    painRecords: [],
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
  'exercises',
  'routines',
  'gymSessions',
  'painRecords',
  'chessGames',
  'reading',
  'timeBlocks',
];

export function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
