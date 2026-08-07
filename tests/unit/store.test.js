import test from 'node:test';
import assert from 'node:assert/strict';

import { Store } from '../../src/app/store.js';
import { makeThread, makeStage, makeStep, makeTask } from '../../src/core/schema.js';

/** A localStorage stand-in, optionally with a byte budget. */
class MemoryStorage {
  constructor({ limit = Infinity } = {}) {
    this.map = new Map();
    this.limit = limit;
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    if (String(value).length > this.limit) {
      const error = new Error('quota');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

function seededStore(storage = new MemoryStorage()) {
  const store = new Store({ storage });
  store.load();
  store.mutate('add thread', (state) => {
    const thread = makeThread({ name: 'Compiler' });
    const stage = makeStage({ title: 'Lexer', doneWhen: 'tokens tested' });
    const step = makeStep({ title: 'Numbers' });
    step.tasks.push(makeTask({ title: 'Integer literals' }));
    stage.steps.push(step);
    thread.stages.push(stage);
    state.threads.push(thread);
  });
  return store;
}

test('a fresh store starts empty with the built-in templates seeded', () => {
  const store = new Store({ storage: new MemoryStorage() });
  store.load();
  assert.deepEqual(store.state.threads, []);
  assert.ok(store.state.noteTemplates.length >= 5);
});

test('state survives a save and reload', () => {
  const storage = new MemoryStorage();
  const store = seededStore(storage);

  const reopened = new Store({ storage });
  reopened.load();
  assert.equal(reopened.state.threads[0].name, 'Compiler');
  assert.equal(reopened.state.threads[0].stages[0].steps[0].tasks[0].title, 'Integer literals');
});

test('export then import round-trips state exactly', () => {
  const store = seededStore();
  const exported = store.exportJSON();

  const fresh = new Store({ storage: new MemoryStorage() });
  fresh.load();
  const report = fresh.importJSON(exported);
  assert.equal(report.ok, true);
  assert.deepEqual(fresh.state.threads, store.state.threads);
  assert.deepEqual(fresh.state.questions, store.state.questions);
  assert.deepEqual(fresh.state.settings, store.state.settings);
});

test('a rejected import leaves existing state untouched', () => {
  const store = seededStore();
  const before = JSON.stringify(store.state.threads);
  const report = store.importJSON('{ broken');
  assert.equal(report.ok, false);
  assert.equal(JSON.stringify(store.state.threads), before);
});

test('an import can be undone', () => {
  const store = seededStore();
  const other = new Store({ storage: new MemoryStorage() });
  other.load();
  other.mutate('other thread', (state) => state.threads.push(makeThread({ name: 'Elsewhere' })));

  store.importJSON(other.exportJSON());
  assert.equal(store.state.threads[0].name, 'Elsewhere');
  store.undo();
  assert.equal(store.state.threads[0].name, 'Compiler');
});

test('merge import keeps both sides and does not duplicate shared ids', () => {
  const store = seededStore();
  const exported = JSON.parse(store.exportJSON());
  exported.threads.push(makeThread({ name: 'Extra' }));

  store.importJSON(JSON.stringify(exported), { merge: true });
  assert.deepEqual(store.state.threads.map((t) => t.name), ['Compiler', 'Extra']);
});

test('undo restores the previous state and redo reapplies it', () => {
  const store = seededStore();
  store.mutate('delete thread', (state) => state.threads.splice(0, 1));
  assert.equal(store.state.threads.length, 0);

  assert.equal(store.undo(), 'delete thread');
  assert.equal(store.state.threads.length, 1);

  assert.equal(store.redo(), 'delete thread');
  assert.equal(store.state.threads.length, 0);
});

test('undo unwinds several steps in order', () => {
  const store = seededStore();
  store.mutate('a', (s) => s.threads.push(makeThread({ name: 'A' })));
  store.mutate('b', (s) => s.threads.push(makeThread({ name: 'B' })));
  assert.deepEqual(store.state.threads.map((t) => t.name), ['Compiler', 'A', 'B']);
  store.undo();
  assert.deepEqual(store.state.threads.map((t) => t.name), ['Compiler', 'A']);
  store.undo();
  assert.deepEqual(store.state.threads.map((t) => t.name), ['Compiler']);
  assert.equal(store.canUndo(), true, 'the original seed mutation is still on the stack');
});

test('a throwing mutation leaves state unchanged and does not consume undo', () => {
  const store = seededStore();
  const depth = store.undoStack.length;
  assert.throws(() =>
    store.mutate('bad', (state) => {
      state.threads.push(makeThread({ name: 'Half' }));
      throw new Error('boom');
    }),
  );
  assert.deepEqual(store.state.threads.map((t) => t.name), ['Compiler']);
  assert.equal(store.undoStack.length, depth);
});

test('a full quota is reported instead of losing the change', () => {
  const storage = new MemoryStorage({ limit: 400 });
  const store = new Store({ storage });
  store.load();
  const outcome = store.mutate('big', (state) => {
    state.threads.push(makeThread({ name: 'x'.repeat(2000) }));
  });
  assert.equal(outcome.saved.ok, false);
  assert.equal(outcome.saved.reason, 'quota');
  assert.ok(store.status.quota, 'the quota warning is raised for the UI to surface');
  assert.equal(store.state.threads.length, 1, 'the change is still in memory so it can be exported');
  assert.equal(store.dirty, true);
});

test('a second tab writing is detected instead of silently clobbered', () => {
  const storage = new MemoryStorage();
  const tabA = seededStore(storage);
  const tabB = new Store({ storage });
  tabB.load();

  // Tab B writes.
  tabB.mutate('from B', (state) => state.threads.push(makeThread({ name: 'From B' })));

  // Tab A now tries to write over it.
  const result = tabA.save();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'conflict');
  assert.ok(tabA.status.conflict);
  assert.equal(JSON.parse(storage.getItem(tabA.key)).threads.length, 2, "tab B's write is intact");
});

test('reloading from storage adopts the other tab’s state', () => {
  const storage = new MemoryStorage();
  const tabA = seededStore(storage);
  const tabB = new Store({ storage });
  tabB.load();
  tabB.mutate('from B', (state) => state.threads.push(makeThread({ name: 'From B' })));

  tabA.save();
  tabA.reloadFromStorage();
  assert.deepEqual(tabA.state.threads.map((t) => t.name), ['Compiler', 'From B']);
  assert.equal(tabA.status.conflict, null);
});

test('overwriting deliberately wins the conflict', () => {
  const storage = new MemoryStorage();
  const tabA = seededStore(storage);
  const tabB = new Store({ storage });
  tabB.load();
  tabB.mutate('from B', (state) => state.threads.push(makeThread({ name: 'From B' })));

  tabA.save();
  const result = tabA.overwriteStorage();
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(storage.getItem(tabA.key)).threads.map((t) => t.name), ['Compiler']);
});

test('unreadable stored data is preserved rather than overwritten on load', () => {
  const storage = new MemoryStorage();
  storage.setItem('cairn.state', '{ this is not json');
  const store = new Store({ storage });
  store.load();
  assert.equal(store.status.loadReport.ok, false);
  assert.equal(store.status.corruptRaw, '{ this is not json');
  assert.deepEqual(store.state.threads, [], 'the app still opens, on an empty state');
  assert.equal(storage.getItem('cairn.state'), '{ this is not json', 'the bad payload is left where it is');
});

test('an active question with no due date is scheduled rather than lost on load', () => {
  const storage = new MemoryStorage();
  const store = seededStore(storage);
  store.mutate('add question', (state) => {
    state.questions.push({
      id: 'q1', bank: 'sql', title: 'Q', url: '', tags: [], difficulty: 'medium',
      fields: {}, notes: '', attempts: [], intervalIndex: 0, dueDate: null, retired: false, retiredAt: null, createdAt: '2026-08-01',
    });
  });
  const reopened = new Store({ storage });
  reopened.load();
  assert.ok(reopened.state.questions[0].dueDate, 'it is due today rather than never');
});

test('subscribers are notified on change', () => {
  const store = seededStore();
  let events = 0;
  const off = store.subscribe(() => { events += 1; });
  store.mutate('x', (s) => s.threads.push(makeThread({ name: 'X' })));
  assert.equal(events, 1);
  off();
  store.mutate('y', (s) => s.threads.push(makeThread({ name: 'Y' })));
  assert.equal(events, 1);
});
