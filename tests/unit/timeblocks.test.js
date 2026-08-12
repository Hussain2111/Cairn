import test from 'node:test';
import assert from 'node:assert/strict';

import {
  blockMinutes,
  plannedMinutes,
  loggedMinutes,
  isLogged,
  overlaps,
  dayTotals,
  weeklyDistribution,
  blocksReferencingThread,
} from '../../src/core/timeblocks.js';
import {
  parseActivity,
  activityLabel,
  activityRoute,
  activityOptions,
  activityThreadId,
  normaliseActivity,
  threadActivity,
  areaActivity,
} from '../../src/core/activities.js';
import { migrate } from '../../src/core/migrations.js';
import { createEmptyState, makeThread, makeTimeBlock, SCHEMA_VERSION } from '../../src/core/schema.js';

const TODAY = '2026-08-07'; // Friday; the week runs Sun 02 – Sat 08

// --- activities -------------------------------------------------------------

test('an activity is a namespaced reference, and nonsense reads as unassigned', () => {
  assert.deepEqual(parseActivity('thread:abc'), { kind: 'thread', id: 'abc' });
  assert.deepEqual(parseActivity('area:gym'), { kind: 'area', id: 'gym' });
  assert.deepEqual(parseActivity(''), { kind: 'none', id: null });
  assert.deepEqual(parseActivity(null), { kind: 'none', id: null });
  assert.deepEqual(parseActivity('gym'), { kind: 'none', id: null }, 'a bare word is not an activity');
  assert.deepEqual(parseActivity('thread:'), { kind: 'none', id: null });
  assert.deepEqual(parseActivity('something:else'), { kind: 'none', id: null });
});

test('an id that looks like an area name cannot be mistaken for one', () => {
  const state = createEmptyState();
  const thread = makeThread({ name: 'A project called gym' });
  thread.id = 'gym';
  state.threads.push(thread);

  assert.equal(activityLabel(state, threadActivity('gym')), 'A project called gym');
  assert.equal(activityLabel(state, areaActivity('gym')), 'Gym');
});

test('a deleted thread is named as gone, not as unassigned', () => {
  const state = createEmptyState();
  assert.equal(activityLabel(state, 'thread:missing'), 'A deleted thread');
  assert.equal(activityLabel(state, null), 'Unassigned');
  assert.equal(activityRoute(state, 'thread:missing'), null, 'and does not link anywhere');
});

test('the picker offers every thread and every standing area', () => {
  const state = createEmptyState();
  state.threads.push(makeThread({ name: 'Compiler' }), Object.assign(makeThread({ name: 'Old' }), { status: 'done' }));

  const options = activityOptions(state);
  const labels = options.map((o) => o.label);
  assert.ok(labels.includes('Compiler'));
  assert.equal(labels.includes('Old'), false, 'finished threads are not offered');
  for (const area of ['Gym', 'GRE practice', 'LeetCode practice', 'SQL practice', 'Reading', 'Applications and outreach']) {
    assert.ok(labels.includes(area), `${area} is assignable`);
  }
});

test('the group separators in the picker are not choices', () => {
  assert.equal(normaliseActivity('__threads'), null);
  assert.equal(normaliseActivity('__areas'), null);
  assert.equal(normaliseActivity(''), null);
  assert.equal(normaliseActivity('area:gym'), 'area:gym');
  assert.equal(activityThreadId('area:gym'), null);
  assert.equal(activityThreadId('thread:t1'), 't1');
});

// --- planned versus logged --------------------------------------------------

test('a block counts towards planned or logged, never both', () => {
  const plan = makeTimeBlock({ start: '09:00', end: '12:00' });
  const done = makeTimeBlock({ start: '09:30', end: '11:00', status: 'logged' });

  assert.equal(blockMinutes(plan), 180);
  assert.equal(plannedMinutes(plan), 180);
  assert.equal(loggedMinutes(plan), 0);
  assert.equal(isLogged(plan), false);

  assert.equal(plannedMinutes(done), 0);
  assert.equal(loggedMinutes(done), 90);
  assert.equal(isLogged(done), true);
});

test('a logged block sitting on the plan it fulfils is not an overlap', () => {
  const plan = makeTimeBlock({ date: TODAY, start: '09:00', end: '12:00' });
  const done = makeTimeBlock({ date: TODAY, start: '09:30', end: '11:00', status: 'logged' });
  assert.equal(overlaps(plan, done), false, 'different kinds of thing');

  const otherPlan = makeTimeBlock({ date: TODAY, start: '11:00', end: '13:00' });
  assert.equal(overlaps(plan, otherPlan), true, 'two plans for the same hour do clash');

  const otherDone = makeTimeBlock({ date: TODAY, start: '10:30', end: '11:30', status: 'logged' });
  assert.equal(overlaps(done, otherDone), true, 'and so do two records of the same hour');
});

test('the day separates what was planned from what was done', () => {
  const state = createEmptyState();
  state.timeBlocks.push(
    makeTimeBlock({ date: TODAY, start: '09:00', end: '12:00', activity: 'area:gre' }),
    makeTimeBlock({ date: TODAY, start: '09:30', end: '11:00', activity: 'area:gre', status: 'logged' }),
    makeTimeBlock({ date: TODAY, start: '18:00', end: '19:00', activity: 'area:gym', status: 'logged' }),
  );

  const totals = dayTotals(state, TODAY);
  assert.equal(totals.blocks.length, 3);
  assert.equal(totals.planned, 180);
  assert.equal(totals.logged, 150, 'the gym hour was never planned and still counts');
  assert.equal(totals.plannedCount, 1);
  assert.equal(totals.loggedCount, 2);
});

test('the weekly distribution counts areas alongside threads', () => {
  const state = createEmptyState();
  const thread = makeThread({ name: 'Compiler' });
  state.threads.push(thread);
  state.timeBlocks.push(
    makeTimeBlock({ date: '2026-08-03', start: '09:00', end: '12:00', activity: threadActivity(thread.id) }),
    makeTimeBlock({ date: '2026-08-03', start: '09:00', end: '10:00', activity: threadActivity(thread.id), status: 'logged' }),
    makeTimeBlock({ date: '2026-08-04', start: '18:00', end: '19:30', activity: 'area:gym', status: 'logged' }),
    makeTimeBlock({ date: '2026-08-05', start: '07:00', end: '09:00', activity: null, status: 'logged' }),
    // Previous week, excluded.
    makeTimeBlock({ date: '2026-07-30', start: '09:00', end: '17:00', activity: 'area:gym', status: 'logged' }),
  );

  const week = weeklyDistribution(state, { today: TODAY });
  assert.equal(week.weekStart, '2026-08-02');
  assert.equal(week.planned, 180);
  assert.equal(week.logged, 60 + 90 + 120);

  const byName = Object.fromEntries(week.rows.map((r) => [r.name, r]));
  assert.equal(byName.Compiler.planned, 180);
  assert.equal(byName.Compiler.logged, 60);
  assert.equal(byName.Compiler.drift, -120, 'planned three hours, did one');
  assert.equal(byName.Gym.logged, 90);
  assert.equal(byName.Gym.planned, 0, 'never planned, and that is the point');
  assert.equal(byName.Unassigned.logged, 120);
});

test('blocks are found by the thread they point at', () => {
  const state = createEmptyState();
  const thread = makeThread({ name: 'Compiler' });
  state.threads.push(thread);
  state.timeBlocks.push(
    makeTimeBlock({ date: TODAY, activity: threadActivity(thread.id) }),
    makeTimeBlock({ date: TODAY, activity: 'area:gym' }),
  );
  assert.equal(blocksReferencingThread(state, thread.id).length, 1);
});

// --- the migration ----------------------------------------------------------

test('a v3 block with both time pairs becomes a plan and a separate record', () => {
  const v3 = {
    ...createEmptyState(),
    schemaVersion: 3,
    timeBlocks: [{
      id: 'b1',
      date: TODAY,
      start: '09:00',
      end: '12:00',
      actualStart: '09:30',
      actualEnd: '11:00',
      threadId: 't1',
      taskId: 'task1',
      label: 'Deep work',
      notes: 'went badly',
    }],
    threads: [Object.assign(makeThread({ name: 'Compiler' }), { id: 't1' })],
  };

  const { state, error, notes } = migrate(v3);
  assert.equal(error, null);
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.equal(state.timeBlocks.length, 2, 'nothing was averaged away');

  const plan = state.timeBlocks.find((b) => b.status === 'planned');
  const done = state.timeBlocks.find((b) => b.status === 'logged');

  assert.deepEqual([plan.start, plan.end], ['09:00', '12:00']);
  assert.deepEqual([done.start, done.end], ['09:30', '11:00']);
  assert.equal(plan.activity, 'thread:t1');
  assert.equal(done.activity, 'thread:t1');
  assert.equal(done.notes, 'went badly', 'the note was about the doing');
  assert.equal(plan.threadId, undefined);
  assert.equal(plan.actualStart, undefined);
  assert.ok(notes.some((n) => /split/.test(n)));
});

test('a v3 block that was only ever logged stays one block', () => {
  const v3 = {
    ...createEmptyState(),
    schemaVersion: 3,
    timeBlocks: [
      { id: 'b1', date: TODAY, start: null, end: null, actualStart: '18:00', actualEnd: '19:00', threadId: null },
      { id: 'b2', date: TODAY, start: '09:00', end: '10:00', actualStart: null, actualEnd: null, threadId: null },
    ],
  };
  const { state, error } = migrate(v3);
  assert.equal(error, null);
  assert.equal(state.timeBlocks.length, 2);

  const logged = state.timeBlocks.find((b) => b.id === 'b1');
  assert.equal(logged.status, 'logged');
  assert.deepEqual([logged.start, logged.end], ['18:00', '19:00']);

  const planned = state.timeBlocks.find((b) => b.id === 'b2');
  assert.equal(planned.status, 'planned');
});
