import test from 'node:test';
import assert from 'node:assert/strict';

import {
  weekCount,
  weekStatus,
  streakWeeks,
  dayStreak,
  consistency,
  toggleLog,
  loggedToday,
  habitsNotLoggedToday,
} from '../../src/core/habits.js';
import { makeHabit } from '../../src/core/schema.js';

function habit(target, log) {
  return Object.assign(makeHabit({ name: 'Gym', weeklyTarget: target }), { log });
}

// Weeks run Sunday to Saturday: Sun 2026-08-02 .. Sat 2026-08-08.
const SUN = '2026-08-02';
const FRI = '2026-08-07';
const SAT = '2026-08-08';

test('the week count only counts days inside the Sunday-to-Saturday week', () => {
  const h = habit(3, ['2026-08-01', SUN, '2026-08-05', SAT, '2026-08-09']);
  assert.equal(weekCount(h, FRI), 3, 'Sat Aug 1 closed the previous week, Sun Aug 9 opens the next');
});

test('a Sunday session counts towards the week it opens, not the one it follows', () => {
  const h = habit(1, ['2026-08-09']);
  assert.equal(weekCount(h, SAT), 0, 'Saturday cannot see the Sunday after it');
  assert.equal(weekCount(h, '2026-08-09'), 1);
  assert.equal(weekCount(h, '2026-08-15'), 1, 'the whole of that week can');
});

test('week status reports progress against the target', () => {
  const h = habit(3, [SUN, '2026-08-05']);
  const status = weekStatus(h, FRI);
  assert.deepEqual({ count: status.count, target: status.target, met: status.met }, { count: 2, target: 3, met: false });
  toggleLog(h, FRI);
  assert.equal(weekStatus(h, FRI).met, true);
});

test('a met target caps the ratio at 1 rather than overflowing', () => {
  const h = habit(2, [SUN, '2026-08-03', '2026-08-04', '2026-08-05']);
  assert.equal(weekStatus(h, FRI).ratio, 1);
});

test('the weekly streak counts consecutive weeks that met target', () => {
  const h = habit(2, [
    '2026-07-12', '2026-07-14', // week of Sun Jul 12
    '2026-07-19', '2026-07-21', // week of Sun Jul 19
    '2026-07-26', '2026-07-28', // week of Sun Jul 26
    SUN, '2026-08-04', // current week, already met
  ]);
  assert.equal(streakWeeks(h, FRI), 4);
});

test('a week still short of target neither extends nor breaks the streak', () => {
  const h = habit(2, ['2026-07-19', '2026-07-21', '2026-07-26', '2026-07-28', SUN]);
  // Current week has 1 of 2 and is still in progress.
  assert.equal(weekStatus(h, FRI).met, false);
  assert.equal(streakWeeks(h, FRI), 2, 'the two completed weeks behind it still count');
});

test('a missed week breaks the streak', () => {
  const h = habit(2, ['2026-07-12', '2026-07-14', '2026-07-26', '2026-07-28', SUN, '2026-08-04']);
  assert.equal(streakWeeks(h, FRI), 2, 'the week of Jul 19 was missed');
});

test('an empty log has no streak', () => {
  assert.equal(streakWeeks(habit(3, []), FRI), 0);
  assert.equal(dayStreak(habit(3, []), FRI), 0);
});

test('a zero target never counts as met', () => {
  const h = habit(0, [SUN, '2026-08-03']);
  assert.equal(weekStatus(h, FRI).met, false);
  assert.equal(streakWeeks(h, FRI), 0);
});

test('the day streak runs back from today, or from yesterday if today is not logged yet', () => {
  const logged = habit(5, ['2026-08-05', '2026-08-06', '2026-08-07']);
  assert.equal(dayStreak(logged, FRI), 3);

  const notYetToday = habit(5, ['2026-08-04', '2026-08-05', '2026-08-06']);
  assert.equal(dayStreak(notYetToday, FRI), 3, 'the day is not over, so the streak survives');

  const brokenTwoDaysAgo = habit(5, [SUN, '2026-08-03']);
  assert.equal(dayStreak(brokenTwoDaysAgo, FRI), 0);
});

test('consistency returns the requested number of weeks, oldest first', () => {
  const h = habit(2, [SUN, '2026-08-04', '2026-07-26']);
  const history = consistency(h, { today: FRI, weeks: 4 });
  assert.equal(history.length, 4);
  assert.deepEqual(history.map((w) => w.weekStart), ['2026-07-12', '2026-07-19', '2026-07-26', '2026-08-02']);
  assert.equal(history[3].current, true);
  assert.equal(history[3].met, true);
  assert.equal(history[2].met, false, 'one of two in the week of Jul 26');
});

test('toggling a log adds then removes the day, keeping the list sorted and unique', () => {
  const h = habit(3, ['2026-08-05']);
  toggleLog(h, SUN);
  assert.deepEqual(h.log, ['2026-08-02', '2026-08-05']);
  toggleLog(h, SUN);
  assert.deepEqual(h.log, ['2026-08-05']);
  toggleLog(h, '2026-08-05');
  assert.deepEqual(h.log, []);
});

test('habits not logged today excludes archived habits', () => {
  const state = {
    habits: [
      habit(3, [FRI]),
      Object.assign(habit(3, []), { name: 'Unlogged' }),
      Object.assign(habit(3, []), { name: 'Archived', archived: true }),
    ],
  };
  const pending = habitsNotLoggedToday(state, FRI);
  assert.deepEqual(pending.map((h) => h.name), ['Unlogged']);
  assert.equal(loggedToday(state.habits[0], FRI), true);
});
