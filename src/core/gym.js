// The gym.
//
// Two questions, and only two: is the weight moving, and does anything hurt.
// Everything here answers one of them. A session is a date, a pair of times and
// the exercises done; per exercise, the sets and one line about how it felt.
// Pain is kept apart from that line, because a paragraph cannot be grouped and
// grouping is the only thing that makes pain worth recording.
//
// Weeks run Sunday to Saturday, from the one constant in dates.js.

import { todayISO, startOfWeek, endOfWeek, weekDates, daysLeftInWeek, withinRange, timeToMinutes } from './dates.js';
import { MUSCLE_GROUPS, STARTER_EXERCISES, makeExercise } from './schema.js';

// --- the library ------------------------------------------------------------

const byMuscleThenName = (a, b) =>
  MUSCLE_GROUPS.indexOf(a.muscle) - MUSCLE_GROUPS.indexOf(b.muscle) ||
  String(a.name).localeCompare(String(b.name));

export function allExercises(state) {
  return [...(state?.exercises ?? [])].sort(byMuscleThenName);
}

/** What a session can pick from. */
export function activeExercises(state) {
  return allExercises(state).filter((e) => e.status !== 'dropped');
}

export function droppedExercises(state) {
  return allExercises(state).filter((e) => e.status === 'dropped');
}

export function exerciseById(state, id) {
  return (state?.exercises ?? []).find((e) => e.id === id) ?? null;
}

/**
 * The name to show for an id found in a session. A dropped exercise still
 * resolves — dropping only removes it from the picker — and an id with no
 * record left is named rather than rendered blank.
 */
export function exerciseName(state, id) {
  return exerciseById(state, id)?.name ?? 'Removed exercise';
}

/** Primary and secondary together, in canonical order, deduplicated. */
export function exerciseMuscles(state, id) {
  const exercise = exerciseById(state, id);
  if (!exercise) return [];
  const set = new Set([exercise.muscle, ...(exercise.secondary ?? [])].filter(Boolean));
  return MUSCLE_GROUPS.filter((m) => set.has(m));
}

export function exerciseUsage(state, id) {
  let sessions = 0;
  let sets = 0;
  for (const session of state?.gymSessions ?? []) {
    const entries = (session.exercises ?? []).filter((x) => x.exerciseId === id);
    if (!entries.length) continue;
    sessions += 1;
    for (const entry of entries) sets += (entry.sets ?? []).length;
  }
  return { sessions, sets };
}

export function exerciseNameTaken(state, name, exceptId = null) {
  const wanted = String(name ?? '').trim().toLowerCase();
  if (!wanted) return false;
  return (state?.exercises ?? []).some(
    (e) => e.id !== exceptId && String(e.name).trim().toLowerCase() === wanted,
  );
}

/** Seeded on first use so a session can be logged without typing a library first. */
export function seedLibrary(state) {
  if (!Array.isArray(state.exercises) || state.exercises.length) return 0;
  for (const [name, muscle, secondary] of STARTER_EXERCISES) {
    state.exercises.push(makeExercise({ name, muscle, secondary }));
  }
  return state.exercises.length;
}

// --- sessions ---------------------------------------------------------------

/** Newest first, with a stable order for two sessions on the same day. */
export function sessions(state) {
  return [...(state?.gymSessions ?? [])]
    .reverse()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) ||
      String(b.startTime ?? '').localeCompare(String(a.startTime ?? '')) ||
      String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}

export function sessionById(state, id) {
  return (state?.gymSessions ?? []).find((s) => s.id === id) ?? null;
}

export function sessionsInWeek(state, iso = todayISO()) {
  const start = startOfWeek(iso);
  const end = endOfWeek(iso);
  return sessions(state).filter((s) => withinRange(s.date, start, end));
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function setVolume(set) {
  return num(set?.reps) * num(set?.weight);
}

/** How long it took, when both clock times are there. */
export function sessionMinutes(session) {
  const start = timeToMinutes(session?.startTime);
  const end = timeToMinutes(session?.endTime);
  if (start === null || end === null || end <= start) return 0;
  return end - start;
}

export function sessionTotals(session) {
  let sets = 0;
  let reps = 0;
  let volume = 0;
  for (const entry of session?.exercises ?? []) {
    for (const set of entry.sets ?? []) {
      sets += 1;
      reps += num(set.reps);
      volume += setVolume(set);
    }
  }
  return {
    exercises: (session?.exercises ?? []).length,
    sets,
    reps,
    volume,
    minutes: sessionMinutes(session),
  };
}

/** Every group a session touched, primary and secondary, for the history row. */
export function sessionMuscles(state, session) {
  const seen = new Set();
  for (const entry of session?.exercises ?? []) {
    if (!(entry.sets ?? []).length) continue;
    for (const muscle of exerciseMuscles(state, entry.exerciseId)) seen.add(muscle);
  }
  return MUSCLE_GROUPS.filter((m) => seen.has(m));
}

// --- the week ---------------------------------------------------------------

export function weeklyTarget(state) {
  const target = Number(state?.settings?.gymWeeklyTarget);
  return Number.isFinite(target) && target > 0 ? Math.round(target) : 0;
}

/** Sessions this week, and how much week is left. */
export function weekProgress(state, iso = todayISO()) {
  const done = sessionsInWeek(state, iso).length;
  const target = weeklyTarget(state);
  return {
    weekStart: startOfWeek(iso),
    weekEnd: endOfWeek(iso),
    done,
    target,
    // Going over target is not a debt.
    remaining: Math.max(0, target - done),
    daysLeft: daysLeftInWeek(iso),
    met: target > 0 && done >= target,
  };
}

export function weekDaySessions(state, iso = todayISO()) {
  const byDate = new Map();
  for (const session of sessionsInWeek(state, iso)) {
    if (!byDate.has(session.date)) byDate.set(session.date, []);
    byDate.get(session.date).push(session);
  }
  return weekDates(startOfWeek(iso)).map((date) => ({ date, sessions: byDate.get(date) ?? [] }));
}

// --- progression ------------------------------------------------------------

/**
 * One point per session that included this exercise, oldest first.
 *
 * Bodyweight movements record reps and no weight, so `topWeight` is 0 for them
 * and `topReps` carries the progression instead. `bodyweight` says which of the
 * two to read.
 */
export function exerciseProgression(state, exerciseId) {
  const points = [];
  for (const session of state?.gymSessions ?? []) {
    const sets = (session.exercises ?? [])
      .filter((x) => x.exerciseId === exerciseId)
      .flatMap((x) => x.sets ?? []);
    if (!sets.length) continue;

    let top = null;
    let reps = 0;
    let volume = 0;
    for (const set of sets) {
      reps += num(set.reps);
      volume += setVolume(set);
      // Heaviest wins; at equal weight, the one with more reps.
      if (!top || num(set.weight) > num(top.weight) ||
        (num(set.weight) === num(top.weight) && num(set.reps) > num(top.reps))) {
        top = set;
      }
    }
    points.push({
      sessionId: session.id,
      date: session.date,
      sets: sets.length,
      reps,
      volume,
      topWeight: num(top?.weight),
      topReps: num(top?.reps),
      bodyweight: sets.every((set) => num(set.weight) === 0),
    });
  }
  return points.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** The sets done for this exercise last time, so entry starts from them. */
export function lastSetsFor(state, exerciseId) {
  for (const session of sessions(state)) {
    for (const entry of session.exercises ?? []) {
      if (entry.exerciseId === exerciseId && (entry.sets ?? []).length) {
        return entry.sets.map((s) => ({ reps: s.reps ?? null, weight: s.weight ?? null }));
      }
    }
  }
  return [];
}

/** Every exercise this log has actually done, for the progression picker. */
export function trainedExerciseIds(state) {
  const seen = new Set();
  for (const session of state?.gymSessions ?? []) {
    for (const entry of session.exercises ?? []) {
      if ((entry.sets ?? []).length) seen.add(entry.exerciseId);
    }
  }
  return [...seen];
}

// --- pain -------------------------------------------------------------------

/** Locations are typed by hand, so they are matched case- and space-insensitively. */
export function normaliseLocation(location) {
  return String(location ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function painRecords(state) {
  return [...(state?.painRecords ?? [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * Pain grouped by where it hurt.
 *
 * The whole reason for recording this is one question: does a pain recur across
 * different exercises, or is it isolated to one? The first is a problem with me,
 * the second is a problem with the movement, and they lead to opposite actions.
 * `recursAcrossExercises` answers it directly rather than leaving it to be read
 * off a list.
 */
export function painByLocation(state) {
  const groups = new Map();

  for (const record of painRecords(state)) {
    const key = normaliseLocation(record.location);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        location: String(record.location).trim(),
        records: [],
        exerciseIds: new Set(),
        during: 0,
        after: 0,
        firstSeen: record.date,
        lastSeen: record.date,
      });
    }
    const group = groups.get(key);
    group.records.push(record);
    if (record.exerciseId) group.exerciseIds.add(record.exerciseId);
    if (record.when === 'after') group.after += 1;
    else group.during += 1;
    if (record.date < group.firstSeen) group.firstSeen = record.date;
    if (record.date > group.lastSeen) group.lastSeen = record.date;
  }

  return [...groups.values()]
    .map((group) => {
      const exerciseIds = [...group.exerciseIds];
      return {
        ...group,
        exerciseIds,
        exerciseNames: exerciseIds.map((id) => exerciseName(state, id)).sort(),
        count: group.records.length,
        // Two or more distinct exercises is the line: below it the movement is
        // the suspect, at or above it the location is.
        recursAcrossExercises: exerciseIds.length >= 2,
      };
    })
    .sort((a, b) => Number(b.recursAcrossExercises) - Number(a.recursAcrossExercises) ||
      b.count - a.count || a.location.localeCompare(b.location));
}

/** A flat dated table, for export. */
export function painTable(state) {
  return painRecords(state).map((record) => ({
    date: record.date,
    location: String(record.location ?? '').trim(),
    exercise: record.exerciseId ? exerciseName(state, record.exerciseId) : '',
    when: record.when === 'after' ? 'after' : 'during',
    note: String(record.note ?? '').replace(/\s+/g, ' ').trim(),
  }));
}

export function painTableCsv(state) {
  const escape = (value) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = painTable(state);
  return [
    ['date', 'location', 'exercise', 'when', 'note'].join(','),
    ...rows.map((row) => [row.date, row.location, row.exercise, row.when, row.note].map(escape).join(',')),
  ].join('\n');
}

export function painTableMarkdown(state) {
  const rows = painTable(state);
  if (!rows.length) return 'No pain recorded.';
  return [
    '| Date | Location | Exercise | During/after | Note |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.date} | ${row.location} | ${row.exercise || '—'} | ${row.when} | ${row.note || '—'} |`),
  ].join('\n');
}

export { MUSCLE_GROUPS };
