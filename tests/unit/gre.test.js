import test from 'node:test';
import assert from 'node:assert/strict';

import {
  blocksForDay,
  blocksNotYetDue,
  dayProgress,
  dayMinutes,
  toggleBlock,
  currentDay,
  isCheckpoint,
  gateStatus,
  moduleReachedBy,
  daysRemaining,
  everyDayBlockStreak,
  isLoggable,
  entries,
  retrievalQueue,
  recordRetrieval,
  retrievalRevealed,
  initialRetrieval,
  causeByPhase,
  portableHits,
  portableHitsByPhase,
  priorEntries,
  greSummary,
  seedBlocks,
} from '../../src/core/gre.js';
import { parseSchedule, fillDates, SCHEDULE_EXAMPLE } from '../../src/core/gre-schedule.js';
import { migrate } from '../../src/core/migrations.js';
import {
  createEmptyState,
  makeGrePhase,
  makeGreDay,
  makeGreEntry,
  makeGreAttempt,
  SCHEMA_VERSION,
} from '../../src/core/schema.js';

const TODAY = '2026-09-05';

function programme() {
  const state = createEmptyState([]);
  seedBlocks(state);

  const foundations = makeGrePhase({ name: 'Foundations', order: 0, gateModule: 12, gateByDay: 14 });
  const consolidation = makeGrePhase({ name: 'Consolidation', order: 1, gateModule: 24, gateByDay: 30 });
  state.grePhases.push(foundations, consolidation);

  const day = (n, date, patch = {}) => {
    const record = makeGreDay({
      dayNumber: n,
      date,
      phaseId: foundations.id,
      blockCodes: ['A', 'B', 'C', 'E1', 'E2', 'F'],
      topics: { C: `topic ${n}`, E2: `verbal ${n}` },
      ...patch,
    });
    state.greDays.push(record);
    return record;
  };

  return { state, foundations, consolidation, day };
}

// --- the shape of a day -----------------------------------------------------

test('the retrieval block is drawn first and hidden until there is anything to retrieve', () => {
  const { state, day } = programme();
  const early = day(1, '2026-09-01');
  const later = day(4, '2026-09-04');

  const dayOne = blocksForDay(state, early).map((entry) => entry.block.code);
  assert.equal(dayOne.includes('A'), false, 'nothing has been logged yet on day one');
  assert.deepEqual(blocksNotYetDue(state, early).map((b) => b.code), ['A']);

  const dayFour = blocksForDay(state, later).map((entry) => entry.block.code);
  assert.equal(dayFour[0], 'A', 'and once it appears, it is always first');
  assert.deepEqual(dayFour, ['A', 'B', 'C', 'E1', 'E2', 'F']);
});

test('a checkpoint replaces the day, except for the block that runs every day', () => {
  const { state, day } = programme();
  const checkpoint = day(14, '2026-09-14', { checkpoint: 'timed quant section plus extraction' });

  assert.equal(isCheckpoint(checkpoint), true);
  assert.deepEqual(blocksForDay(state, checkpoint).map((e) => e.block.code), ['E1'],
    'vocab runs on every single day without exception');
});

test('a block that carries a topic shows the one assigned for that day', () => {
  const { state, day } = programme();
  const record = day(5, '2026-09-05');
  const byCode = Object.fromEntries(blocksForDay(state, record).map((e) => [e.block.code, e]));

  assert.equal(byCode.C.topic, 'topic 5');
  assert.equal(byCode.E2.topic, 'verbal 5');
  assert.equal(byCode.B.topic, '', 'a block with no topic does not invent one');
});

test('a day that lists no topic for a topic block leaves it empty rather than guessing', () => {
  const { state, day } = programme();
  const record = day(6, '2026-09-06', { topics: {} });
  const c = blocksForDay(state, record).find((e) => e.block.code === 'C');
  assert.equal(c.topic, '');
});

test('progress and minutes come from the blocks that actually run', () => {
  const { state, day } = programme();
  const record = day(4, '2026-09-04');

  assert.equal(dayProgress(state, record).total, 6);
  assert.equal(dayProgress(state, record).done, 0);
  assert.equal(dayMinutes(state, record), 25 + 70 + 65 + 20 + 40 + 20);

  toggleBlock(record, 'A');
  toggleBlock(record, 'E1');
  assert.equal(dayProgress(state, record).done, 2);
  toggleBlock(record, 'A');
  assert.equal(dayProgress(state, record).done, 1, 'ticking twice unticks');
});

test('the day shown is today when the schedule has one, otherwise the next', () => {
  const { state, day } = programme();
  day(1, '2026-09-01');
  day(5, TODAY);
  day(6, '2026-09-06');

  assert.equal(currentDay(state, TODAY).dayNumber, 5);
  assert.equal(currentDay(state, '2026-09-03').dayNumber, 5, 'a rest day looks forward');
  assert.equal(currentDay(state, '2026-09-30').dayNumber, 6, 'past the end, the last day stays');
});

// --- gates ------------------------------------------------------------------

test('a gate is met, open or missed — and missed is said plainly', () => {
  const { state, foundations, day } = programme();
  day(1, '2026-09-01');
  const gateDay = day(14, '2026-09-14', { moduleReached: 9 });

  // Before the gate day, it is open rather than failed.
  let gate = gateStatus(state, foundations, { today: '2026-09-05' });
  assert.equal(gate.hasGate, true);
  assert.equal(gate.reached, 9);
  assert.equal(gate.met, false);
  assert.equal(gate.missed, false, 'there is still time');
  assert.equal(gate.daysToGate, 9);

  // After it, nine of twelve is a miss.
  gate = gateStatus(state, foundations, { today: '2026-09-20' });
  assert.equal(gate.missed, true);

  gateDay.moduleReached = 13;
  gate = gateStatus(state, foundations, { today: '2026-09-20' });
  assert.equal(gate.met, true);
  assert.equal(gate.missed, false);
});

test('the module reached is the furthest one recorded up to that day', () => {
  const { state, day } = programme();
  day(1, '2026-09-01', { moduleReached: 3 });
  day(5, '2026-09-05', { moduleReached: 7 });
  day(14, '2026-09-14', { moduleReached: null });

  assert.equal(moduleReachedBy(state, 5), 7);
  assert.equal(moduleReachedBy(state, 14), 7, 'a day the plan did not move does not undo the one before it');
  assert.equal(moduleReachedBy(state, 0), null);
});

test('half a gate is no gate', () => {
  const { state } = programme();
  const phase = makeGrePhase({ name: 'Loose', gateModule: 12, gateByDay: null });
  assert.equal(gateStatus(state, phase, { today: TODAY }).hasGate, false);
});

// --- the window and the streak ---------------------------------------------

test('the countdown counts today and stops at zero', () => {
  const { state, day } = programme();
  day(1, '2026-09-01');
  day(10, '2026-09-10');

  assert.equal(daysRemaining(state, '2026-09-05'), 6);
  assert.equal(daysRemaining(state, '2026-09-10'), 1, 'the last day still counts');
  assert.equal(daysRemaining(state, '2026-09-20'), 0);
  assert.equal(daysRemaining(createEmptyState([])), null);
});

test('the every-day streak survives today not being done yet, and breaks on a real gap', () => {
  const { state, day } = programme();
  const d1 = day(1, '2026-09-01');
  const d2 = day(2, '2026-09-02');
  const d3 = day(3, '2026-09-03');
  const today = day(4, '2026-09-04');

  for (const record of [d1, d2, d3]) toggleBlock(record, 'E1');

  let streak = everyDayBlockStreak(state, '2026-09-04');
  assert.equal(streak.code, 'E1');
  assert.equal(streak.streak, 3, 'the day is not over yet');
  assert.equal(streak.doneToday, false);

  toggleBlock(today, 'E1');
  assert.equal(everyDayBlockStreak(state, '2026-09-04').streak, 4);

  toggleBlock(d2, 'E1'); // untick a day in the middle
  assert.equal(everyDayBlockStreak(state, '2026-09-04').streak, 2, 'a gap ends it');
});

// --- the problem log --------------------------------------------------------

test('an entry without a portable move is not a logged entry', () => {
  assert.equal(isLoggable(makeGreEntry({ portable: 'check units before choosing' })), true);
  assert.equal(isLoggable(makeGreEntry({ portable: '' })), false);
  assert.equal(isLoggable(makeGreEntry({ portable: '   ' })), false);
});

test('a new entry is due for a cold re-attempt three days later', () => {
  const state = createEmptyState([]);
  const schedule = initialRetrieval(state, '2026-09-05');
  assert.equal(schedule.dueDate, '2026-09-08');
  assert.equal(schedule.intervalIndex, 0);
});

test('the queue draws what is due, worst overdue first, and carries no notes', () => {
  const state = createEmptyState([]);
  state.greEntries.push(
    makeGreEntry({ id: 'e1', source: 'OG2 Q47', date: '2026-09-01', dueDate: '2026-09-04', portable: 'check units', gave: 'a ratio problem' }),
    makeGreEntry({ id: 'e2', source: 'OG2 Q12', date: '2026-09-02', dueDate: '2026-09-05', portable: 'read the question last' }),
    makeGreEntry({ id: 'e3', source: 'later', date: '2026-09-04', dueDate: '2026-09-09', portable: 'not yet' }),
  );

  const queue = retrievalQueue(state, { today: '2026-09-05' });
  assert.deepEqual(queue.map((q) => q.entry.id), ['e1', 'e2']);
  assert.equal(queue[0].overdueBy, 1);
  assert.equal(queue[1].overdueBy, 0);

  // The prompt is only enough to find the problem again.
  assert.deepEqual(Object.keys(queue[0].prompt).sort(), ['date', 'id', 'source']);
  assert.equal(queue[0].prompt.gave, undefined, 'a cold re-attempt cannot show what I wrote about it');
});

test('notes stay hidden until a result is recorded today', () => {
  const state = createEmptyState([]);
  const entry = makeGreEntry({ date: '2026-09-01', dueDate: '2026-09-04', portable: 'check units' });
  state.greEntries.push(entry);

  assert.equal(retrievalRevealed(entry, { today: '2026-09-05' }), false);
  recordRetrieval(state, entry, makeGreAttempt({ date: '2026-09-05', correct: true }));
  assert.equal(retrievalRevealed(entry, { today: '2026-09-05' }), true);
  assert.equal(retrievalRevealed(entry, { today: '2026-09-06' }), false, 'a later day is cold again');
});

test('a correct re-attempt advances the chain, a failed one resets it', () => {
  const state = createEmptyState([]);
  const entry = makeGreEntry({ date: '2026-09-01', dueDate: '2026-09-04', portable: 'check units' });
  state.greEntries.push(entry);

  assert.equal(recordRetrieval(state, entry, makeGreAttempt({ date: '2026-09-04', correct: true })), 'advanced');
  assert.equal(entry.dueDate, '2026-09-14', 'ten days after the first re-attempt');

  assert.equal(recordRetrieval(state, entry, makeGreAttempt({ date: '2026-09-14', correct: false })), 'reset');
  assert.equal(entry.dueDate, '2026-09-17', 'back to three days');
  assert.equal(entry.attempts.length, 2);
});

test('a clean re-attempt at the last interval retires the entry', () => {
  const state = createEmptyState([]);
  const entry = makeGreEntry({ date: '2026-09-01', dueDate: '2026-09-04', portable: 'check units', intervalIndex: 1 });
  state.greEntries.push(entry);

  assert.equal(recordRetrieval(state, entry, makeGreAttempt({ date: '2026-09-14', correct: true })), 'retired');
  assert.equal(entry.retired, true);
  assert.equal(retrievalQueue(state, { today: '2026-10-01' }).length, 0);
});

test('the retrieval spacing is configurable rather than a second scheduler', () => {
  const state = createEmptyState([]);
  state.settings.greIntervals = [1, 4, 12];
  const entry = makeGreEntry({ date: '2026-09-01', dueDate: '2026-09-02', portable: 'x' });
  state.greEntries.push(entry);

  recordRetrieval(state, entry, makeGreAttempt({ date: '2026-09-02', correct: true }));
  assert.equal(entry.dueDate, '2026-09-06');
  recordRetrieval(state, entry, makeGreAttempt({ date: '2026-09-06', correct: true }));
  assert.equal(entry.dueDate, '2026-09-18');
});

// --- the audit --------------------------------------------------------------

function logged(state, patch) {
  const entry = makeGreEntry({ portable: 'a rule', ...patch });
  state.greEntries.push(entry);
  return entry;
}

test('the cause breakdown is of misses, so correct answers do not dilute it', () => {
  const { state, foundations, consolidation, day } = programme();
  day(1, '2026-09-01');
  day(20, '2026-09-20', { phaseId: consolidation.id });

  logged(state, { dayNumber: 1, correct: false, cause: 'concept' });
  logged(state, { dayNumber: 1, correct: false, cause: 'concept' });
  logged(state, { dayNumber: 1, correct: false, cause: 'careless' });
  logged(state, { dayNumber: 1, correct: true, cause: 'timing' });

  logged(state, { dayNumber: 20, correct: false, cause: 'concept' });
  logged(state, { dayNumber: 20, correct: false, cause: 'timing' });
  logged(state, { dayNumber: 20, correct: false, cause: 'careless' });
  logged(state, { dayNumber: 20, correct: false, cause: 'format' });

  const rows = causeByPhase(state);
  const early = rows.find((r) => r.name === 'Foundations');
  const late = rows.find((r) => r.name === 'Consolidation');

  assert.equal(early.logged, 4);
  assert.equal(early.misses, 3);
  assert.equal(early.counts.concept, 2);
  assert.equal(Math.round(early.conceptShare * 100), 67);

  assert.equal(late.misses, 4);
  assert.equal(Math.round(late.conceptShare * 100), 25);
  assert.ok(late.conceptShare < early.conceptShare, 'which is the direction the whole thing is measured by');
  assert.ok(foundations && consolidation);
});

test('entries not on a scheduled day are gathered rather than lost from the audit', () => {
  const { state, day } = programme();
  day(1, '2026-09-01');
  logged(state, { dayNumber: 1, correct: false, cause: 'concept' });
  logged(state, { dayNumber: null, correct: false, cause: 'timing' });
  logged(state, { dayNumber: 99, correct: false, cause: 'format' });

  const rows = causeByPhase(state);
  const loose = rows.find((r) => r.name === 'Not on a scheduled day');
  assert.equal(loose.misses, 2);
});

test('a portable move firing on a later problem is the number that counts', () => {
  const { state, day } = programme();
  day(1, '2026-09-01');
  day(20, '2026-09-20');

  const source = logged(state, { dayNumber: 1, date: '2026-09-01', portable: 'check units before answering' });
  logged(state, { dayNumber: 20, date: '2026-09-20', appliedFrom: source.id });
  logged(state, { dayNumber: 20, date: '2026-09-21', appliedFrom: source.id });
  logged(state, { dayNumber: 20, date: '2026-09-22' });

  const hits = portableHits(state);
  assert.equal(hits.total, 2);
  assert.equal(hits.sources.length, 1);
  assert.equal(hits.sources[0].source.id, source.id);
  assert.equal(hits.sources[0].hits.length, 2);
  assert.equal(Math.round(hits.rate * 100), 50);
});

test('a hit pointing at an entry that is gone is not counted', () => {
  const state = createEmptyState([]);
  logged(state, { appliedFrom: 'nonexistent' });
  assert.equal(portableHits(state).total, 0);
});

test('portable-move hits are bucketed by phase, so the trend is visible', () => {
  const { state, consolidation, day } = programme();
  day(1, '2026-09-01');
  day(20, '2026-09-20', { phaseId: consolidation.id });

  const source = logged(state, { dayNumber: 1, date: '2026-09-01' });
  logged(state, { dayNumber: 20, date: '2026-09-20', appliedFrom: source.id });

  const byPhase = portableHitsByPhase(state);
  assert.deepEqual(byPhase, [
    { name: 'Foundations', hits: 0 },
    { name: 'Consolidation', hits: 1 },
  ]);
});

test('only earlier entries with a portable move can be linked to', () => {
  const state = createEmptyState([]);
  const early = logged(state, { date: '2026-09-01', portable: 'a rule' });
  const blank = logged(state, { date: '2026-09-02', portable: '' });
  const later = logged(state, { date: '2026-09-10' });

  const options = priorEntries(state, later).map((e) => e.id);
  assert.ok(options.includes(early.id));
  assert.equal(options.includes(blank.id), false, 'an entry with no move has nothing to apply');
  assert.equal(options.includes(later.id), false, 'and it cannot link to itself');
});

test('the summary answers the whole view in one object', () => {
  const { state, day } = programme();
  day(5, TODAY, { moduleReached: 6 });
  logged(state, { dayNumber: 5, date: TODAY, correct: false, cause: 'concept', dueDate: TODAY });

  const summary = greSummary(state, { today: TODAY });
  assert.equal(summary.logged, 1);
  assert.equal(summary.misses, 1);
  assert.equal(summary.conceptMisses, 1);
  assert.equal(summary.dueToday, 1);
  assert.equal(summary.day.dayNumber, 5);
  assert.equal(summary.phase.name, 'Foundations');
  assert.equal(summary.gate.hasGate, true);
  assert.equal(summary.inWindow, true);
});

// --- the schedule paste -----------------------------------------------------

const CODES = ['A', 'B', 'C', 'D', 'E1', 'E2', 'F'];

test('the example schedule parses completely', () => {
  const parsed = parseSchedule(SCHEDULE_EXAMPLE, { blockCodes: CODES });
  assert.equal(parsed.unparsed.length, 0);
  assert.equal(parsed.stats.phases, 3);
  assert.equal(parsed.stats.days, 7);
  assert.equal(parsed.stats.checkpoints, 1);

  const [first] = parsed.days;
  assert.equal(first.dayNumber, 1);
  assert.equal(first.date, '2026-09-01');
  assert.equal(first.phaseNumber, 1);
  assert.deepEqual(first.blockCodes, ['B', 'C', 'E1', 'E2', 'F']);
  assert.equal(first.topics.C, 'ratios and proportions');
  assert.equal(first.topics.E2, 'text completion');
});

test('phases carry their gate, and a checkpoint day carries its label', () => {
  const parsed = parseSchedule(SCHEDULE_EXAMPLE, { blockCodes: CODES });
  assert.deepEqual(
    parsed.phases.map((p) => [p.number, p.name, p.gateModule, p.gateByDay]),
    [[1, 'Foundations', 12, 14], [2, 'Consolidation', 24, 30], [3, 'Test shape', 30, 42]],
  );

  const checkpoint = parsed.days.find((d) => d.dayNumber === 14);
  assert.equal(checkpoint.checkpoint, 'timed quant section plus extraction');
  assert.equal(checkpoint.moduleReached, 12);
});

test('fields after the day number are order-independent', () => {
  const parsed = parseSchedule(
    'Day 3 | phase 2 | C: geometry | 2026-09-03 | A, B, E1 | module 5',
    { blockCodes: CODES },
  );
  const [day] = parsed.days;
  assert.equal(day.date, '2026-09-03');
  assert.equal(day.phaseNumber, null, 'phase 2 is not defined, so it is not silently attached');
  assert.deepEqual(day.blockCodes, ['A', 'B', 'E1']);
  assert.equal(day.topics.C, 'geometry');
  assert.equal(day.moduleReached, 5);
  assert.match(parsed.warnings.map((w) => w.message).join(' '), /phase 2, which is not defined/);
});

test('a block code that is not a block is named rather than dropped', () => {
  const parsed = parseSchedule('Day 1 | 2026-09-01 | A, B, Z | C: ratios', { blockCodes: CODES });
  assert.deepEqual(parsed.days[0].blockCodes, ['A', 'B']);
  assert.match(parsed.warnings.map((w) => w.message).join(' '), /"Z" is not a block code/);
});

test('lines that could not be read are reported with their number', () => {
  const parsed = parseSchedule(`# Days
Day 1 | 2026-09-01 | B, E1
I should probably move the checkpoint back a week.
`, { blockCodes: CODES });
  assert.equal(parsed.days.length, 1);
  assert.equal(parsed.unparsed.length, 1);
  assert.equal(parsed.unparsed[0].line, 3);
});

test('missing dates are filled in only when asked, and marked when they are', () => {
  const parsed = parseSchedule(`Day 1 | 2026-09-01 | B, E1
Day 2 | B, E1
Day 3 | B, E1`, { blockCodes: CODES });

  assert.equal(parsed.days[1].date, null);
  assert.match(parsed.warnings.map((w) => w.message).join(' '), /2 day\(s\) have no date/);

  const filled = fillDates(parsed.days);
  assert.equal(filled[1].date, '2026-09-02');
  assert.equal(filled[2].date, '2026-09-03');
  assert.equal(filled[1].dateWasInferred, true);
  assert.equal(filled[0].dateWasInferred, undefined, 'a date that was given is not marked as a guess');
});

test('a duplicated day number is flagged', () => {
  const parsed = parseSchedule(`Day 1 | 2026-09-01 | B
Day 1 | 2026-09-02 | C`, { blockCodes: CODES });
  assert.match(parsed.warnings.map((w) => w.message).join(' '), /day 1 appears more than once/);
});

// --- the migration ----------------------------------------------------------

test('v5 gains the GRE collections, empty, with the retrieval spacing', () => {
  const { state, error, notes } = migrate({
    schemaVersion: 5,
    threads: [], notes: [], exercises: [], gymSessions: [], painRecords: [],
    reading: [], timeBlocks: [], settings: {},
  });

  assert.equal(error, null);
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  for (const key of ['greBlocks', 'grePhases', 'greDays', 'greEntries']) {
    assert.deepEqual(state[key], [], `${key} starts empty — the plan is pasted, not shipped`);
  }
  assert.deepEqual(state.settings.greIntervals, [3, 10]);
  assert.ok(notes.some((n) => /\+3 days, then \+10/.test(n)));
});

test('the default blocks are a template, seeded once', () => {
  const state = createEmptyState([]);
  const added = seedBlocks(state);
  assert.equal(added, 7);
  assert.equal(seedBlocks(state), 0);

  const byCode = Object.fromEntries(state.greBlocks.map((b) => [b.code, b]));
  assert.equal(byCode.A.pinFirst, true);
  assert.equal(byCode.A.notBeforeDay, 4);
  assert.equal(byCode.E1.everyDay, true);
  assert.equal(byCode.C.hasTopic, true);
  assert.equal(byCode.E2.hasTopic, true);
  assert.ok(blocksForDay(state, makeGreDay({ dayNumber: 1, blockCodes: [] })).length >= 1,
    'the every-day block runs even on a day that lists nothing');
});
