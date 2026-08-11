// The gym.
//
// This is the only thing tracked by session rather than by tick, because *that
// I went* is not the useful part. What matters is which muscles the week has
// touched, whether a load is moving, whether a pain follows one exercise or
// follows me, and which variants of a movement I can actually do.
//
// Weeks run Sunday to Saturday, from the one constant in dates.js.

import { todayISO, startOfWeek, endOfWeek, weekDates, daysLeftInWeek, withinRange, timeToMinutes } from './dates.js';
import {
  MUSCLE_GROUPS,
  EQUIPMENT_TYPES,
  REAL_EQUIPMENT,
  STARTER_EXERCISES,
  STARTER_ROUTINES,
  makeExercise,
  makeRoutine,
} from './schema.js';

// --- the library ------------------------------------------------------------

const byMuscleThenName = (a, b) =>
  MUSCLE_GROUPS.indexOf(a.muscle) - MUSCLE_GROUPS.indexOf(b.muscle) ||
  String(a.name).localeCompare(String(b.name));

export function allExercises(state) {
  return [...(state?.exercises ?? [])].sort(byMuscleThenName);
}

/** What a session can pick from. Untried counts: trying it is the point. */
export function activeExercises(state) {
  return allExercises(state).filter((e) => e.status !== 'dropped');
}

export function exercisesByStatus(state, status) {
  return allExercises(state).filter((e) => e.status === status);
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

export function exerciseMuscle(state, id) {
  return exerciseById(state, id)?.muscle ?? null;
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

export function findExerciseByName(state, name) {
  const wanted = String(name ?? '').trim().toLowerCase();
  if (!wanted) return null;
  return (state?.exercises ?? []).find((e) => String(e.name).trim().toLowerCase() === wanted) ?? null;
}

// --- equipment preference ---------------------------------------------------

/**
 * What each kind of equipment is actually worth to me.
 *
 * The reason this view exists: cable and machine variants of a movement can
 * work where the free-weight variant does not, and without counting it that
 * gets rediscovered every few months. `droppedForPain` is separated from the
 * other drop reasons because it is the one that means something about the body
 * rather than about preference or the gym being busy.
 */
export function equipmentPreference(state, { today = todayISO() } = {}) {
  const rows = new Map(EQUIPMENT_TYPES.map((equipment) => [equipment, {
    equipment,
    total: 0,
    active: 0,
    untried: 0,
    dropped: 0,
    droppedForPain: 0,
    droppedForDislike: 0,
    droppedForAvailability: 0,
    sets: 0,
    sessions: new Set(),
    lastUsed: null,
    painReports: 0,
  }]));

  for (const exercise of state?.exercises ?? []) {
    const row = rows.get(exercise.equipment) ?? rows.get('unspecified');
    row.total += 1;
    if (exercise.status === 'active') row.active += 1;
    else if (exercise.status === 'untried') row.untried += 1;
    else if (exercise.status === 'dropped') {
      row.dropped += 1;
      if (exercise.dropReason === 'pain') row.droppedForPain += 1;
      else if (exercise.dropReason === 'disliked') row.droppedForDislike += 1;
      else if (exercise.dropReason === 'unavailable') row.droppedForAvailability += 1;
    }
  }

  for (const session of state?.gymSessions ?? []) {
    for (const entry of session.exercises ?? []) {
      const exercise = exerciseById(state, entry.exerciseId);
      if (!exercise) continue;
      const row = rows.get(exercise.equipment) ?? rows.get('unspecified');
      row.sets += (entry.sets ?? []).length;
      if ((entry.sets ?? []).length) {
        row.sessions.add(session.id);
        if (!row.lastUsed || session.date > row.lastUsed) row.lastUsed = session.date;
      }
    }
  }

  for (const record of state?.painRecords ?? []) {
    const exercise = exerciseById(state, record.exerciseId);
    if (!exercise) continue;
    const row = rows.get(exercise.equipment) ?? rows.get('unspecified');
    row.painReports += 1;
  }

  const totalSets = [...rows.values()].reduce((sum, row) => sum + row.sets, 0);
  return [...rows.values()]
    .map((row) => ({
      ...row,
      sessions: row.sessions.size,
      shareOfSets: totalSets ? row.sets / totalSets : 0,
      // Kept > 0 and nothing dropped for pain is the shape worth noticing.
      keepRate: row.total ? row.active / row.total : 0,
    }))
    .filter((row) => row.total || row.sets)
    .sort((a, b) => b.sets - a.sets || b.total - a.total);
}

// --- routines ---------------------------------------------------------------

export function routines(state) {
  return [...(state?.routines ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function routineById(state, id) {
  return (state?.routines ?? []).find((r) => r.id === id) ?? null;
}

export function routineName(state, id) {
  return routineById(state, id)?.name ?? null;
}

/**
 * Which slot is due next: the one after the last session that named a slot.
 * An A/B rotation is the whole point, and deviating from it stays free — this
 * only decides what the form offers first.
 */
export function nextRoutine(state) {
  const list = routines(state);
  if (!list.length) return null;
  const last = sessions(state).find((s) => s.routineId && routineById(state, s.routineId));
  if (!last) return list[0];
  const index = list.findIndex((r) => r.id === last.routineId);
  if (index < 0) return list[0];
  return list[(index + 1) % list.length];
}

export function seedLibrary(state) {
  let added = 0;
  if (Array.isArray(state.exercises) && !state.exercises.length) {
    for (const [name, muscle, secondary, equipment] of STARTER_EXERCISES) {
      state.exercises.push(makeExercise({ name, muscle, secondary, equipment }));
      added += 1;
    }
  }
  if (Array.isArray(state.routines) && !state.routines.length) {
    for (const routine of STARTER_ROUTINES) state.routines.push(makeRoutine(routine));
  }
  return added;
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

/** Clock times if both are there, otherwise whatever was recorded by hand. */
export function sessionMinutes(session) {
  const start = timeToMinutes(session?.startTime);
  const end = timeToMinutes(session?.endTime);
  if (start !== null && end !== null && end > start) return end - start;
  return num(session?.durationMinutes) || 0;
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
    skipped: (session?.skipped ?? []).length,
    sets,
    reps,
    volume,
    minutes: sessionMinutes(session),
  };
}

/** Every group a session touched, primary and secondary. */
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

export function weekProgress(state, iso = todayISO()) {
  const done = sessionsInWeek(state, iso).length;
  const target = weeklyTarget(state);
  return {
    weekStart: startOfWeek(iso),
    weekEnd: endOfWeek(iso),
    done,
    target,
    remaining: Math.max(0, target - done),
    daysLeft: daysLeftInWeek(iso),
    met: target > 0 && done >= target,
  };
}

/**
 * What the week has trained and what it has not. The gaps are the output: an
 * untrained group with days left is what today's session should be.
 *
 * A secondary muscle counts, but is tallied apart from primary work, because
 * "back got hit as a secondary on three pressing days" is not a back day.
 */
export function muscleCoverage(state, iso = todayISO()) {
  const week = sessionsInWeek(state, iso);
  const tally = new Map(MUSCLE_GROUPS.map((m) => [m, { primarySets: 0, secondarySets: 0, sessions: new Set() }]));

  for (const session of week) {
    for (const entry of session.exercises ?? []) {
      const count = (entry.sets ?? []).length;
      if (!count) continue;
      const exercise = exerciseById(state, entry.exerciseId);
      if (!exercise) continue;
      const primary = tally.get(exercise.muscle);
      if (primary) {
        primary.primarySets += count;
        primary.sessions.add(session.id);
      }
      for (const muscle of exercise.secondary ?? []) {
        const row = tally.get(muscle);
        if (row) {
          row.secondarySets += count;
          row.sessions.add(session.id);
        }
      }
    }
  }

  const last = lastTrainedByMuscle(state);
  return MUSCLE_GROUPS.map((muscle) => {
    const row = tally.get(muscle);
    return {
      muscle,
      primarySets: row.primarySets,
      secondarySets: row.secondarySets,
      sets: row.primarySets + row.secondarySets,
      sessions: row.sessions.size,
      trained: row.primarySets > 0,
      touched: row.primarySets + row.secondarySets > 0,
      lastTrained: last.get(muscle) ?? null,
    };
  });
}

export function lastTrainedByMuscle(state) {
  const last = new Map();
  for (const session of sessions(state)) {
    for (const entry of session.exercises ?? []) {
      if (!(entry.sets ?? []).length) continue;
      const exercise = exerciseById(state, entry.exerciseId);
      if (!exercise) continue;
      if (!last.has(exercise.muscle)) last.set(exercise.muscle, session.date);
    }
  }
  return last;
}

/**
 * Muscle groups with nothing usable left to train them with — every exercise
 * dropped, or never tried. This is the report that turns a slow drift into a
 * visible hole before a whole group quietly stops being trained.
 */
export function gapReport(state) {
  const gaps = [];
  for (const muscle of MUSCLE_GROUPS) {
    const forMuscle = (state?.exercises ?? []).filter((e) => e.muscle === muscle);
    const active = forMuscle.filter((e) => e.status === 'active');
    const untried = forMuscle.filter((e) => e.status === 'untried');
    const dropped = forMuscle.filter((e) => e.status === 'dropped');
    if (active.length) continue;
    gaps.push({
      muscle,
      total: forMuscle.length,
      untried,
      dropped,
      droppedForPain: dropped.filter((e) => e.dropReason === 'pain').length,
      // Nothing at all is a different problem from "everything I had, I stopped".
      reason: forMuscle.length === 0 ? 'nothing in the library' : untried.length ? 'only untried options' : 'everything dropped',
    });
  }
  return gaps;
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

export function weekDaySessions(state, iso = todayISO()) {
  const byDate = new Map();
  for (const session of sessionsInWeek(state, iso)) {
    if (!byDate.has(session.date)) byDate.set(session.date, []);
    byDate.get(session.date).push(session);
  }
  return weekDates(startOfWeek(iso)).map((date) => ({ date, sessions: byDate.get(date) ?? [] }));
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

export { MUSCLE_GROUPS, EQUIPMENT_TYPES, REAL_EQUIPMENT };
