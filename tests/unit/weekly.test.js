import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWeeklyReview, weeklyReviewMarkdown } from '../../src/core/weekly.js';
import { weeklyDistribution, plannedMinutes, actualMinutes, overlaps, dayTotals } from '../../src/core/timeblocks.js';
import { search } from '../../src/core/search.js';
import { createEmptyState, makeThread, makeStage, makeStep, makeTask, makeQuestion, makeApplication, makeHabit, makeTimeBlock } from '../../src/core/schema.js';

const TODAY = '2026-08-07'; // Friday; the week runs Sun 02 -> Sat 08

function fixture() {
  const state = createEmptyState([]);

  const thread = makeThread({ name: 'Compiler' });
  thread.createdAt = '2026-05-01T09:00:00';
  const stage = makeStage({ title: 'Lexer', doneWhen: 'all tokens tested' });
  const step = makeStep({ title: 'Numbers' });
  const inWeek = makeTask({ title: 'Integer literals' });
  inWeek.done = true;
  inWeek.doneAt = '2026-08-05T14:00:00';
  const lastWeek = makeTask({ title: 'Comments' });
  lastWeek.done = true;
  lastWeek.doneAt = '2026-07-30T14:00:00';
  const open = makeTask({ title: 'Float literals' });
  step.tasks.push(inWeek, lastWeek, open);
  stage.steps.push(step);
  thread.stages.push(stage);
  state.threads.push(thread);

  const quiet = makeThread({ name: 'GRE prep' });
  quiet.createdAt = '2026-04-01T09:00:00';
  const quietStage = makeStage({ title: 'Quant', doneWhen: 'sections timed' });
  const quietStep = makeStep({ title: 'Algebra' });
  quietStep.tasks.push(makeTask({ title: 'Inequalities' }));
  quietStage.steps.push(quietStep);
  quiet.stages.push(quietStage);
  state.threads.push(quiet);

  const question = makeQuestion({ bank: 'sql', title: 'Window functions' });
  question.attempts = [
    { id: 'a1', date: '2026-08-04', unaided: false, minutes: 25, hesitation: 'frame clause syntax' },
    { id: 'a2', date: '2026-07-20', unaided: true, minutes: 8, hesitation: '' },
  ];
  const retired = makeQuestion({ bank: 'leetcode', title: 'Two Sum' });
  retired.retired = true;
  retired.retiredAt = '2026-08-06';
  state.questions.push(question, retired);

  state.applications.push(
    makeApplication({ company: 'Acme', role: 'Backend engineer', dateApplied: '2026-08-04', source: 'LinkedIn' }),
    makeApplication({ company: 'Old Co', role: 'Engineer', dateApplied: '2026-06-01' }),
  );

  const habit = makeHabit({ name: 'Gym', weeklyTarget: 3 });
  habit.log = ['2026-08-03', '2026-08-05', '2026-08-06'];
  state.habits.push(habit);

  state.timeBlocks.push(
    makeTimeBlock({ date: '2026-08-04', start: '09:00', end: '12:00', threadId: thread.id, actualStart: '09:30', actualEnd: '11:00' }),
    makeTimeBlock({ date: '2026-08-05', start: '13:00', end: '14:00', threadId: quiet.id, actualStart: '13:00', actualEnd: '13:30' }),
    makeTimeBlock({ date: '2026-07-28', start: '09:00', end: '17:00', threadId: thread.id, actualStart: '09:00', actualEnd: '17:00' }),
  );

  return state;
}

// --- time blocks ------------------------------------------------------------

test('planned and actual minutes come from the two time pairs', () => {
  const block = makeTimeBlock({ start: '09:00', end: '12:00', actualStart: '09:30', actualEnd: '11:00' });
  assert.equal(plannedMinutes(block), 180);
  assert.equal(actualMinutes(block), 90);
  assert.equal(actualMinutes(makeTimeBlock({ actualStart: null, actualEnd: null })), 0);
});

test('overlapping blocks on the same day are detected, adjacent ones are not', () => {
  const a = makeTimeBlock({ date: TODAY, start: '09:00', end: '10:00' });
  const b = makeTimeBlock({ date: TODAY, start: '09:30', end: '10:30' });
  const c = makeTimeBlock({ date: TODAY, start: '10:00', end: '11:00' });
  const other = makeTimeBlock({ date: '2026-08-08', start: '09:30', end: '10:30' });
  assert.equal(overlaps(a, b), true);
  assert.equal(overlaps(a, c), false, 'back-to-back blocks do not overlap');
  assert.equal(overlaps(a, other), false);
});

test('the weekly distribution only counts blocks inside the week', () => {
  const state = fixture();
  const dist = weeklyDistribution(state, { today: TODAY });
  assert.equal(dist.weekStart, '2026-08-02');
  assert.equal(dist.planned, 240, 'the 8h block in the previous week is excluded');
  assert.equal(dist.actual, 120);
  assert.equal(dist.rows[0].name, 'Compiler');
  assert.equal(dist.rows[0].actual, 90);
  assert.equal(dist.rows[0].drift, -90, 'planned 3h, did 1h30');
  assert.equal(Math.round(dist.rows[0].shareActual * 100), 75);
});

test('day totals gather the blocks for one date', () => {
  const totals = dayTotals(fixture(), '2026-08-04');
  assert.equal(totals.blocks.length, 1);
  assert.equal(totals.planned, 180);
  assert.equal(totals.actual, 90);
  assert.equal(totals.logged, 1);
});

// --- weekly review ----------------------------------------------------------

test('the weekly review separates what moved from what did not', () => {
  const report = generateWeeklyReview(fixture(), { today: TODAY });
  assert.equal(report.weekStart, '2026-08-02');
  assert.equal(report.weekEnd, '2026-08-08');
  assert.deepEqual(report.moved.map((t) => t.thread.name), ['Compiler']);
  assert.deepEqual(report.didNotMove.map((t) => t.thread.name), ['GRE prep']);
  assert.equal(report.totals.tasksCompleted, 1, 'the task finished last week is not counted');
});

test('the review counts question attempts and retirements inside the week only', () => {
  const report = generateWeeklyReview(fixture(), { today: TODAY });
  assert.equal(report.questions.attempts, 1);
  assert.equal(report.questions.unaided, 0);
  assert.deepEqual(report.questions.retired.map((q) => q.title), ['Two Sum']);
});

test('the review counts applications sent inside the week only', () => {
  const report = generateWeeklyReview(fixture(), { today: TODAY });
  assert.equal(report.pipeline.applicationsSent, 1);
});

test('the review flags stalled threads', () => {
  const report = generateWeeklyReview(fixture(), { today: TODAY });
  assert.deepEqual(report.stalled.map((t) => t.thread.name), ['GRE prep']);
});

test('habit progress for the week is included', () => {
  const report = generateWeeklyReview(fixture(), { today: TODAY });
  assert.equal(report.habits[0].count, 3);
  assert.equal(report.habits[0].met, true);
});

test('the markdown export carries the substance of the report', () => {
  const md = weeklyReviewMarkdown(generateWeeklyReview(fixture(), { today: TODAY }));
  assert.match(md, /^# Weekly review/m);
  assert.match(md, /Integer literals/);
  assert.match(md, /\*\*Did not move\.\*\*/);
  assert.match(md, /frame clause syntax/, 'hesitations are what make the review worth reading');
  assert.match(md, /Backend engineer at Acme/);
  assert.match(md, /Gym: 3\/3/);
  assert.match(md, /## Time/);
  assert.doesNotMatch(md, /undefined/);
  assert.doesNotMatch(md, /\[object Object\]/);
});

test('a week with nothing in it still produces a readable report', () => {
  const md = weeklyReviewMarkdown(generateWeeklyReview(createEmptyState([]), { today: TODAY }));
  assert.match(md, /_No active threads\._/);
  assert.doesNotMatch(md, /undefined/);
});

// --- search -----------------------------------------------------------------

test('search reaches tasks, questions, applications and hesitations', () => {
  const state = fixture();
  assert.ok(search(state, 'integer').some((r) => r.type === 'task' && r.title === 'Integer literals'));
  assert.ok(search(state, 'window').some((r) => r.type === 'question'));
  assert.ok(search(state, 'acme').some((r) => r.type === 'application'));
  assert.ok(search(state, 'frame clause').some((r) => r.type === 'question'), 'what I hesitated on is searchable');
  assert.ok(search(state, 'lexer').some((r) => r.type === 'stage'));
});

test('search needs at least two characters and returns routes to jump to', () => {
  const state = fixture();
  assert.deepEqual(search(state, 'a'), []);
  const hit = search(state, 'integer')[0];
  assert.match(hit.route, /^#\/thread\//);
});

test('a ranking bonus never turns a non-match into a result', () => {
  // The bonus applied to titles used to be added unconditionally, which made
  // every thread, note and question match every query.
  const state = fixture();
  const results = search(state, 'frame clause');
  assert.deepEqual(results.map((r) => r.type), ['question']);
  assert.deepEqual(search(state, 'zzzzzz'), []);
});

test('search ranks exact title matches above body matches', () => {
  const state = createEmptyState([]);
  state.notes.push({ id: 'n1', title: 'Parser', body: 'nothing relevant', attach: null });
  state.notes.push({ id: 'n2', title: 'Unrelated', body: 'a long note that mentions parser somewhere inside it', attach: null });
  const results = search(state, 'parser');
  assert.equal(results[0].id, 'n1');
});
