// The one-time logbook importer.
//
// The outline parser is strict because a plan pasted from a chat has a format
// it was asked to follow. This is the opposite situation: a document written by
// hand over months, where some sessions are tables and some are prose, some
// entries carry loads and most do not, and the headings drift. Refusing it
// would just mean retyping a year of training.
//
// So this parser is lenient about shape and strict about honesty. It follows
// the same rule the outline parser does — nothing is dropped silently. Every
// non-blank line either becomes part of a record or is reported, by line
// number and verbatim, as something it could not interpret. The preview shows
// both before anything is written.

import { MUSCLE_GROUPS, EQUIPMENT_TYPES, DROP_REASONS, SKIP_REASONS } from './schema.js';
import { isValidISODate, toISODate } from './dates.js';

// --- small helpers ----------------------------------------------------------

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const stripMarkup = (value) => clean(value).replace(/\*\*/g, '').replace(/^[*_`]+|[*_`]+$/g, '');

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * A date in any of the shapes a handwritten log uses. Returns a local
 * YYYY-MM-DD, never a UTC one — a session logged at 9pm belongs to that day.
 */
export function parseLooseDate(text, { year = new Date().getFullYear() } = {}) {
  const value = clean(text);
  if (!value) return null;

  const iso = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return isValidISODate(iso[0]) ? iso[0] : null;

  const slashed = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (slashed) {
    // Day first: this is a personal log, not an American form.
    const [, d, m, y] = slashed;
    const fullYear = Number(y.length === 2 ? `20${y}` : y);
    return safeDate(fullYear, Number(m) - 1, Number(d));
  }

  // "3 Aug 2026", "3 August", "Aug 3", "August 3rd, 2026"
  const dayFirst = value.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\b(?:,?\s*(\d{4}))?/);
  if (dayFirst && MONTHS[dayFirst[2].slice(0, 3).toLowerCase()] !== undefined) {
    return safeDate(Number(dayFirst[3] ?? year), MONTHS[dayFirst[2].slice(0, 3).toLowerCase()], Number(dayFirst[1]));
  }
  const monthFirst = value.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?/);
  if (monthFirst && MONTHS[monthFirst[1].slice(0, 3).toLowerCase()] !== undefined) {
    return safeDate(Number(monthFirst[3] ?? year), MONTHS[monthFirst[1].slice(0, 3).toLowerCase()], Number(monthFirst[2]));
  }
  return null;
}

function safeDate(year, monthIndex, day) {
  if (!Number.isFinite(year) || !Number.isFinite(day) || day < 1 || day > 31) return null;
  const date = new Date(year, monthIndex, day, 12, 0, 0);
  if (date.getMonth() !== monthIndex || date.getDate() !== day) return null;
  return toISODate(date);
}

/** "75 min", "1h 10", "1 hour 15 minutes", "90". */
export function parseDuration(text) {
  const value = clean(text).toLowerCase();
  if (!value) return null;
  // Longest alternative first, or "h" matches inside "hour" and swallows the
  // minutes that follow it.
  const hm = value.match(/(\d+)\s*(?:hours?|hrs?|h)\b\s*(?:(\d+)\s*(?:minutes?|mins?|m)?\b)?/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  const mins = value.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/);
  if (mins) return Number(mins[1]);
  const bare = value.match(/^(\d{1,3})$/);
  return bare ? Number(bare[1]) : null;
}

const BODYWEIGHT = /\b(bw|bodyweight|body\s?weight)\b/i;

/**
 * Sets from the notations a handwritten log actually uses:
 *
 *   3×10           three sets of ten, no load recorded
 *   3x10 @ 40kg    ...with a load
 *   10, 10, 8      three sets, per-set reps
 *   10/10/8 @ 40   ...with one load across them
 *   12 @ bw        bodyweight
 *
 * A weight that is not there stays null rather than becoming zero: "no load
 * recorded" and "lifted nothing" are different claims.
 */
export function parseSets(text) {
  const value = clean(text);
  if (!value) return [];

  let weight = null;
  const load = value.match(/@\s*([\d.]+)\s*(?:kg|kgs|lb|lbs)?/i);
  if (load) weight = Number(load[1]);
  else if (BODYWEIGHT.test(value)) weight = null;
  else {
    const trailing = value.match(/\b([\d.]+)\s*(?:kg|kgs|lb|lbs)\b/i);
    if (trailing) weight = Number(trailing[1]);
  }
  if (!Number.isFinite(weight)) weight = null;

  const before = value.split('@')[0];

  const grouped = before.match(/\b(\d{1,2})\s*[x×]\s*(\d{1,3})\b/i);
  if (grouped) {
    const count = Number(grouped[1]);
    const reps = Number(grouped[2]);
    if (count > 0 && count <= 20) {
      return Array.from({ length: count }, () => ({ reps, weight }));
    }
  }

  const listed = before.match(/\b\d{1,3}\s*(?:[,/]\s*\d{1,3}\s*)+/);
  if (listed) {
    return listed[0]
      .split(/[,/]/)
      .map((part) => Number(clean(part)))
      .filter((reps) => Number.isFinite(reps) && reps > 0)
      .map((reps) => ({ reps, weight }));
  }

  const single = before.match(/\b(\d{1,3})\s*(?:reps?)?\b/i);
  if (single && (/rep/i.test(before) || load || BODYWEIGHT.test(value))) {
    return [{ reps: Number(single[1]), weight }];
  }
  return [];
}

const MUSCLE_ALIASES = {
  chest: 'chest', pec: 'chest', pecs: 'chest', pectorals: 'chest',
  back: 'back', lats: 'back', lat: 'back', traps: 'back', rhomboids: 'back', 'upper back': 'back',
  shoulders: 'shoulders', shoulder: 'shoulders', delts: 'shoulders', deltoids: 'shoulders', 'rear delts': 'shoulders',
  legs: 'legs', quads: 'legs', quad: 'legs', hamstrings: 'legs', hams: 'legs', glutes: 'legs', calves: 'legs', 'leg': 'legs',
  arms: 'arms', biceps: 'arms', bicep: 'arms', triceps: 'arms', tricep: 'arms', forearms: 'arms',
  core: 'core', abs: 'core', abdominals: 'core', obliques: 'core',
};

export function parseMuscle(text) {
  const value = clean(text).toLowerCase().replace(/[.,;]+$/, '');
  if (!value) return null;
  if (MUSCLE_ALIASES[value]) return MUSCLE_ALIASES[value];
  for (const [alias, muscle] of Object.entries(MUSCLE_ALIASES)) {
    if (value.includes(alias)) return muscle;
  }
  return null;
}

/**
 * The movement's name is usually enough. A log that never states the muscle for
 * "cable fly" still means chest, and guessing from the name beats defaulting
 * everything to one group — but every guess is reported in the preview so it
 * can be corrected before it is written.
 */
const NAME_HINTS = [
  [/\b(fly|flye|bench|chest press|pec deck|push.?up|dip)\b/i, 'chest'],
  [/\b(row|pulldown|pull.?up|chin.?up|pullover|shrug|deadlift|face pull)\b/i, 'back'],
  [/\b(lateral raise|front raise|overhead press|shoulder press|upright row|rear delt|arnold)\b/i, 'shoulders'],
  [/\b(squat|lunge|leg press|leg curl|leg extension|calf|hip thrust|rdl|romanian)\b/i, 'legs'],
  [/\b(curl|pushdown|skull.?crusher|triceps|biceps|hammer|kickback)\b/i, 'arms'],
  [/\b(plank|crunch|sit.?up|leg raise|ab |abs|oblique|rollout|hollow)\b/i, 'core'],
];

export function guessMuscleFromName(name) {
  const value = clean(name);
  for (const [pattern, muscle] of NAME_HINTS) {
    if (pattern.test(value)) return muscle;
  }
  return null;
}

/** Body parts, so pain written inside a sentence still finds its location. */
const BODY_PARTS = [
  'lower back', 'upper back', 'rotator cuff', 'shoulder', 'knee', 'elbow', 'wrist', 'hip',
  'neck', 'ankle', 'hamstring', 'groin', 'chest', 'bicep', 'tricep', 'forearm', 'quad',
  'calf', 'glute', 'shin', 'thumb', 'finger', 'foot', 'heel', 'trap', 'lat', 'pec', 'rib',
  'abs', 'back', 'knees', 'shoulders',
];

export function findBodyPart(text) {
  const value = clean(text).toLowerCase();
  for (const part of BODY_PARTS) {
    const at = value.indexOf(part);
    if (at < 0) continue;
    // Keep a "left"/"right" that sits immediately before it: which side is
    // exactly the sort of thing that stops being obvious in six months.
    const before = value.slice(Math.max(0, at - 6), at);
    const side = before.match(/\b(left|right)\s*$/);
    return `${side ? `${side[1]} ` : ''}${part}`;
  }
  return null;
}

export function parseMuscleList(text) {
  const parts = clean(text).split(/[,/&+·]|\band\b/i);
  const out = [];
  for (const part of parts) {
    const muscle = parseMuscle(part);
    if (muscle && !out.includes(muscle)) out.push(muscle);
  }
  return out;
}

export function parseEquipment(text) {
  const value = clean(text).toLowerCase();
  if (!value) return null;
  if (/smith/.test(value)) return 'smith';
  if (/cable|pulley/.test(value)) return 'cable';
  if (/machine|selectorised|selectorized|plate.?loaded/.test(value)) return 'machine';
  if (/dumbbell|db\b/.test(value)) return 'dumbbell';
  if (/barbell|bb\b|ez.?bar/.test(value)) return 'barbell';
  if (/bodyweight|body\s?weight|\bbw\b|calisthenic/.test(value)) return 'bodyweight';
  return EQUIPMENT_TYPES.includes(value) ? value : null;
}

export function parseDropReason(text) {
  const value = clean(text).toLowerCase();
  if (!value) return null;
  if (/pain|hurt|injur|ache|tweak|impinge/.test(value)) return 'pain';
  if (/unavailable|busy|occupied|no machine|not (?:at|in) (?:my|the) gym|missing|gym does not|gym doesn/.test(value)) return 'unavailable';
  if (/dislike|hate|boring|do not enjoy|don't enjoy|no tension|pointless|useless|awkward/.test(value)) return 'disliked';
  return DROP_REASONS.includes(value) ? value : null;
}

export function parseSkipReason(text) {
  const value = clean(text).toLowerCase();
  if (!value) return { reason: 'other', note: clean(text) };
  if (/occupied|taken|busy|queue|in use|someone/.test(value)) return { reason: 'occupied', note: clean(text) };
  if (/time|late|rush|ran out/.test(value)) return { reason: 'time', note: clean(text) };
  if (/pain|hurt|sore|injur|tweak/.test(value)) return { reason: 'pain', note: clean(text) };
  if (/chose|decided|skipped by choice|did not fancy|didn't fancy|deliberate/.test(value)) return { reason: 'chose not to', note: clean(text) };
  return { reason: 'other', note: clean(text) };
}

// --- table handling ---------------------------------------------------------

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isTableRule = (line) => /^\s*\|[\s:|-]+\|\s*$/.test(line);

function tableCells(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => clean(cell));
}

/** Map a table's headings onto the fields we know how to use. */
function columnMap(headings) {
  const map = {};
  headings.forEach((heading, index) => {
    const key = heading.toLowerCase();
    if (!key) return;
    if (/exercise|movement|lift/.test(key) && map.exercise === undefined) map.exercise = index;
    else if (/^primary|primary muscle|main/.test(key)) map.primary = index;
    else if (/secondary|assist/.test(key)) map.secondary = index;
    else if (/equipment|machine type|kit/.test(key)) map.equipment = index;
    else if (/^date|day\b/.test(key)) map.date = index;
    else if (/location|where|site|area/.test(key)) map.location = index;
    else if (/during|after|timing|when/.test(key)) map.when = index;
    else if (/reason|why/.test(key)) map.reason = index;
    else if (/cue|coaching|note|comment|feedback/.test(key)) map.note = index;
    else if (/set/.test(key)) map.sets = index;
    else if (/rep/.test(key)) map.reps = index;
    else if (/weight|load|kg/.test(key)) map.weight = index;
    else if (/status/.test(key)) map.status = index;
  });
  return map;
}

// --- section detection ------------------------------------------------------

const SECTION_PATTERNS = [
  [/pain|niggle|injur|ache/i, 'pain'],
  [/cue|coaching|form note/i, 'cues'],
  [/drop|stopped|abandon|retired|removed/i, 'drops'],
  [/librar|exercise list|movement list|catalogue|catalog/i, 'library'],
  [/session|workout|training log|log\b/i, 'sessions'],
];

function classifyHeading(text) {
  const value = clean(text);
  if (parseLooseDate(value)) return 'session-heading';
  for (const [pattern, section] of SECTION_PATTERNS) {
    if (pattern.test(value)) return section;
  }
  return null;
}

// --- the parser -------------------------------------------------------------

class Report {
  constructor() {
    this.unparsed = [];
    this.warnings = [];
  }
  skip(line, text, section) {
    this.unparsed.push({ line, text, section: section ?? 'unknown' });
  }
  warn(line, message) {
    this.warnings.push({ line, message });
  }
}

/**
 * Parse a pasted logbook.
 *
 * @param {string} source
 * @returns {{exercises:Array, sessions:Array, pain:Array, cues:Array, drops:Array,
 *            unparsed:Array, warnings:Array, stats:object}}
 */
export function parseLogbook(source) {
  const report = new Report();
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');

  const exercises = new Map(); // lower name -> record
  const sessions = [];
  const pain = [];
  const cues = new Map();
  const drops = new Map();

  let section = null;
  let current = null; // the session being built
  let inFence = false;
  let pendingTable = null;

  const upsertExercise = (name, patch = {}) => {
    const key = clean(name).toLowerCase();
    if (!key) return null;
    const existing = exercises.get(key) ?? {
      name: stripMarkup(name),
      muscle: null,
      secondary: [],
      equipment: null,
      cues: '',
      status: 'active',
      dropReason: null,
      dropNote: '',
    };
    for (const [field, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === '') continue;
      if (field === 'secondary') {
        existing.secondary = [...new Set([...existing.secondary, ...value])];
      } else {
        existing[field] = value;
      }
    }
    exercises.set(key, existing);
    return existing;
  };

  const closeSession = () => {
    if (current && (current.exercises.length || current.skipped.length || current.durationMinutes !== null)) {
      sessions.push(current);
    } else if (current) {
      report.warn(current.line, `the session on ${current.date} had nothing recorded under it — imported as an empty session`);
      sessions.push(current);
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const lineNo = i + 1;
    const text = raw.trim();

    if (/^```/.test(text)) {
      inFence = !inFence;
      continue;
    }
    if (!text) continue;
    if (/^(-{3,}|={3,}|\*{3,})$/.test(text)) continue; // horizontal rules

    // --- tables -------------------------------------------------------------
    if (isTableRow(raw)) {
      if (isTableRule(raw)) continue;
      const cells = tableCells(raw);
      if (!pendingTable) {
        pendingTable = { columns: columnMap(cells), section, line: lineNo };
        continue;
      }
      const handled = absorbTableRow(cells, pendingTable, {
        section, lineNo, upsertExercise, pain, cues, drops, current, report,
      });
      if (!handled) report.skip(lineNo, raw.trim(), pendingTable.section ?? section);
      continue;
    }
    pendingTable = null;

    // --- headings -----------------------------------------------------------
    const heading = text.match(/^(#{1,6})\s+(.*)$/);
    const boldOnly = text.match(/^\*\*(.+?)\*\*:?$/);
    const headingText = heading ? heading[2] : boldOnly ? boldOnly[1] : null;

    if (headingText !== null) {
      const kind = classifyHeading(headingText);
      if (kind === 'session-heading') {
        closeSession();
        section = 'sessions';
        current = newSession(headingText, lineNo);
        continue;
      }
      if (kind) {
        closeSession();
        section = kind;
        continue;
      }
      // An unrecognised heading is structure, not data. It is reported so the
      // preview can say which parts of the document were ignored wholesale.
      report.skip(lineNo, text, section);
      continue;
    }

    // --- a bare dated line starts a session ---------------------------------
    const dated = !isTableRow(raw) && parseLooseDate(text);
    if (dated && (section === 'sessions' || section === null) && looksLikeSessionStart(text)) {
      closeSession();
      section = 'sessions';
      current = newSession(text, lineNo);
      continue;
    }

    // --- field lines inside a session ---------------------------------------
    if (current && absorbSessionField(text, current)) continue;

    // --- list items ---------------------------------------------------------
    const bullet = text.match(/^[-*+•]\s+(.*)$/) ?? text.match(/^\d+[.)]\s+(.*)$/);
    const body = bullet ? bullet[1] : text;

    if (section === 'cues') {
      if (absorbCue(body, cues, upsertExercise)) continue;
      report.skip(lineNo, text, section);
      continue;
    }
    if (section === 'drops') {
      if (absorbDrop(body, drops, upsertExercise)) continue;
      report.skip(lineNo, text, section);
      continue;
    }
    if (section === 'pain') {
      const record = parsePainLine(body);
      if (record) {
        pain.push({ ...record, line: lineNo, date: record.date ?? current?.date ?? null });
        continue;
      }
      report.skip(lineNo, text, section);
      continue;
    }
    if (section === 'library') {
      if (absorbLibraryLine(body, upsertExercise)) continue;
      report.skip(lineNo, text, section);
      continue;
    }

    if (current) {
      if (absorbSessionLine(body, current, upsertExercise, pain, lineNo)) continue;
      report.skip(lineNo, text, 'sessions');
      continue;
    }

    report.skip(lineNo, text, section);
  }

  closeSession();

  // Cues and drops collected in their own sections belong to library records.
  for (const [key, value] of cues) upsertExercise(key, { cues: value });
  for (const [key, value] of drops) {
    upsertExercise(key, { status: 'dropped', dropReason: value.reason, dropNote: value.note });
  }

  const list = [...exercises.values()].map((exercise) => {
    const stated = exercise.muscle;
    const guessed = stated ? null : guessMuscleFromName(exercise.name);
    const muscle = stated ?? guessed ?? 'core';
    return {
      ...exercise,
      muscle,
      // A muscle cannot be both primary and secondary; the table often repeats it.
      secondary: (exercise.secondary ?? []).filter((m) => m !== muscle),
      guessedMuscle: !stated,
      guessedFromName: !stated && !!guessed,
      equipment: exercise.equipment ?? 'unspecified',
    };
  });

  for (const exercise of list) {
    if (!exercise.guessedMuscle) continue;
    report.warn(0, exercise.guessedFromName
      ? `"${exercise.name}" never said which muscle it trains — read as ${exercise.muscle} from the name, correct it in the preview if that is wrong`
      : `"${exercise.name}" never said which muscle it trains and the name gave no clue — set to core, change it in the preview`);
  }

  // The same event written twice — once inline in the session, once in the
  // pain table — is one event. The record with a real location wins.
  const deduped = [];
  for (const record of pain) {
    const twin = deduped.find((other) =>
      other.date === record.date &&
      String(other.exerciseName ?? '').toLowerCase() === String(record.exerciseName ?? '').toLowerCase() &&
      (!other.location || !record.location ||
        other.location.toLowerCase() === record.location.toLowerCase()));
    if (!twin) {
      deduped.push(record);
      continue;
    }
    if (!twin.location && record.location) {
      twin.location = record.location;
      twin.needsLocation = false;
    }
    if (!twin.note && record.note) twin.note = record.note;
  }
  pain.length = 0;
  pain.push(...deduped);

  for (const record of pain) {
    if (!record.location) {
      report.warn(record.line, `pain was recorded on line ${record.line} without naming where it hurt — give it a location in the preview`);
    }
  }

  return {
    exercises: list,
    sessions,
    pain,
    cues: [...cues.entries()].map(([name, value]) => ({ name, cues: value })),
    drops: [...drops.entries()].map(([name, value]) => ({ name, ...value })),
    unparsed: report.unparsed,
    warnings: report.warnings,
    stats: {
      exercises: list.length,
      sessions: sessions.length,
      sets: sessions.reduce((sum, s) => sum + s.exercises.reduce((n, e) => n + e.sets.length, 0), 0),
      skipped: sessions.reduce((sum, s) => sum + s.skipped.length, 0),
      pain: pain.length,
      cues: cues.size,
      drops: drops.size,
      unparsed: report.unparsed.length,
    },
  };
}

function newSession(headingText, line) {
  const routine = headingText.match(/\b(?:routine|day|slot)?\s*\(?\b([AB])\b\)?/);
  return {
    line,
    date: parseLooseDate(headingText),
    heading: clean(headingText),
    routineName: routine ? routine[1] : null,
    durationMinutes: null,
    startTime: null,
    endTime: null,
    warmup: false,
    warmupMinutes: null,
    exercises: [],
    skipped: [],
    notes: '',
  };
}

function looksLikeSessionStart(text) {
  // A date on its own line, or a date with a short label, starts a session. A
  // sentence that merely mentions a date does not.
  return clean(text).length <= 60 && !/[·|]/.test(text);
}

const TIME = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;

/** "Duration: 70 min", "Warm-up: 10 min", "Started 18:05, finished 19:20". */
function absorbSessionField(text, session) {
  const value = clean(text);
  const label = value.match(/^([A-Za-z][A-Za-z\s-]{2,20})\s*[:—-]\s*(.*)$/);
  if (!label) return false;
  const key = label[1].toLowerCase().trim();
  const rest = label[2];

  if (/^duration|^length|^total time|^time$/.test(key)) {
    session.durationMinutes = parseDuration(rest);
    return true;
  }
  if (/^warm.?up$/.test(key)) {
    if (/^(no|none|skipped|nil)\b/i.test(clean(rest))) {
      session.warmup = false;
      session.warmupMinutes = null;
    } else {
      session.warmup = true;
      session.warmupMinutes = parseDuration(rest);
    }
    return true;
  }
  if (/^start|^started$/.test(key)) {
    const found = [...rest.matchAll(TIME)];
    if (found[0]) session.startTime = `${String(found[0][1]).padStart(2, '0')}:${found[0][2]}`;
    if (found[1]) session.endTime = `${String(found[1][1]).padStart(2, '0')}:${found[1][2]}`;
    return true;
  }
  if (/^end|^ended|^finish|^finished$/.test(key)) {
    const found = [...rest.matchAll(TIME)];
    if (found[0]) session.endTime = `${String(found[0][1]).padStart(2, '0')}:${found[0][2]}`;
    return true;
  }
  if (/^routine|^split|^slot$/.test(key)) {
    session.routineName = clean(rest) || null;
    return true;
  }
  if (/^note|^notes|^overall|^summary$/.test(key)) {
    session.notes = session.notes ? `${session.notes} ${clean(rest)}` : clean(rest);
    return true;
  }
  if (/^skipped|^missed|^not done$/.test(key)) {
    for (const part of clean(rest).split(/[;,]/)) {
      const entry = parseSkipEntry(part);
      if (entry) session.skipped.push(entry);
    }
    return session.skipped.length > 0;
  }
  return false;
}

function parseSkipEntry(text) {
  const value = clean(text);
  if (!value) return null;
  const split = value.split(/\s*(?:—|–|-{1,2}|·|\(|:)\s*/);
  const name = stripMarkup(split[0]);
  if (!name) return null;
  const reasonText = split.slice(1).join(' ').replace(/\)$/, '');
  const { reason, note } = parseSkipReason(reasonText);
  return { name, reason, note: reasonText ? note : '' };
}

/**
 * One exercise line from a session, in the shapes the log actually uses:
 *   - Lat pulldown · 3×10 @ 45kg · good pump
 *   - Cable fly 3x12 — no tension in the target muscle
 *   - Leg press → Hack squat · 3×10   (a substitution)
 */
function absorbSessionLine(text, session, upsertExercise, pain, lineNo) {
  const value = clean(text);
  if (!value) return false;

  if (/^skipped\b/i.test(value)) {
    const entry = parseSkipEntry(value.replace(/^skipped\b\s*[:—-]?\s*/i, ''));
    if (entry) {
      session.skipped.push(entry);
      return true;
    }
    return false;
  }

  // Pain written inline inside a session still becomes a pain record, because
  // burying it in a note is exactly what the structured record is here to stop.
  const painInline = value.match(/\bpain\b\s*(?:in|at|:)?\s*(.*)$/i);

  const parts = value.split(/\s*[·|]\s*|\s+—\s+|\s+–\s+|\s+--\s+/).map(clean).filter(Boolean);
  if (!parts.length) return false;

  let head = parts[0];
  let substitutedForName = null;
  const swap = head.match(/^(.+?)\s*(?:→|->|=>|instead of|swapped for|sub(?:bed)? for)\s*(.+)$/i);
  if (swap) {
    // "A → B" reads as "did B instead of A".
    substitutedForName = stripMarkup(swap[1]);
    head = swap[2];
  }

  // The set notation often sits in the same fragment as the name.
  let name = stripMarkup(head);
  let setsText = parts.slice(1).join(' · ');
  const inlineSets = head.match(/^(.*?)(\s+\d{1,2}\s*[x×]\s*\d{1,3}.*)$/i);
  if (inlineSets) {
    name = stripMarkup(inlineSets[1]);
    setsText = `${inlineSets[2]} ${setsText}`.trim();
  }
  if (!name) return false;

  const sets = parseSets(setsText);
  const note = parts
    .slice(1)
    .filter((part) => !parseSets(part).length && !/^@/.test(part))
    .join(' · ');

  // A line with no sets has to look like an exercise name to be treated as one.
  // Without this, a sentence of reflection becomes an exercise called
  // "Felt reasonably strong today, thinking about changing the split soon."
  if (!sets.length && !looksLikeAnExerciseName(name)) return false;
  if (painInline && !sets.length && parts.length === 1) return false;

  upsertExercise(name);
  if (substitutedForName) upsertExercise(substitutedForName);

  session.exercises.push({
    name,
    substitutedForName,
    sets,
    note: note && note !== setsText ? note : '',
  });

  if (painInline) {
    // The location is a body part named anywhere in the sentence, not whatever
    // happens to follow the word "pain" — "pain on the third set" is a when,
    // not a where.
    const located = findBodyPart(value);
    pain.push({
      line: lineNo,
      date: session.date,
      location: located ?? '',
      needsLocation: !located,
      exerciseName: name,
      when: /after/i.test(value) ? 'after' : 'during',
      note: note || value,
    });
  }
  return true;
}

/** Short, no sentence punctuation, few words: the shape of a movement's name. */
function looksLikeAnExerciseName(name) {
  const value = clean(name);
  if (!value || value.length > 44) return false;
  if (/[.!?;]/.test(value)) return false;
  if (value.split(/\s+/).length > 6) return false;
  return true;
}

function absorbCue(text, cues, upsertExercise) {
  const value = clean(text);
  const split = value.split(/\s*[:—–]\s*|\s+-\s+/);
  if (split.length < 2) return false;
  const name = stripMarkup(split[0]);
  const cue = clean(split.slice(1).join(' — '));
  if (!name || !cue) return false;
  const key = name.toLowerCase();
  cues.set(key, cues.has(key) ? `${cues.get(key)}\n${cue}` : cue);
  upsertExercise(name);
  return true;
}

function absorbDrop(text, drops, upsertExercise) {
  const value = clean(text);
  const split = value.split(/\s*[:—–(]\s*|\s+-\s+/);
  const name = stripMarkup(split[0]);
  if (!name) return false;
  const reasonText = clean(split.slice(1).join(' ')).replace(/\)$/, '');
  drops.set(name.toLowerCase(), {
    reason: parseDropReason(reasonText),
    note: reasonText,
  });
  upsertExercise(name);
  return true;
}

function absorbLibraryLine(text, upsertExercise) {
  const value = clean(text);
  const split = value.split(/\s*[·|,—–]\s*|\s+-\s+/).map(clean).filter(Boolean);
  const name = stripMarkup(split[0]);
  if (!name) return false;
  const muscles = split.slice(1).flatMap((part) => parseMuscleList(part));
  const equipment = split.slice(1).map(parseEquipment).find(Boolean) ?? null;
  if (!muscles.length && !equipment && split.length === 1) return false;
  upsertExercise(name, {
    muscle: muscles[0] ?? null,
    secondary: muscles.slice(1),
    equipment,
  });
  return true;
}

function parsePainLine(text) {
  const value = clean(text);
  if (!value) return null;
  const parts = value.split(/\s*[·|]\s*|\s+—\s+|\s+–\s+/).map(clean).filter(Boolean);
  if (!parts.length) return null;

  const date = parts.map((part) => parseLooseDate(part)).find(Boolean) ?? null;
  const when = /\bafter\b/i.test(value) ? 'after' : 'during';
  const withoutDate = parts.filter((part) => !parseLooseDate(part));
  if (!withoutDate.length) return null;

  return {
    location: withoutDate[0],
    exerciseName: withoutDate[1] ? stripMarkup(withoutDate[1].replace(/\b(during|after)\b/gi, '').trim()) : null,
    when,
    note: withoutDate.slice(2).join(' · '),
    date,
  };
}

function absorbTableRow(cells, table, context) {
  const { columns, section } = table;
  const { upsertExercise, pain, cues, drops, current, lineNo } = context;
  const at = (key) => (columns[key] !== undefined ? cells[columns[key]] : '');

  const name = clean(at('exercise'));

  if (section === 'pain' || (columns.location !== undefined && columns.date !== undefined)) {
    const location = clean(at('location'));
    if (!location) return false;
    pain.push({
      line: lineNo,
      date: parseLooseDate(at('date')) ?? current?.date ?? null,
      location,
      exerciseName: name || null,
      when: /after/i.test(at('when')) ? 'after' : 'during',
      note: clean(at('note')),
    });
    return true;
  }

  if (!name) return false;

  if (section === 'cues' || (columns.note !== undefined && columns.primary === undefined && section !== 'sessions')) {
    const cue = clean(at('note'));
    if (cue) {
      cues.set(name.toLowerCase(), cue);
      upsertExercise(name);
      return true;
    }
  }

  if (section === 'drops') {
    const reasonText = clean(at('reason')) || clean(at('note'));
    drops.set(name.toLowerCase(), { reason: parseDropReason(reasonText), note: reasonText });
    upsertExercise(name);
    return true;
  }

  const muscles = parseMuscleList(at('primary'));
  const secondary = parseMuscleList(at('secondary'));
  const equipment = parseEquipment(at('equipment'));

  upsertExercise(name, {
    muscle: muscles[0] ?? null,
    secondary,
    equipment,
    cues: clean(at('note')) || undefined,
  });

  // A table inside a session is that session's work, not just the library.
  if (current && (columns.sets !== undefined || columns.reps !== undefined || columns.weight !== undefined)) {
    const setsText = [at('sets'), at('reps'), at('weight') ? `@ ${at('weight')}` : ''].filter(Boolean).join(' ');
    const sets = parseSets(setsText) ;
    current.exercises.push({ name, substitutedForName: null, sets, note: clean(at('note')) });
  }
  return true;
}

// --- turning a parse into a plan -------------------------------------------

/**
 * What the import would do to the state as it stands: which library entries are
 * new and which already exist, and how many sessions and pain records would be
 * added. Nothing is written here.
 */
export function planLogbookImport(parsed, state) {
  const existing = new Map(
    (state?.exercises ?? []).map((e) => [String(e.name).trim().toLowerCase(), e]),
  );
  const existingSessionDates = new Set((state?.gymSessions ?? []).map((s) => s.date));

  const library = parsed.exercises.map((exercise) => ({
    ...exercise,
    action: existing.has(exercise.name.toLowerCase()) ? 'update' : 'create',
    existingId: existing.get(exercise.name.toLowerCase())?.id ?? null,
  }));

  const sessions = parsed.sessions.map((session) => ({
    ...session,
    // A date already in the log is flagged rather than blocked: two sessions in
    // one day is legitimate, importing the same logbook twice is not.
    clash: session.date ? existingSessionDates.has(session.date) : false,
    undated: !session.date,
  }));

  return {
    library,
    sessions,
    pain: parsed.pain,
    counts: {
      newExercises: library.filter((e) => e.action === 'create').length,
      updatedExercises: library.filter((e) => e.action === 'update').length,
      sessions: sessions.length,
      clashes: sessions.filter((s) => s.clash).length,
      undated: sessions.filter((s) => s.undated).length,
      pain: parsed.pain.length,
    },
  };
}

export const LOGBOOK_EXAMPLE = `## Exercise library

| Exercise | Primary | Secondary | Equipment |
| --- | --- | --- | --- |
| Lat pulldown | back | biceps | cable |
| Chest press machine | chest | triceps | machine |
| Barbell squat | quads | glutes | barbell |

## 2026-08-03 (A)

Duration: 70 min
Warm-up: 10 min

- Chest press machine · 3×10 @ 45kg · good pump
- Cable fly · 3×12 @ 15kg · no tension in the target muscle
- Barbell squat → Smith machine squat · 3×8 @ 60kg
Skipped: Leg press — machine occupied

## 2026-08-05

Duration: 55 min
Warm-up: none

- Lat pulldown · 3×10 @ 45kg
- Seated row · 10, 10, 8 @ 40kg · right shoulder pain on the third set

## Pain report

| Date | Location | Exercise | When | Note |
| --- | --- | --- | --- | --- |
| 2026-08-05 | right shoulder | Seated row | during | third set only |

## Cues

- Lat pulldown: drive the elbows down, not back
- Barbell squat: brace before unracking

## Dropped

- Upright row — pain in the right shoulder
- Barbell curl — no tension in the target muscle
`;
