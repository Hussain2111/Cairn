import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Flow 3 from the brief: export then import and confirm state round-trips
// exactly. Plus the import validator's behaviour on bad input, and the
// quota / multi-tab edge cases.

/** Seed state directly through the store, which is what the app itself uses. */
async function seed(page) {
  await page.goto('/');
  await page.evaluate(() => {
    const { store } = window.cairn;
    store.mutate('seed', (state) => {
      state.threads.push({
        id: 'thr_seed',
        name: 'Compiler',
        type: 'project',
        description: 'A toy language',
        status: 'active',
        notes: 'notes here',
        links: [{ id: 'lnk1', url: 'https://example.com/spec', label: 'Spec' }],
        createdAt: '2026-06-01T09:00:00',
        stages: [
          {
            id: 'stage_seed',
            title: 'Lexer',
            doneWhen: 'every token type has a passing test',
            forceUnlocked: false,
            forceCompleted: false,
            forceCompletedAt: null,
            notes: '',
            links: [],
            createdAt: '2026-06-01T09:00:00',
            steps: [
              {
                id: 'step_seed',
                title: 'Numbers',
                notes: '',
                links: [],
                createdAt: '2026-06-01T09:00:00',
                tasks: [
                  { id: 'task_a', title: 'Integer literals', done: true, doneAt: '2026-06-02T10:00:00', due: null, estimateMinutes: 45, notes: '', links: [], createdAt: '2026-06-01T09:00:00' },
                  { id: 'task_b', title: 'Float literals', done: false, doneAt: null, due: '2026-12-01', estimateMinutes: null, notes: 'tricky', links: [], createdAt: '2026-06-01T09:00:00' },
                ],
              },
            ],
          },
        ],
      });
      state.questions.push({
        id: 'q_seed', bank: 'sql', title: 'Window functions', url: 'https://example.com/q', tags: ['sql', 'windows'],
        difficulty: 'hard', fields: { feature: 'window functions' }, notes: '', intervalIndex: 2,
        dueDate: '2026-09-01', retired: false, retiredAt: null, createdAt: '2026-06-01',
        attempts: [{ id: 'att1', date: '2026-08-01', unaided: true, minutes: 14, hesitation: 'frame clause' }],
      });
      state.exercises.push({
        id: 'ex_seed', name: 'Bench press', muscle: 'chest', secondary: ['arms'],
        status: 'active', createdAt: '2026-06-01',
      });
      state.gymSessions.push({
        id: 'gym_seed', date: '2026-08-05', startTime: '18:00', endTime: '19:00',
        notes: 'ten minutes on the bike first', createdAt: '2026-08-05T19:00:00',
        exercises: [{
          id: 'sx1', exerciseId: 'ex_seed', note: 'no tension in the target muscle',
          sets: [{ id: 'set1', reps: 10, weight: 60 }],
        }],
      });
      state.painRecords.push({
        id: 'pain_seed', date: '2026-08-05', location: 'right shoulder', exerciseId: 'ex_seed',
        when: 'during', note: 'third set only', sessionId: 'gym_seed', createdAt: '2026-08-05T19:00:00',
      });
      state.applications.push({
        id: 'app_seed', company: 'Acme', role: 'Backend engineer', source: 'LinkedIn', url: '', dateApplied: '2026-08-04',
        resumeVersion: 'backend-v3', referral: '', status: 'applied', nextAction: 'follow up', nextActionDate: '2026-08-20',
        notes: '', lastMovedAt: '2026-08-04', createdAt: '2026-08-04',
      });
    });
  });
}

test('export then import round-trips state exactly', async ({ page }) => {
  await seed(page);

  const exported = await page.evaluate(() => window.cairn.store.exportJSON());
  const before = await page.evaluate(() => JSON.stringify(window.cairn.store.state.threads));

  // Wipe, confirm it is gone, then import the file back.
  await page.evaluate(() => {
    window.cairn.store.mutate('wipe', (state) => {
      state.threads.length = 0;
      state.questions.length = 0;
      state.exercises.length = 0;
      state.gymSessions.length = 0;
      state.painRecords.length = 0;
      state.applications.length = 0;
    });
    window.cairn.render();
  });
  await page.goto('/#/threads');
  await expect(page.getByText('No threads yet')).toBeVisible();

  const result = await page.evaluate((json) => {
    const report = window.cairn.store.importJSON(json);
    window.cairn.render();
    return {
      ok: report.ok,
      errors: report.errors,
      threads: JSON.stringify(window.cairn.store.state.threads),
      questions: JSON.stringify(window.cairn.store.state.questions),
      gym: JSON.stringify(window.cairn.store.state.gymSessions),
      pain: JSON.stringify(window.cairn.store.state.painRecords),
      applications: JSON.stringify(window.cairn.store.state.applications),
    };
  }, exported);

  expect(result.ok).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.threads).toBe(before);

  // Everything survives, including the scheduler position and the hesitation.
  const questions = JSON.parse(result.questions);
  expect(questions[0].intervalIndex).toBe(2);
  expect(questions[0].dueDate).toBe('2026-09-01');
  expect(questions[0].attempts[0].hesitation).toBe('frame clause');
  // The gym survives with the part that is hard to reconstruct: the note.
  const gym = JSON.parse(result.gym);
  expect(gym[0].exercises[0].sets).toEqual([{ id: 'set1', reps: 10, weight: 60 }]);
  expect(gym[0].exercises[0].note).toBe('no tension in the target muscle');
  expect(JSON.parse(result.pain)[0].location).toBe('right shoulder');
  expect(JSON.parse(result.applications)[0].resumeVersion).toBe('backend-v3');

  // And the UI reflects it.
  await page.goto('/#/thread/thr_seed');
  await expect(page.getByRole('heading', { name: 'Compiler', level: 1 })).toBeVisible();
  await expect(page.locator('.task', { hasText: 'Float literals' })).toBeVisible();
});

test('the export survives a full page reload through localStorage', async ({ page }) => {
  await seed(page);
  await page.reload();
  await page.goto('/#/thread/thr_seed');
  await expect(page.locator('.task', { hasText: 'Integer literals' })).toHaveClass(/task--done/);
});

test('a malformed file is refused with an explanation and changes nothing', async ({ page }) => {
  await seed(page);
  const outcome = await page.evaluate(() => {
    const report = window.cairn.store.importJSON('{ "threads": [ ');
    return { ok: report.ok, errors: report.errors, threadCount: window.cairn.store.state.threads.length };
  });
  expect(outcome.ok).toBe(false);
  expect(JSON.stringify(outcome.errors)).toContain('not valid JSON');
  expect(outcome.threadCount).toBe(1);
});

test('an older-schema file migrates on import and reports what changed', async ({ page }) => {
  await page.goto('/');
  const v1 = JSON.stringify({
    schemaVersion: 1,
    threads: [{ id: 't1', name: 'Old thread', type: 'project', stages: [{ id: 's1', title: 'Old stage', doneWhen: 'x', done: true, steps: [] }] }],
    banks: {
      sql: [{ id: 'q1', title: 'Joins', url: '', tags: [], difficulty: 'easy', attempts: [], intervalIndex: 0, dueDate: '2026-08-07' }],
      leetcode: [],
      gre: [],
    },
  });

  const report = await page.evaluate((json) => {
    const result = window.cairn.store.importJSON(json);
    window.cairn.render();
    return {
      ok: result.ok,
      notes: result.notes,
      questions: window.cairn.store.state.questions.map((q) => [q.id, q.bank]),
      stageForced: window.cairn.store.state.threads[0].stages[0].forceCompleted,
      version: window.cairn.store.state.schemaVersion,
      collections: ['exercises', 'warmups', 'gymSessions', 'painRecords', 'reading'].filter(
        (key) => Array.isArray(window.cairn.store.state[key]),
      ),
      habitsGone: window.cairn.store.state.habits === undefined,
      notesGone: window.cairn.store.state.notes === undefined,
    };
  }, v1);

  expect(report.ok).toBe(true);
  // A v1 file runs the whole chain, not just the first step.
  expect(report.version).toBe(9);
  expect(report.questions).toEqual([['q1', 'sql']]);
  expect(report.stageForced).toBe(true);
  expect(report.notes.join(' ')).toContain('migrated from schema v1');
  expect(report.collections).toEqual(['exercises', 'warmups', 'gymSessions', 'painRecords', 'reading']);
  expect(report.notesGone).toBe(true);
  expect(report.habitsGone).toBe(true);
});

test('a repairable file loads with every repair reported and nothing dropped', async ({ page }) => {
  await page.goto('/');
  const messy = JSON.stringify({
    schemaVersion: 2,
    threads: [{
      id: 't1', name: 'Messy', type: 'not-a-type', stages: [{
        id: 's1', title: 'Stage', doneWhen: 'x', steps: [{
          id: 'p1', title: 'Step', tasks: [
            { id: 'k1', title: 'Bad due date', due: '2026-02-30' },
            { id: 'k2', title: 12345, estimateMinutes: 'a while' },
          ],
        }],
      }],
    }],
    painRecords: [{ id: 'p1', date: '2026-08-05', location: '   ', exerciseId: 'nope', when: 'sideways' }],
  });

  const report = await page.evaluate((json) => {
    const result = window.cairn.store.importJSON(json);
    window.cairn.render();
    const state = window.cairn.store.state;
    return {
      ok: result.ok,
      warnings: result.warnings.map((w) => w.message),
      taskCount: state.threads[0].stages[0].steps[0].tasks.length,
      type: state.threads[0].type,
      title: state.threads[0].stages[0].steps[0].tasks[1].title,
      painLocation: state.painRecords[0].location,
    };
  }, messy);

  expect(report.ok).toBe(true);
  expect(report.taskCount).toBe(2, 'both tasks survive their bad fields');
  expect(report.type).toBe('project');
  expect(report.title).toBe('12345');
  expect(report.painLocation).toBe('unspecified', 'a pain record with no location is filed, not dropped');
  expect(report.warnings.join(' | ')).toContain('not a valid YYYY-MM-DD date');
});

test('a full storage quota warns instead of losing the change', async ({ page }) => {
  await seed(page);
  const outcome = await page.evaluate(() => {
    const { store } = window.cairn;
    // Simulate the browser refusing the write.
    const original = store.storage.setItem.bind(store.storage);
    store.storage.setItem = () => {
      const error = new Error('quota');
      error.name = 'QuotaExceededError';
      throw error;
    };
    const result = store.mutate('big change', (state) => {
      state.threads.push({ id: 'huge', name: 'Too big', type: 'project', stages: [], links: [], notes: '', status: 'active' });
    });
    window.cairn.render();
    store.storage.setItem = original;
    return { saved: result.saved.reason, quota: !!store.status.quota, inMemory: store.state.threads.length };
  });

  expect(outcome.saved).toBe('quota');
  expect(outcome.quota).toBe(true);
  expect(outcome.inMemory).toBe(2, 'the change is still on screen so it can be exported');
  await expect(page.getByText('Storage is full')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export now' })).toBeVisible();
});

test('a second tab writing is detected rather than silently clobbered', async ({ page }) => {
  await seed(page);
  const outcome = await page.evaluate(() => {
    const { store } = window.cairn;
    // Another tab writes a newer sequence number under the same key.
    const theirs = JSON.parse(store.storage.getItem(store.key));
    theirs.meta.writeSeq = (theirs.meta.writeSeq ?? 0) + 5;
    theirs.meta.writerId = 'some-other-tab';
    theirs.threads.push({ id: 'from_b', name: 'From the other tab', type: 'project', stages: [], links: [], notes: '', status: 'active' });
    store.storage.setItem(store.key, JSON.stringify(theirs));

    const result = store.save();
    window.cairn.render();
    return { reason: result.reason, stored: JSON.parse(store.storage.getItem(store.key)).threads.length };
  });

  expect(outcome.reason).toBe('conflict');
  expect(outcome.stored).toBe(2, "the other tab's write is intact");
  await expect(page.getByText('Another tab has changed this data')).toBeVisible();

  await page.getByRole('button', { name: 'Load theirs' }).click();
  await page.goto('/#/threads');
  await expect(page.getByText('From the other tab')).toBeVisible();
});

test('unreadable stored data opens empty without overwriting it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('cairn.state', '{ not json at all'));
  await page.reload();

  await expect(page.getByText('Saved data could not be read')).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem('cairn.state'));
  expect(stored).toBe('{ not json at all');
});
