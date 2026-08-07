import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_INTERVALS,
  initialSchedule,
  scheduleAfterAttempt,
  recordAttempt,
  isDue,
  reviewQueue,
  dueCountByBank,
  findDuplicateQuestion,
  mergeQuestion,
  normaliseUrl,
  questionStats,
} from '../../src/core/srs.js';
import { makeQuestion, makeAttempt } from '../../src/core/schema.js';
import { addDays } from '../../src/core/dates.js';

const DAY0 = '2026-08-07';

function question(patch = {}) {
  return Object.assign(makeQuestion({ bank: 'sql', title: 'Window functions' }), {
    createdAt: DAY0,
    dueDate: DAY0,
    intervalIndex: 0,
    ...patch,
  });
}

const solved = (date, hesitation = '') => makeAttempt({ date, unaided: true, minutes: 12, hesitation });
const failed = (date) => makeAttempt({ date, unaided: false, minutes: 30, hesitation: 'no idea where to start' });

// --- the chain --------------------------------------------------------------

test('a new question is due the day it is added', () => {
  const schedule = initialSchedule(DAY0);
  assert.equal(schedule.dueDate, DAY0);
  assert.equal(schedule.intervalIndex, 0);
  assert.equal(schedule.retired, false);
});

test('unaided attempts walk the 0 / 2 / 7 / 21 chain', () => {
  const q = question();
  const steps = [];
  let date = DAY0;
  for (let i = 0; i < 3; i += 1) {
    const patch = scheduleAfterAttempt(q, solved(date), DEFAULT_INTERVALS);
    steps.push({ index: patch.intervalIndex, due: patch.due ?? patch.dueDate, outcome: patch.outcome });
    Object.assign(q, patch);
    date = patch.dueDate;
  }
  assert.deepEqual(
    steps.map((s) => s.index),
    [1, 2, 3],
  );
  assert.equal(steps[0].due, addDays(DAY0, 2));
  assert.equal(steps[1].due, addDays(addDays(DAY0, 2), 7));
  assert.equal(steps[2].due, addDays(addDays(addDays(DAY0, 2), 7), 21));
  assert.deepEqual(steps.map((s) => s.outcome), ['advanced', 'advanced', 'advanced']);
});

test('a failed attempt resets to the start of the chain', () => {
  const q = question({ intervalIndex: 2, dueDate: '2026-08-20' });
  const patch = scheduleAfterAttempt(q, failed('2026-08-20'));
  assert.equal(patch.intervalIndex, 0);
  assert.equal(patch.outcome, 'reset');
  // The first interval is zero days, so a reset question comes back the same
  // day rather than disappearing until tomorrow.
  assert.equal(patch.dueDate, '2026-08-20');
  assert.equal(patch.retired, false);
});

test('an aided attempt resets even with no hesitation recorded', () => {
  const q = question({ intervalIndex: 3 });
  const attempt = makeAttempt({ date: DAY0, unaided: false, minutes: 5, hesitation: '' });
  const patch = scheduleAfterAttempt(q, attempt);
  assert.equal(patch.intervalIndex, 0);
  assert.equal(patch.retired, false);
});

test('a reset from the final interval loses all accumulated spacing', () => {
  const q = question({ intervalIndex: 3, dueDate: '2026-09-01' });
  const patch = scheduleAfterAttempt(q, failed('2026-09-01'));
  assert.equal(patch.intervalIndex, 0);
  assert.equal(patch.dueDate, '2026-09-01');
});

// --- retirement -------------------------------------------------------------

test('a clean unaided solve at the final interval retires the question', () => {
  const q = question({ intervalIndex: 3, dueDate: '2026-09-01' });
  const patch = scheduleAfterAttempt(q, solved('2026-09-01'));
  assert.equal(patch.retired, true);
  assert.equal(patch.retiredAt, '2026-09-01');
  assert.equal(patch.dueDate, null);
  assert.equal(patch.outcome, 'retired');
});

test('hesitation blocks retirement and holds at the final interval', () => {
  const q = question({ intervalIndex: 3, dueDate: '2026-09-01' });
  const patch = scheduleAfterAttempt(q, solved('2026-09-01', 'had to think about the frame clause'));
  assert.equal(patch.retired, false);
  assert.equal(patch.outcome, 'held');
  assert.equal(patch.intervalIndex, 3);
  assert.equal(patch.dueDate, addDays('2026-09-01', 21));
});

test('hesitation before the final interval still advances the chain', () => {
  const q = question({ intervalIndex: 1, dueDate: '2026-08-09' });
  const patch = scheduleAfterAttempt(q, solved('2026-08-09', 'paused on the join order'));
  assert.equal(patch.intervalIndex, 2);
  assert.equal(patch.retired, false);
  assert.equal(patch.outcome, 'advanced');
});

test('whitespace-only hesitation counts as no hesitation', () => {
  const q = question({ intervalIndex: 3 });
  assert.equal(scheduleAfterAttempt(q, solved(DAY0, '   \n ')).retired, true);
});

test('a retired question can be reached only through the full chain', () => {
  const q = question();
  let date = DAY0;
  const outcomes = [];
  for (let i = 0; i < 4; i += 1) {
    outcomes.push(recordAttempt(q, solved(date)));
    date = q.dueDate ?? date;
  }
  assert.deepEqual(outcomes, ['advanced', 'advanced', 'advanced', 'retired']);
  assert.equal(q.retired, true);
  assert.equal(q.attempts.length, 4);
});

test('recordAttempt keeps every attempt, including the failures', () => {
  const q = question();
  recordAttempt(q, solved(DAY0));
  recordAttempt(q, failed('2026-08-09'));
  recordAttempt(q, solved('2026-08-09'));
  assert.equal(q.attempts.length, 3);
  assert.equal(q.intervalIndex, 1);
});

test('custom intervals are respected', () => {
  const q = question();
  const patch = scheduleAfterAttempt(q, solved(DAY0), [0, 1, 3]);
  assert.equal(patch.dueDate, addDays(DAY0, 1));
  const atEnd = scheduleAfterAttempt({ ...q, intervalIndex: 2 }, solved(DAY0), [0, 1, 3]);
  assert.equal(atEnd.retired, true);
});

test('an out-of-range interval index is clamped rather than crashing', () => {
  const patch = scheduleAfterAttempt(question({ intervalIndex: 99 }), solved(DAY0));
  assert.equal(patch.retired, true);
  const negative = scheduleAfterAttempt(question({ intervalIndex: -4 }), solved(DAY0));
  assert.equal(negative.intervalIndex, 1);
});

// --- the queue --------------------------------------------------------------

test('due today includes anything overdue and excludes the future', () => {
  const today = '2026-08-07';
  assert.equal(isDue(question({ dueDate: today }), today), true);
  assert.equal(isDue(question({ dueDate: '2026-08-01' }), today), true);
  assert.equal(isDue(question({ dueDate: '2026-08-08' }), today), false);
});

test('retired questions never appear in the queue', () => {
  const today = '2026-08-07';
  assert.equal(isDue(question({ dueDate: today, retired: true }), today), false);
});

test('the review queue spans all three banks, most overdue first', () => {
  const today = '2026-08-07';
  const state = {
    questions: [
      question({ id: 'a', bank: 'sql', title: 'sql one', dueDate: today }),
      question({ id: 'b', bank: 'leetcode', title: 'lc one', dueDate: '2026-07-28' }),
      question({ id: 'c', bank: 'gre', title: 'gre one', dueDate: '2026-08-30' }),
      question({ id: 'd', bank: 'gre', title: 'gre two', dueDate: '2026-08-05' }),
    ],
  };
  const queue = reviewQueue(state, { today });
  assert.deepEqual(queue.map((entry) => entry.question.id), ['b', 'd', 'a']);
  assert.equal(queue[0].overdueBy, 10);
  assert.deepEqual(dueCountByBank(state, today), { sql: 1, leetcode: 1, gre: 1 });
});

test('the queue can be filtered to one bank', () => {
  const today = '2026-08-07';
  const state = {
    questions: [
      question({ id: 'a', bank: 'sql', dueDate: today }),
      question({ id: 'b', bank: 'gre', dueDate: today }),
    ],
  };
  assert.deepEqual(reviewQueue(state, { today, bank: 'gre' }).map((e) => e.question.id), ['b']);
});

// --- duplicates -------------------------------------------------------------

test('duplicates are detected by URL across banks', () => {
  const existing = question({ id: 'x', url: 'https://leetcode.com/problems/two-sum/' });
  const state = { questions: [existing] };
  const hit = findDuplicateQuestion(state, { bank: 'leetcode', title: 'Different name', url: 'http://www.leetcode.com/problems/two-sum' });
  assert.equal(hit.question.id, 'x');
  assert.equal(hit.on, 'url');
});

test('duplicates are detected by title within the same bank only', () => {
  const state = { questions: [question({ id: 'x', bank: 'sql', title: 'Second Highest Salary', url: '' })] };
  assert.equal(findDuplicateQuestion(state, { bank: 'sql', title: 'second highest salary!', url: '' }).on, 'title');
  assert.equal(findDuplicateQuestion(state, { bank: 'gre', title: 'Second Highest Salary', url: '' }), null);
});

test('merging a duplicate keeps every attempt from both', () => {
  const existing = question({ id: 'x', tags: ['sql'], notes: 'old' });
  existing.attempts = [solved('2026-08-01')];
  const incoming = { ...question({ id: 'y', tags: ['window'], notes: 'new' }), attempts: [failed('2026-08-03')] };
  const merged = mergeQuestion(existing, incoming);
  assert.equal(merged.attempts.length, 2);
  assert.deepEqual(merged.attempts.map((a) => a.date), ['2026-08-01', '2026-08-03']);
  assert.deepEqual(merged.tags, ['sql', 'window']);
  assert.match(merged.notes, /old/);
  assert.match(merged.notes, /new/);
});

test('URL normalisation ignores scheme, www and trailing slash', () => {
  assert.equal(normaliseUrl('https://www.Example.com/a/'), 'example.com/a');
  assert.equal(normaliseUrl('  '), '');
});

test('question stats report the unaided rate', () => {
  const q = question();
  q.attempts = [failed(DAY0), solved(DAY0), solved(DAY0)];
  const stats = questionStats([q, question({ retired: true })]);
  assert.equal(stats.total, 2);
  assert.equal(stats.retired, 1);
  assert.equal(stats.attempts, 3);
  assert.equal(Math.round(stats.unaidedRate * 100), 67);
});
