// Schema definition, factories and defaults.
//
// SCHEMA_VERSION is bumped whenever the persisted shape changes, and every bump
// gets a migration in migrations.js. Nothing else in the app is allowed to
// assume a shape that isn't produced here.

import { uid } from './ids.js';
import { todayISO, nowStamp } from './dates.js';

export const SCHEMA_VERSION = 7;
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

/** In the library, or deliberately stopped. */
export const EXERCISE_STATUSES = ['active', 'dropped'];

/** Whether pain showed up in the movement or afterwards. */
export const PAIN_TIMING = ['during', 'after'];

// --- GRE --------------------------------------------------------------------

/** Why a problem was missed. Four causes, because they need four responses. */
export const GRE_CAUSES = ['concept', 'format', 'timing', 'careless'];

/**
 * The blocks a day can be made of.
 *
 * This is a *template*, offered when the schedule is first seeded. It is not
 * the plan: the plan lives in the data, because it has an end date and will be
 * rewritten, and a plan compiled into the source cannot be.
 */
export const DEFAULT_GRE_BLOCKS = [
  { code: 'A', name: 'Retrieval', minutes: 25, order: 0, pinFirst: true, notBeforeDay: 4,
    description: 'Cold re-attempts of problems missed three or more days ago. Nothing to retrieve before day four.' },
  { code: 'B', name: 'Concept', minutes: 70, order: 1,
    description: 'Advance the study plan\'s modules.' },
  { code: 'C', name: 'Deliberate problems', minutes: 65, order: 2, hasTopic: true,
    description: 'One narrow slice: one question type, one topic, one difficulty band.' },
  { code: 'D', name: 'Timed', minutes: 56, order: 3,
    description: '26 minutes timed plus 30 of extraction. Scheduled days only.' },
  { code: 'E1', name: 'Vocab', minutes: 20, order: 4, everyDay: true,
    description: 'Every single day without exception, checkpoint days included.' },
  { code: 'E2', name: 'Verbal problems', minutes: 40, order: 5, hasTopic: true },
  { code: 'F', name: 'Log consolidation', minutes: 20, order: 6 },
];

/**
 * Seeded on first use so a session can be logged immediately instead of typing
 * out a library first. [name, primary, secondary[]].
 */
export const STARTER_EXERCISES = [
  ['Bench press', 'chest', ['shoulders', 'arms']],
  ['Incline dumbbell press', 'chest', ['shoulders']],
  ['Cable fly', 'chest', []],
  ['Chest press machine', 'chest', ['arms']],
  ['Push-up', 'chest', ['core']],
  ['Pull-up', 'back', ['arms']],
  ['Barbell row', 'back', ['arms']],
  ['Lat pulldown', 'back', ['arms']],
  ['Seated cable row', 'back', ['arms']],
  ['Overhead press', 'shoulders', ['arms']],
  ['Lateral raise', 'shoulders', []],
  ['Cable lateral raise', 'shoulders', []],
  ['Squat', 'legs', ['core']],
  ['Smith machine squat', 'legs', ['core']],
  ['Deadlift', 'legs', ['back']],
  ['Leg press', 'legs', []],
  ['Romanian deadlift', 'legs', ['back']],
  ['Leg curl', 'legs', []],
  ['Barbell curl', 'arms', []],
  ['Cable curl', 'arms', []],
  ['Triceps pushdown', 'arms', []],
  ['Plank', 'core', []],
  ['Hanging leg raise', 'core', []],
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
  /**
   * Retrieval spacing for the GRE problem log: re-attempt at +3 days, then
   * +10. Same scheduler as the question banks, different chain.
   */
  greIntervals: [3, 10],
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
 * A movement. Name, what it trains, and whether it is still in the picker.
 *
 * Dropping is the only way out: the id is what every session holds, so a
 * dropped exercise keeps resolving and the history it appears in stays exactly
 * as it was.
 */
export function makeExercise({ name = '', muscle = 'chest', secondary = [], status = 'active' } = {}) {
  return {
    id: uid('ex'),
    name,
    muscle: MUSCLE_GROUPS.includes(muscle) ? muscle : 'chest',
    secondary: secondary.filter((m) => MUSCLE_GROUPS.includes(m) && m !== muscle),
    status: EXERCISE_STATUSES.includes(status) ? status : 'active',
    createdAt: todayISO(),
  };
}

export function makeSet({ reps = null, weight = null } = {}) {
  return { id: uid('set'), reps: reps ?? null, weight: weight ?? null };
}

export function makeSessionExercise({ exerciseId = null, sets = [], note = '' } = {}) {
  return {
    id: uid('sx'),
    exerciseId,
    sets: [...sets],
    // One free-text note per exercise per session. Pump, tension, form, how it
    // felt — the useful ones are sentences, so it is not a dropdown.
    note,
  };
}

export function makeGymSession(patch = {}) {
  return {
    id: uid('gym'),
    date: todayISO(),
    startTime: null,
    endTime: null,
    exercises: [],
    notes: '',
    createdAt: nowStamp(),
    ...patch,
  };
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

export function makeGreBlock(patch = {}) {
  return {
    id: uid('grb'),
    code: '',
    name: '',
    minutes: 0,
    order: 0,
    /** Always drawn first, whatever else the day contains. */
    pinFirst: false,
    /** Runs on every day in the schedule, checkpoints included. */
    everyDay: false,
    /** Hidden until this day number — there is nothing to retrieve on day one. */
    notBeforeDay: null,
    /** Carries a topic assigned per day in advance. */
    hasTopic: false,
    description: '',
    ...patch,
  };
}

export function makeGrePhase(patch = {}) {
  return {
    id: uid('grp'),
    name: '',
    order: 0,
    /** The module number that has to be reached, and the day it is due by. */
    gateModule: null,
    gateByDay: null,
    ...patch,
  };
}

export function makeGreDay(patch = {}) {
  return {
    id: uid('grd'),
    dayNumber: 0,
    date: null,
    phaseId: null,
    /** Block codes scheduled for this day, beyond the every-day ones. */
    blockCodes: [],
    /** Per-day topics, keyed by block code. */
    topics: {},
    /** A checkpoint replaces the normal shape of the day. */
    checkpoint: '',
    /** Block codes ticked off. */
    completed: [],
    /** Which module the study plan had reached by the end of this day. */
    moduleReached: null,
    notes: '',
    ...patch,
  };
}

export function makeGreAttempt({ date = todayISO(), correct = false, minutes = null, note = '' } = {}) {
  return { id: uid('gra'), date, correct: !!correct, minutes: minutes ?? null, note };
}

/**
 * One logged problem. Four fields, and the fourth is the point: a rule about
 * problems in general, roughly six words. An entry without it is not saved.
 */
export function makeGreEntry(patch = {}) {
  const created = todayISO();
  return {
    id: uid('gre'),
    date: created,
    dayNumber: null,
    source: '',
    gave: '',
    did: '',
    broke: '',
    portable: '',
    correct: false,
    cause: 'concept',
    /** Links to an earlier entry whose portable move fired here. */
    appliedFrom: null,
    attempts: [],
    intervalIndex: 0,
    dueDate: null,
    retired: false,
    retiredAt: null,
    createdAt: created,
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
    gymSessions: [],
    painRecords: [],
    greBlocks: [],
    grePhases: [],
    greDays: [],
    greEntries: [],
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
  'gymSessions',
  'painRecords',
  'greBlocks',
  'grePhases',
  'greDays',
  'greEntries',
  'reading',
  'timeBlocks',
];

export function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
