// Schema definition, factories and defaults.
//
// SCHEMA_VERSION is bumped whenever the persisted shape changes, and every bump
// gets a migration in migrations.js. Nothing else in the app is allowed to
// assume a shape that isn't produced here.

import { uid } from './ids.js';
import { todayISO, nowStamp } from './dates.js';

export const SCHEMA_VERSION = 9;
export const STORAGE_KEY = 'cairn.state';
export const APP_VERSION = '1.0.0';

export const THREAD_TYPES = ['project', 'study', 'pipeline', 'habit', 'reading'];

/**
 * A thread is being worked on, or it is finished. There is no third state:
 * archiving was a way of keeping something around without deciding about it,
 * and the deciding is the point.
 */
export const THREAD_STATUSES = ['active', 'done'];

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
/** Three states, in the order a book moves through them. */
export const READING_STATUSES = ['to read', 'reading', 'finished'];

/**
 * What an exercise trains, at two levels.
 *
 * The broad group is for grouping and display; the specific muscle is the
 * level people actually train at and the level the body diagram maps to.
 * "Back" is true of a lat pulldown and a shrug and a good morning, and being
 * true of all three is what makes it useless for deciding what to do today.
 */
export const MUSCLE_TAXONOMY = {
  chest: ['upper chest', 'mid chest', 'lower chest'],
  back: ['lats', 'traps', 'rhomboids', 'lower back'],
  shoulders: ['front delts', 'side delts', 'rear delts'],
  arms: ['biceps', 'triceps', 'forearms'],
  legs: ['quads', 'hamstrings', 'glutes', 'calves', 'adductors'],
  core: ['abs', 'obliques'],
};

export const MUSCLE_GROUPS = Object.keys(MUSCLE_TAXONOMY);

/** Every specific muscle, flat, in group order. */
export const MUSCLES = Object.values(MUSCLE_TAXONOMY).flat();

const GROUP_OF_MUSCLE = new Map(
  Object.entries(MUSCLE_TAXONOMY).flatMap(([group, muscles]) => muscles.map((m) => [m, group])),
);

/** The broad group a specific muscle belongs to, or null if it is not one. */
export function muscleGroup(muscle) {
  return GROUP_OF_MUSCLE.get(muscle) ?? null;
}

export function isMuscle(value) {
  return GROUP_OF_MUSCLE.has(value);
}

/**
 * An exercise records both levels. `muscle` may be null while the group is
 * known — that is the honest state for an exercise whose specific muscle the
 * migration could not determine without guessing, and the library surfaces
 * those so they can be corrected.
 */
export function normaliseMuscle(group, muscle) {
  const g = MUSCLE_GROUPS.includes(group) ? group : null;
  const m = isMuscle(muscle) ? muscle : null;
  if (m) return { group: muscleGroup(m), muscle: m };
  return { group: g ?? 'chest', muscle: null };
}

/** In the library, or deliberately stopped. */
export const EXERCISE_STATUSES = ['active', 'dropped'];

/** Whether pain showed up in the movement or afterwards. */
export const PAIN_TIMING = ['during', 'after'];

/**
 * Why a question was missed. Four causes, because they need four responses.
 * Came from the GRE log and applies just as well to a SQL join you got wrong.
 */
export const MISS_CAUSES = ['concept', 'format', 'timing', 'careless'];

/**
 * The extraction: what a question actually taught you, in four fields.
 *
 * The fourth is the point — a rule about problems in general, roughly six
 * words. Filling in the first three and leaving it blank is the failure mode
 * the format exists to prevent, so the editor refuses that combination.
 */
export function makeExtraction(patch = {}) {
  return { gave: '', did: '', broke: '', portable: '', cause: null, ...patch };
}

/** True once any of the four fields has been written in. */
export function hasExtraction(question) {
  const e = question?.extraction;
  return !!e && ['gave', 'did', 'broke', 'portable'].some((k) => String(e[k] ?? '').trim());
}

/**
 * Seeded on first use so a session can be logged immediately instead of typing
 * out a library first. [name, specific muscle, secondary muscles[]].
 */
export const STARTER_EXERCISES = [
  ['Bench press', 'mid chest', ['front delts', 'triceps']],
  ['Incline dumbbell press', 'upper chest', ['front delts']],
  ['Cable fly', 'mid chest', []],
  ['Chest press machine', 'mid chest', ['triceps']],
  ['Dip', 'lower chest', ['triceps']],
  ['Push-up', 'mid chest', ['triceps', 'abs']],
  ['Pull-up', 'lats', ['biceps']],
  ['Barbell row', 'lats', ['rhomboids', 'biceps']],
  ['Lat pulldown', 'lats', ['biceps']],
  ['Seated cable row', 'rhomboids', ['lats', 'biceps']],
  ['Shrug', 'traps', []],
  ['Back extension', 'lower back', ['glutes']],
  ['Overhead press', 'front delts', ['triceps']],
  ['Lateral raise', 'side delts', []],
  ['Cable lateral raise', 'side delts', []],
  ['Face pull', 'rear delts', ['rhomboids']],
  ['Squat', 'quads', ['glutes', 'abs']],
  ['Smith machine squat', 'quads', ['glutes']],
  ['Leg extension', 'quads', []],
  ['Deadlift', 'hamstrings', ['glutes', 'lower back']],
  ['Romanian deadlift', 'hamstrings', ['glutes']],
  ['Leg curl', 'hamstrings', []],
  ['Hip thrust', 'glutes', ['hamstrings']],
  ['Leg press', 'quads', ['glutes']],
  ['Calf raise', 'calves', []],
  ['Copenhagen plank', 'adductors', ['abs']],
  ['Barbell curl', 'biceps', ['forearms']],
  ['Cable curl', 'biceps', []],
  ['Triceps pushdown', 'triceps', []],
  ['Farmer carry', 'forearms', ['traps']],
  ['Plank', 'abs', []],
  ['Hanging leg raise', 'abs', []],
  ['Cable woodchop', 'obliques', ['abs']],
];

/**
 * Warm-up movements, seeded on first use.
 *
 * These are mobility and activation drills, not strength work: no sets, no
 * load, no muscle group. Several of them used to sit under "core" in the
 * exercise library, which made that group a mix of things to train and things
 * to do before training.
 */
export const STARTER_WARMUPS = [
  'Treadmill',
  'Leg swings',
  'Arm circles',
  'Cat-cow',
  'Bodyweight squats',
  'Walking lunges',
  'Hip circles',
  'Band pull-aparts',
  'Wall angels',
  'Scap rows',
];

export const DEFAULT_SETTINGS = {
  theme: 'system',
  srsIntervals: [0, 2, 7, 21],
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
    status: 'active',
    notes: '',
    links: [],
    stages: [],
    createdAt: nowStamp(),
  };
}

export function makeAttempt({ date = todayISO(), unaided = false, minutes = null, hesitation = '' } = {}) {
  return { id: uid('att'), date, unaided: !!unaided, minutes: minutes ?? null, hesitation };
}

export function makeQuestion({ bank = 'sql', title = '', url = '', tags = [], difficulty = 'medium', fields = {}, extraction = null } = {}) {
  const created = todayISO();
  return {
    id: uid('q'),
    bank: BANKS.includes(bank) ? bank : 'sql',
    title,
    url,
    tags: [...tags],
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : 'medium',
    fields: { ...fields },
    /** Available on every bank, not just the GRE it was built for. */
    extraction: makeExtraction(extraction ?? {}),
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
export function makeExercise({ name = '', group = 'chest', muscle = null, secondary = [], status = 'active' } = {}) {
  const resolved = normaliseMuscle(group, muscle);
  return {
    id: uid('ex'),
    name,
    /** The broad group. Always set. */
    group: resolved.group,
    /** The specific muscle. Null when it is genuinely not known. */
    muscle: resolved.muscle,
    /** Other specific muscles it also trains. */
    secondary: [...new Set(secondary.filter((m) => isMuscle(m) && m !== resolved.muscle))],
    status: EXERCISE_STATUSES.includes(status) ? status : 'active',
    createdAt: todayISO(),
  };
}

/**
 * A warm-up movement. Deliberately not an exercise: it has no sets, reps or
 * load, and filing cat-cow under "core" made the core group unusable as a list
 * of things to train.
 */
export function makeWarmup({ name = '' } = {}) {
  return { id: uid('wu'), name, createdAt: todayISO() };
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
    /** What was done before the working sets, and for how long. */
    warmup: { movementIds: [], minutes: null },
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

/**
 * A book, as a line in a list. Cairn does not open it — that happens on paper
 * or on a device made for it — so what is stored is what you would want to
 * look up: what it is, where you are, and what you thought.
 */
export function makeReading(patch = {}) {
  return {
    id: uid('read'),
    title: '',
    author: '',
    status: 'reading',
    /** Optional, and only meaningful while reading. */
    page: null,
    /** Optional, 1–5, and only meaningful once finished. */
    rating: null,
    notes: '',
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

// --- empty state ------------------------------------------------------------

export function createEmptyState() {
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
    questions: [],
    applications: [],
    outreach: [],
    exercises: [],
    warmups: [],
    gymSessions: [],
    painRecords: [],
    reading: [],
    timeBlocks: [],
  };
}

/** The collections every valid state must carry, used by the validator. */
export const COLLECTIONS = [
  'threads',
  'questions',
  'applications',
  'outreach',
  'exercises',
  'warmups',
  'gymSessions',
  'painRecords',
  'reading',
  'timeBlocks',
];

export function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
