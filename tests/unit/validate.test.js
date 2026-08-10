import test from 'node:test';
import assert from 'node:assert/strict';

import { validateImport } from '../../src/core/validate.js';
import { migrate } from '../../src/core/migrations.js';
import { createEmptyState, SCHEMA_VERSION, makeThread, makeStage, makeStep, makeTask } from '../../src/core/schema.js';
import { builtinTemplates } from '../../src/core/templates.js';

function goodState() {
  const state = createEmptyState(builtinTemplates());
  const thread = makeThread({ name: 'Compiler', type: 'project' });
  const stage = makeStage({ title: 'Lexer', doneWhen: 'every token type has a passing test' });
  const step = makeStep({ title: 'Numbers' });
  step.tasks.push(makeTask({ title: 'Integer literals' }));
  stage.steps.push(step);
  thread.stages.push(stage);
  state.threads.push(thread);
  return state;
}

const messages = (list) => list.map((e) => `${e.path}: ${e.message}`).join(' | ');

// --- happy path -------------------------------------------------------------

test('a well-formed export round-trips exactly', () => {
  const state = goodState();
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.state.threads[0].stages[0].steps[0].tasks[0].title, 'Integer literals');
  assert.deepEqual(result.summary, {
    threads: 1,
    stages: 1,
    tasks: 1,
    notes: 0,
    questions: 0,
    applications: 0,
    outreach: 0,
    habits: 0,
    exercises: 0,
    gymSessions: 0,
    chessGames: 0,
    reading: 0,
    timeBlocks: 0,
  });
});

test('an object may be passed instead of a JSON string', () => {
  assert.equal(validateImport(goodState()).ok, true);
});

// --- hard failures ----------------------------------------------------------

test('malformed JSON is refused with the parser message', () => {
  const result = validateImport('{ "threads": [ ');
  assert.equal(result.ok, false);
  assert.equal(result.state, null);
  assert.match(messages(result.errors), /not valid JSON/);
});

test('an empty file is refused', () => {
  const result = validateImport('   ');
  assert.equal(result.ok, false);
  assert.match(messages(result.errors), /empty/);
});

test('a non-object top level is refused', () => {
  assert.match(messages(validateImport('[1,2,3]').errors), /expected a JSON object/);
  assert.match(messages(validateImport('"hello"').errors), /expected a JSON object/);
});

test('a file that is not a Cairn export is refused rather than half-loaded', () => {
  const result = validateImport(JSON.stringify({ some: 'other app', items: [] }));
  assert.equal(result.ok, false);
  assert.match(messages(result.errors), /does not look like a Cairn export/);
});

test('a newer schema version is refused with an actionable message', () => {
  const result = validateImport(JSON.stringify({ ...createEmptyState([]), schemaVersion: SCHEMA_VERSION + 5 }));
  assert.equal(result.ok, false);
  assert.match(messages(result.errors), /only understands up to v/);
});

test('a collection of the wrong type is a hard error, not a silent reset', () => {
  const state = { ...createEmptyState([]), threads: { nope: true } };
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.ok, false);
  assert.equal(result.state, null);
  assert.match(messages(result.errors), /threads: expected an array/);
});

test('a non-object record inside a collection is an error and the import is refused', () => {
  const state = createEmptyState([]);
  state.threads.push('just a string');
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.ok, false);
  assert.match(messages(result.errors), /thread is not an object/);
});

test('duplicate thread ids are refused', () => {
  const state = createEmptyState([]);
  const a = makeThread({ name: 'A' });
  const b = makeThread({ name: 'B' });
  b.id = a.id;
  state.threads.push(a, b);
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.ok, false);
  assert.match(messages(result.errors), /duplicate id/);
});

// --- repairs are reported, never silent -------------------------------------

test('an invalid due date is cleared and reported, and the task is kept', () => {
  const state = goodState();
  state.threads[0].stages[0].steps[0].tasks[0].due = '2026-02-30';
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.ok, true);
  assert.equal(result.state.threads[0].stages[0].steps[0].tasks[0].due, null);
  assert.equal(result.state.threads[0].stages[0].steps[0].tasks.length, 1, 'the task itself survives');
  assert.match(messages(result.warnings), /not a valid YYYY-MM-DD date/);
});

test('an unknown thread type falls back and says so', () => {
  const state = goodState();
  state.threads[0].type = 'wizardry';
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.state.threads[0].type, 'project');
  assert.match(messages(result.warnings), /not one of/);
});

test('a title of the wrong type is coerced rather than dropped', () => {
  const state = goodState();
  state.threads[0].stages[0].steps[0].tasks[0].title = 12345;
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.state.threads[0].stages[0].steps[0].tasks[0].title, '12345');
  assert.match(messages(result.warnings), /coerced/);
});

test('missing collections are backfilled and reported', () => {
  const partial = { schemaVersion: SCHEMA_VERSION, threads: [] };
  const result = validateImport(JSON.stringify(partial));
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.questions, []);
  assert.deepEqual(result.state.habits, []);
  assert.ok(result.notes.some((n) => /questions/.test(n)));
  assert.ok(result.state.noteTemplates.length >= 5, 'built-in templates are restored');
});

test('records missing ids are given one instead of being discarded', () => {
  const state = goodState();
  delete state.threads[0].stages[0].steps[0].tasks[0].id;
  delete state.threads[0].stages[0].id;
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.ok, true);
  assert.ok(result.state.threads[0].stages[0].id);
  assert.ok(result.state.threads[0].stages[0].steps[0].tasks[0].id);
});

test('a done task with no completion date is kept but flagged', () => {
  const state = goodState();
  state.threads[0].stages[0].steps[0].tasks[0].done = true;
  state.threads[0].stages[0].steps[0].tasks[0].doneAt = null;
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.ok, true);
  assert.equal(result.state.threads[0].stages[0].steps[0].tasks[0].done, true);
  assert.match(messages(result.warnings), /done but has no completion date/);
});

test('a stray completion date on an open task is cleared', () => {
  const state = goodState();
  state.threads[0].stages[0].steps[0].tasks[0].doneAt = '2026-01-01T09:00:00';
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.state.threads[0].stages[0].steps[0].tasks[0].doneAt, null);
});

test('invalid habit log dates are dropped with a count, and valid ones survive', () => {
  const state = createEmptyState([]);
  state.habits.push({ id: 'h1', name: 'Running', weeklyTarget: 3, log: ['2026-08-03', 'yesterday', '2026-08-03', '2026-13-40'], archived: false });
  const result = validateImport(JSON.stringify(state));
  assert.deepEqual(result.state.habits[0].log, ['2026-08-03']);
  assert.match(messages(result.warnings), /3 invalid or duplicate log date/);
});

test('a time block pointing at a missing thread is kept, unassigned', () => {
  const state = goodState();
  state.timeBlocks.push({ id: 'b1', date: '2026-08-07', start: '09:00', end: '10:00', activity: 'thread:thr_gone', taskId: 'task_gone', label: 'Deep work' });
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.ok, true);
  assert.equal(result.state.timeBlocks.length, 1);
  assert.equal(result.state.timeBlocks[0].activity, null);
  assert.match(messages(result.warnings), /not in this file/);
});

test('an invalid block time is cleared and the block is retained', () => {
  const state = createEmptyState([]);
  state.timeBlocks.push({ id: 'b1', date: '2026-08-07', start: '25:00', end: '10:00' });
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.state.timeBlocks.length, 1);
  assert.equal(result.state.timeBlocks[0].start, null);
  assert.match(messages(result.warnings), /not a valid HH:MM/);
});

test('a corrupt interval index is reset to the start of the chain', () => {
  const state = createEmptyState([]);
  state.questions.push({ id: 'q1', bank: 'sql', title: 'Q', url: '', tags: [], difficulty: 'medium', attempts: [], intervalIndex: 'three', dueDate: '2026-08-07', retired: false });
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.state.questions[0].intervalIndex, 0);
  assert.match(messages(result.warnings), /interval chain/);
});

test('attempts with unparseable dates are kept, not deleted', () => {
  const state = createEmptyState([]);
  state.questions.push({
    id: 'q1', bank: 'gre', title: 'Q', url: '', tags: [], difficulty: 'hard', intervalIndex: 0, dueDate: '2026-08-07', retired: false,
    attempts: [{ id: 'a1', date: 'last tuesday', unaided: true, minutes: 10, hesitation: 'inequalities' }],
  });
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.state.questions[0].attempts.length, 1);
  assert.equal(result.state.questions[0].attempts[0].hesitation, 'inequalities');
  assert.match(messages(result.warnings), /attempt date/);
});

test('nothing is dropped from a file full of small problems', () => {
  const state = goodState();
  const step = state.threads[0].stages[0].steps[0];
  step.tasks.push(makeTask({ title: 'B' }), makeTask({ title: 'C' }));
  step.tasks[1].due = 'soon';
  step.tasks[2].estimateMinutes = 'a while';
  state.threads[0].stages[0].links = [{ id: 'l1', url: 'https://example.com', label: '' }];
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.ok, true);
  assert.equal(result.state.threads[0].stages[0].steps[0].tasks.length, 3);
  assert.equal(result.state.threads[0].stages[0].steps[0].tasks[2].estimateMinutes, null);
  assert.equal(result.state.threads[0].stages[0].links.length, 1, 'a link with no label is still a link');
});

test('a link with no URL is removed and reported', () => {
  const state = goodState();
  state.threads[0].links = [{ id: 'l1', url: '', label: 'dead' }];
  const result = validateImport(JSON.stringify(state));
  assert.equal(result.state.threads[0].links.length, 0);
  assert.match(messages(result.warnings), /no URL/);
});

// --- migrations -------------------------------------------------------------

test('a v1 file migrates: per-bank lists flatten into one', () => {
  const v1 = {
    schemaVersion: 1,
    settings: {},
    threads: [],
    notes: [],
    noteTemplates: [],
    applications: [],
    outreach: [],
    habits: [],
    reading: [],
    timeBlocks: [],
    archivedStages: [],
    banks: {
      sql: [{ id: 'q1', title: 'Joins', url: '', tags: [], difficulty: 'easy', attempts: [], intervalIndex: 0, dueDate: '2026-08-07' }],
      leetcode: [{ id: 'q2', title: 'Two Sum', url: '', tags: [], difficulty: 'easy', attempts: [], intervalIndex: 1, dueDate: '2026-08-09' }],
      gre: [],
    },
  };
  const result = validateImport(JSON.stringify(v1));
  assert.equal(result.ok, true);
  assert.equal(result.state.schemaVersion, SCHEMA_VERSION);
  assert.equal(result.state.banks, undefined);
  assert.deepEqual(result.state.questions.map((q) => [q.id, q.bank]), [['q1', 'sql'], ['q2', 'leetcode']]);
  assert.ok(result.notes.some((n) => /migrated from schema v1/.test(n)));
});

test('a v1 stored stage completion becomes an explicit force-complete', () => {
  const v1 = {
    schemaVersion: 1,
    threads: [{ id: 't1', name: 'Old', type: 'project', stages: [{ id: 's1', title: 'Done stage', doneWhen: 'x', done: true, steps: [] }] }],
  };
  const result = validateImport(JSON.stringify(v1));
  assert.equal(result.ok, true);
  const stage = result.state.threads[0].stages[0];
  assert.equal(stage.forceCompleted, true);
  assert.equal(stage.done, undefined);
  assert.ok(result.notes.some((n) => /force-completed/.test(n)));
});

test('an unversioned but Cairn-shaped file is treated as v1 with a warning', () => {
  const result = validateImport(JSON.stringify({ threads: [], banks: { sql: [], leetcode: [], gre: [] } }));
  assert.equal(result.ok, true);
  assert.match(messages(result.warnings), /assuming v1/);
});

test('migrate reports a missing migration rather than guessing', () => {
  const out = migrate({ schemaVersion: 0 });
  assert.match(out.error, /older than the oldest supported version/);
});

test('migrate leaves a current-version state untouched', () => {
  const state = goodState();
  const out = migrate(state);
  assert.equal(out.error, null);
  assert.deepEqual(out.applied, []);
});
