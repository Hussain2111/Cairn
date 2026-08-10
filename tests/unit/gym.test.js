import test from 'node:test';
import assert from 'node:assert/strict';

import {
  weekProgress,
  muscleCoverage,
  sessionsFor,
  sessionsInWeek,
  sessionTotals,
  sessionMuscles,
  exerciseName,
  exerciseUsage,
  exerciseNameTaken,
  activeExercises,
  exerciseProgression,
  lastSetsFor,
  syncGymLog,
  seedExercises,
  isGymHabit,
} from '../../src/core/gym.js';
import {
  createEmptyState,
  makeHabit,
  makeExercise,
  makeGymSession,
  makeSessionExercise,
  makeSet,
} from '../../src/core/schema.js';

// Weeks run Sunday to Saturday: Sun 2026-08-02 .. Sat 2026-08-08.
const FRI = '2026-08-07';

function fixture({ target = 4 } = {}) {
  const state = createEmptyState([]);
  const habit = makeHabit({ name: 'Gym', weeklyTarget: target, kind: 'gym' });
  state.habits.push(habit);

  const bench = makeExercise({ name: 'Bench press', muscle: 'chest' });
  const row = makeExercise({ name: 'Barbell row', muscle: 'back' });
  const squat = makeExercise({ name: 'Squat', muscle: 'legs' });
  state.exercises.push(bench, row, squat);

  const add = (date, entries, patch = {}) => {
    const session = makeGymSession({ habitId: habit.id, date, ...patch });
    session.exercises = entries.map(([exercise, sets]) =>
      makeSessionExercise({
        exerciseId: exercise.id,
        sets: sets.map(([reps, weight]) => makeSet({ reps, weight })),
      }));
    state.gymSessions.push(session);
    return session;
  };

  return { state, habit, bench, row, squat, add };
}

// --- the week ---------------------------------------------------------------

test('the week counts sessions inside the Sunday-to-Saturday week only', () => {
  const { state, habit, bench, add } = fixture();
  add('2026-08-01', [[bench, [[10, 60]]]]); // Sat, previous week
  add('2026-08-02', [[bench, [[10, 60]]]]); // Sun, this week
  add('2026-08-05', [[bench, [[10, 60]]]]);
  add('2026-08-09', [[bench, [[10, 60]]]]); // Sun, next week
  syncGymLog(state, habit.id);

  assert.equal(sessionsInWeek(state, habit.id, FRI).length, 2);

  const progress = weekProgress(state, habit, FRI);
  assert.equal(progress.weekStart, '2026-08-02');
  assert.equal(progress.weekEnd, '2026-08-08');
  assert.equal(progress.done, 2);
  assert.equal(progress.target, 4);
  assert.equal(progress.remaining, 2);
  assert.equal(progress.daysLeft, 2, 'Friday and Saturday');
  assert.equal(progress.met, false);
});

test('going past the target is not a debt', () => {
  const { state, habit, bench, add } = fixture({ target: 2 });
  add('2026-08-03', [[bench, [[10, 60]]]]);
  add('2026-08-04', [[bench, [[10, 60]]]]);
  add('2026-08-05', [[bench, [[10, 60]]]]);
  const progress = weekProgress(state, habit, FRI);
  assert.equal(progress.done, 3);
  assert.equal(progress.remaining, 0);
  assert.equal(progress.met, true);
});

test('the habit log is a mirror of the session dates', () => {
  const { state, habit, bench, add } = fixture();
  add('2026-08-03', [[bench, [[10, 60]]]]);
  add('2026-08-03', [[bench, [[8, 65]]]], { startTime: '18:00' }); // two in one day
  add('2026-08-05', [[bench, [[10, 60]]]]);

  syncGymLog(state, habit.id);
  assert.deepEqual(habit.log, ['2026-08-03', '2026-08-05'], 'one entry per day, sorted');

  // A stale log left by hand is corrected, not merged.
  habit.log = ['2020-01-01'];
  syncGymLog(state, habit.id);
  assert.deepEqual(habit.log, ['2026-08-03', '2026-08-05']);
});

test('a simple habit keeps its hand-kept log', () => {
  const state = createEmptyState([]);
  const simple = makeHabit({ name: 'Reading', weeklyTarget: 5 });
  simple.log = ['2026-08-03'];
  state.habits.push(simple);
  assert.equal(isGymHabit(simple), false);
  syncGymLog(state, simple.id);
  assert.deepEqual(simple.log, ['2026-08-03'], 'sessions have no business here');
});

// --- muscle coverage --------------------------------------------------------

test('muscle coverage reports which groups the week has touched and which it has not', () => {
  const { state, habit, bench, row, add } = fixture();
  add('2026-08-03', [[bench, [[10, 60], [8, 65]]]]);
  add('2026-08-05', [[row, [[10, 50]]], [bench, [[6, 70]]]]);

  const coverage = muscleCoverage(state, habit.id, FRI);
  const byMuscle = Object.fromEntries(coverage.map((c) => [c.muscle, c]));

  assert.equal(byMuscle.chest.sets, 3);
  assert.equal(byMuscle.chest.sessions, 2);
  assert.equal(byMuscle.chest.trained, true);
  assert.equal(byMuscle.back.sets, 1);
  assert.equal(byMuscle.legs.trained, false, 'nothing for legs this week');
  assert.equal(byMuscle.legs.sets, 0);

  // Every group is listed even when untrained — the gaps are the point.
  assert.deepEqual(coverage.map((c) => c.muscle), ['chest', 'back', 'shoulders', 'legs', 'arms', 'core']);
});

test('an untrained group says how long it has actually been', () => {
  const { state, habit, squat, bench, add } = fixture();
  add('2026-07-22', [[squat, [[5, 100]]]]); // three weeks back
  add('2026-08-03', [[bench, [[10, 60]]]]);

  const coverage = muscleCoverage(state, habit.id, FRI);
  const legs = coverage.find((c) => c.muscle === 'legs');
  assert.equal(legs.trained, false);
  assert.equal(legs.lastTrained, '2026-07-22');

  const arms = coverage.find((c) => c.muscle === 'arms');
  assert.equal(arms.lastTrained, null, 'never trained reads as never, not as long ago');
});

test('an exercise logged with no sets does not light up its muscle group', () => {
  const { state, habit, bench, add } = fixture();
  add('2026-08-03', [[bench, []]]);
  const chest = muscleCoverage(state, habit.id, FRI).find((c) => c.muscle === 'chest');
  assert.equal(chest.trained, false);
  assert.deepEqual(sessionMuscles(state, state.gymSessions[0]), []);
});

// --- the catalogue ----------------------------------------------------------

test('retiring an exercise hides it from the picker without touching history', () => {
  const { state, habit, bench, add } = fixture();
  add('2026-08-03', [[bench, [[10, 60], [8, 65]]]]);
  syncGymLog(state, habit.id);

  bench.retired = true;

  assert.equal(activeExercises(state).some((e) => e.id === bench.id), false, 'gone from the picker');
  assert.equal(exerciseName(state, bench.id), 'Bench press', 'still named in the session');
  assert.deepEqual(exerciseUsage(state, bench.id), { sessions: 1, sets: 2 });
  assert.equal(sessionTotals(state.gymSessions[0]).sets, 2);
  const chest = muscleCoverage(state, habit.id, FRI).find((c) => c.muscle === 'chest');
  assert.equal(chest.sets, 2, 'the week it was done still counts it');
});

test('an exercise that is gone entirely is named rather than rendered blank', () => {
  const { state, habit, bench, add } = fixture();
  add('2026-08-03', [[bench, [[10, 60]]]]);
  state.exercises = state.exercises.filter((e) => e.id !== bench.id);

  assert.equal(exerciseName(state, bench.id), 'Removed exercise');
  assert.equal(sessionTotals(state.gymSessions[0]).sets, 1, 'the sets are still the record');
  // Its group can no longer be resolved, so it stops counting — better than
  // guessing at a group it might not have trained.
  const chest = muscleCoverage(state, habit.id, FRI).find((c) => c.muscle === 'chest');
  assert.equal(chest.sets, 0);
});

test('duplicate exercise names are caught, retired ones included', () => {
  const { state, bench } = fixture();
  assert.equal(exerciseNameTaken(state, 'Bench press'), true);
  assert.equal(exerciseNameTaken(state, '  bench PRESS '), true, 'case and spacing do not make it new');
  assert.equal(exerciseNameTaken(state, 'Bench press', bench.id), false, 'renaming itself is fine');
  bench.retired = true;
  assert.equal(exerciseNameTaken(state, 'Bench press'), true, 'a retired name is still taken');
});

test('the starter list seeds once and never duplicates', () => {
  const state = createEmptyState([]);
  const first = seedExercises(state);
  assert.ok(first > 10);
  assert.equal(seedExercises(state), 0);
  assert.equal(state.exercises.length, first);
});

// --- progression ------------------------------------------------------------

test('progression is oldest first and headlines the heaviest set', () => {
  const { state, bench, add } = fixture();
  add('2026-08-05', [[bench, [[8, 65], [6, 70]]]]);
  add('2026-07-22', [[bench, [[10, 60], [10, 60]]]]);
  add('2026-07-29', [[bench, [[10, 62.5]]]]);

  const points = exerciseProgression(state, bench.id);
  assert.deepEqual(points.map((p) => p.date), ['2026-07-22', '2026-07-29', '2026-08-05']);
  assert.equal(points[2].topWeight, 70);
  assert.equal(points[2].topReps, 6);
  assert.equal(points[2].sets, 2);
  assert.equal(points[2].reps, 14);
  assert.equal(points[0].volume, 10 * 60 + 10 * 60);
});

test('at equal weight the heavier set is the one with more reps', () => {
  const { state, bench, add } = fixture();
  add('2026-08-05', [[bench, [[6, 70], [9, 70], [12, 40]]]]);
  const [point] = exerciseProgression(state, bench.id);
  assert.equal(point.topWeight, 70);
  assert.equal(point.topReps, 9);
});

test('a bodyweight set counts reps but adds no volume', () => {
  const { state, add } = fixture();
  const pullup = makeExercise({ name: 'Pull-up', muscle: 'back' });
  state.exercises.push(pullup);
  add('2026-08-05', [[pullup, [[12, null], [10, null]]]]);
  const totals = sessionTotals(state.gymSessions[0]);
  assert.equal(totals.reps, 22);
  assert.equal(totals.volume, 0);
});

test('adding an exercise offers the sets from the last time it was done', () => {
  const { state, habit, bench, add } = fixture();
  add('2026-07-22', [[bench, [[10, 60]]]]);
  add('2026-08-05', [[bench, [[8, 65], [6, 70]]]]);

  assert.deepEqual(lastSetsFor(state, habit.id, bench.id), [
    { reps: 8, weight: 65 },
    { reps: 6, weight: 70 },
  ]);
});

test('two sessions on the same day still have a defined order', () => {
  const { state, habit, bench, add } = fixture();
  const first = add('2026-08-05', [[bench, [[10, 60]]]]);
  const second = add('2026-08-05', [[bench, [[8, 70]]]]);
  // Same date, no start time, and the timestamps can land in the same second.
  first.createdAt = second.createdAt = '2026-08-05T18:00:00';

  assert.deepEqual(sessionsFor(state, habit.id).map((s) => s.id), [second.id, first.id]);
  // Which is what makes "repeat last time" repeat the right one.
  assert.deepEqual(lastSetsFor(state, habit.id, bench.id), [{ reps: 8, weight: 70 }]);
});

test('an exercise never done before offers nothing to repeat', () => {
  const { state, habit, squat } = fixture();
  assert.deepEqual(lastSetsFor(state, habit.id, squat.id), []);
});

test('one habit cannot repeat another habit\'s sets', () => {
  const { state, bench, add } = fixture();
  const other = makeHabit({ name: 'Climbing', weeklyTarget: 2, kind: 'gym' });
  state.habits.push(other);
  add('2026-08-05', [[bench, [[8, 65]]]]);
  assert.deepEqual(lastSetsFor(state, other.id, bench.id), []);
});
