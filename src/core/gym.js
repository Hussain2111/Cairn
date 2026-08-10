// Gym sessions.
//
// A gym habit is still a habit: it has a weekly target and a log of dates, and
// everything that reads habits -- Today, the weekly review, streaks -- keeps
// working unchanged. What it adds is a session per logged day, recording what
// was actually done, so the week can be judged on coverage rather than
// attendance.
//
// The log is a mirror of the session dates, rebuilt by syncGymLog after every
// change. Nothing else is allowed to write it for a gym habit, so the two can
// never disagree.

import { todayISO, startOfWeek, endOfWeek, weekDates, daysLeftInWeek, withinRange } from './dates.js';
import { MUSCLE_GROUPS, STARTER_EXERCISES, makeExercise } from './schema.js';

export function isGymHabit(habit) {
  return habit?.kind === 'gym';
}

export function gymHabits(state) {
  return (state?.habits ?? []).filter((h) => isGymHabit(h) && !h.archived);
}

// --- the exercise catalogue -------------------------------------------------

const byMuscleThenName = (a, b) =>
  MUSCLE_GROUPS.indexOf(a.muscle) - MUSCLE_GROUPS.indexOf(b.muscle) ||
  String(a.name).localeCompare(String(b.name));

export function allExercises(state) {
  return [...(state?.exercises ?? [])].sort(byMuscleThenName);
}

export function activeExercises(state) {
  return allExercises(state).filter((e) => !e.retired);
}

export function exerciseById(state, id) {
  return (state?.exercises ?? []).find((e) => e.id === id) ?? null;
}

/**
 * The name to show for an id found in a session. A retired exercise still
 * resolves -- retiring only removes it from the picker -- and an id with no
 * record left at all is named rather than rendered blank.
 */
export function exerciseName(state, id) {
  return exerciseById(state, id)?.name ?? 'Removed exercise';
}

export function exerciseMuscle(state, id) {
  return exerciseById(state, id)?.muscle ?? null;
}

/** How many sessions reference this exercise. Retiring is safe; deleting is not. */
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

/** True when a name is already taken by another exercise, retired or not. */
export function exerciseNameTaken(state, name, exceptId = null) {
  const wanted = String(name ?? '').trim().toLowerCase();
  if (!wanted) return false;
  return (state?.exercises ?? []).some(
    (e) => e.id !== exceptId && String(e.name).trim().toLowerCase() === wanted,
  );
}

// --- sessions ---------------------------------------------------------------

/**
 * Newest first. Two sessions on the same day are ordered by start time, and
 * when that is missing too -- it is optional -- by when they were written, so
 * the list never shuffles between renders.
 */
export function sessionsFor(state, habitId) {
  return (state?.gymSessions ?? [])
    .filter((s) => s.habitId === habitId)
    // Reversed before sorting so that when date, time and stamp are all equal,
    // the stable sort leaves the most recently written one first. Timestamps
    // are only accurate to the second, and two sessions can share one.
    .reverse()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) ||
      String(b.startTime ?? '').localeCompare(String(a.startTime ?? '')) ||
      String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}

export function sessionsInWeek(state, habitId, iso = todayISO()) {
  const start = startOfWeek(iso);
  const end = endOfWeek(iso);
  return sessionsFor(state, habitId).filter((s) => withinRange(s.date, start, end));
}

export function sessionById(state, id) {
  return (state?.gymSessions ?? []).find((s) => s.id === id) ?? null;
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** Reps × weight. A bodyweight set (no weight) contributes reps but no volume. */
export function setVolume(set) {
  return num(set?.reps) * num(set?.weight);
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
  return { exercises: (session?.exercises ?? []).length, sets, reps, volume };
}

/** Muscle groups touched by one session, in the canonical order. */
export function sessionMuscles(state, session) {
  const seen = new Set();
  for (const entry of session?.exercises ?? []) {
    const muscle = exerciseMuscle(state, entry.exerciseId);
    if (muscle && (entry.sets ?? []).length) seen.add(muscle);
  }
  return MUSCLE_GROUPS.filter((m) => seen.has(m));
}

// --- the week ---------------------------------------------------------------

/**
 * Sessions done against the weekly target, and how much week is left to make
 * up the difference. `remaining` never goes negative -- going over target is
 * not a debt.
 */
export function weekProgress(state, habit, iso = todayISO()) {
  const done = sessionsInWeek(state, habit?.id, iso).length;
  const target = Math.max(0, Number(habit?.weeklyTarget) || 0);
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
 * What has been trained this week and what has not. This is the view that
 * changes behaviour: an untrained group with days left is what today's session
 * should be.
 */
export function muscleCoverage(state, habitId, iso = todayISO()) {
  const week = sessionsInWeek(state, habitId, iso);
  const tally = new Map(MUSCLE_GROUPS.map((m) => [m, { sets: 0, sessions: new Set() }]));

  for (const session of week) {
    for (const entry of session.exercises ?? []) {
      const muscle = exerciseMuscle(state, entry.exerciseId);
      if (!muscle || !tally.has(muscle)) continue;
      const bucket = tally.get(muscle);
      bucket.sets += (entry.sets ?? []).length;
      if ((entry.sets ?? []).length) bucket.sessions.add(session.id);
    }
  }

  // "Last trained" looks past the week, so an untrained group can say how long
  // it has actually been rather than just "not this week".
  const last = lastTrainedByMuscle(state, habitId);

  return MUSCLE_GROUPS.map((muscle) => {
    const bucket = tally.get(muscle);
    return {
      muscle,
      sets: bucket.sets,
      sessions: bucket.sessions.size,
      trained: bucket.sets > 0,
      lastTrained: last.get(muscle) ?? null,
    };
  });
}

export function lastTrainedByMuscle(state, habitId) {
  const last = new Map();
  for (const session of sessionsFor(state, habitId)) {
    for (const muscle of sessionMuscles(state, session)) {
      if (!last.has(muscle)) last.set(muscle, session.date);
    }
  }
  return last;
}

// --- progression ------------------------------------------------------------

/**
 * One point per session that included this exercise, oldest first. The heaviest
 * set is the headline -- it is what "is anything moving?" actually asks.
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
    });
  }
  return points.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/**
 * The sets done for this exercise last time, so a new session can start from
 * them instead of an empty form.
 */
export function lastSetsFor(state, habitId, exerciseId) {
  for (const session of sessionsFor(state, habitId)) {
    for (const entry of session.exercises ?? []) {
      if (entry.exerciseId === exerciseId && (entry.sets ?? []).length) {
        return entry.sets.map((s) => ({ reps: s.reps ?? null, weight: s.weight ?? null }));
      }
    }
  }
  return [];
}

// --- keeping the habit log honest -------------------------------------------

/**
 * Rebuild a gym habit's date log from its sessions. Called after every session
 * write so the weekly target, the streak and the weekly review all see the same
 * days the history does.
 */
export function syncGymLog(state, habitId) {
  const habit = (state?.habits ?? []).find((h) => h.id === habitId);
  if (!habit || !isGymHabit(habit)) return habit ?? null;
  habit.log = [...new Set(sessionsFor(state, habitId).map((s) => s.date))].sort();
  return habit;
}

/** Day squares for the current week, marked with whether a session happened. */
export function weekDaySessions(state, habitId, iso = todayISO()) {
  const byDate = new Map();
  for (const session of sessionsInWeek(state, habitId, iso)) {
    if (!byDate.has(session.date)) byDate.set(session.date, []);
    byDate.get(session.date).push(session);
  }
  return weekDates(startOfWeek(iso)).map((date) => ({
    date,
    sessions: byDate.get(date) ?? [],
  }));
}

/**
 * The first gym habit seeds a starter catalogue, so a session can be logged
 * immediately instead of typing out sixteen exercise names first. It only ever
 * runs into an empty list, so it can never duplicate what is already there.
 */
export function seedExercises(state) {
  if (!Array.isArray(state.exercises) || state.exercises.length) return 0;
  for (const [name, muscle] of STARTER_EXERCISES) {
    state.exercises.push(makeExercise({ name, muscle }));
  }
  return state.exercises.length;
}
