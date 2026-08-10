import { test, expect } from '@playwright/test';

// The remaining surfaces: notes and templates, pipelines, time blocking, the
// weekly review, habits, search, stall detection and the narrow-screen layout.

function iso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('a note can be created from a template and renders as markdown', async ({ page }) => {
  await page.goto('/#/notes');
  await page.getByRole('button', { name: 'New note' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Title').fill('Day one');
  await dialog.getByLabel('Template').selectOption({ label: 'Daily project log' });
  await dialog.getByRole('button', { name: 'Create' }).click();

  const body = page.locator('.textarea--tall');
  await expect(body).toHaveValue(/## What I did/);
  await expect(body).toHaveValue(new RegExp(`Daily log — ${iso()}`));

  await body.fill('# Heading\n\n- one\n- two\n\n**bold** and `code`');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('.markdown h1')).toHaveText('Heading');
  await expect(page.locator('.markdown li')).toHaveCount(2);
  await expect(page.locator('.markdown strong')).toHaveText('bold');
});

test('note bodies cannot inject markup', async ({ page }) => {
  await page.goto('/#/notes');
  await page.getByRole('button', { name: 'New note' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Title').fill('Escaping');
  await dialog.getByRole('button', { name: 'Create' }).click();

  await page.locator('.textarea--tall').fill('<img src=x onerror="window.__pwned=true">');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('.markdown')).toContainText('<img src=x');
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

test('a note can be attached to a thread and filtered to it', async ({ page }) => {
  await page.goto('/#/threads');
  await page.getByRole('button', { name: 'New thread' }).click();
  let dialog = page.locator('dialog');
  await dialog.getByLabel('Name').fill('Compiler');
  await dialog.getByRole('button', { name: 'Create' }).click();

  // The thread page's own Notes button, pre-filtered to this thread.
  await page.locator('#view').getByRole('link', { name: 'Notes' }).click();
  await page.getByRole('button', { name: 'New note' }).click();
  dialog = page.locator('dialog');
  await dialog.getByLabel('Title').fill('Attached note');
  await dialog.getByRole('button', { name: 'Create' }).click();

  await expect(page.locator('.note-item__meta').first()).toContainText('Compiler');
});

test('an application that has gone quiet shows up in needs action', async ({ page }) => {
  await page.goto('/#/pipelines');
  await page.getByRole('button', { name: 'Log application' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Company').fill('Acme');
  await dialog.getByLabel('Role').fill('Backend engineer');
  await dialog.getByLabel('Resume version sent').fill('backend-v3');
  await dialog.getByLabel('Next action date').fill(iso(-3));
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await expect(page.locator('.section', { hasText: 'Needs action' })).toContainText('3d overdue');
  await expect(page.locator('.board__card--overdue')).toContainText('Acme');

  await page.goto('/#/today');
  await expect(page.locator('.section', { hasText: 'Needs action' })).toContainText('Backend engineer — Acme');
});

test('a rejected application drops out of needs action', async ({ page }) => {
  await page.goto('/#/pipelines');
  await page.getByRole('button', { name: 'Log application' }).click();
  let dialog = page.locator('dialog');
  await dialog.getByLabel('Company').fill('Nope Inc');
  await dialog.getByLabel('Role').fill('Engineer');
  await dialog.getByLabel('Next action date').fill(iso(-5));
  await dialog.getByRole('button', { name: 'Log it' }).click();
  await expect(page.locator('.section', { hasText: 'Needs action' })).toContainText('Nope Inc');

  await page.locator('.board__card', { hasText: 'Nope Inc' }).click();
  dialog = page.locator('dialog');
  await dialog.getByLabel('Status').selectOption('rejected');
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Nothing needs action right now.')).toBeVisible();
});

test('planned and logged are separate blocks, and the week compares them', async ({ page }) => {
  await page.goto('/#/time');
  await page.getByRole('button', { name: 'Plan a block' }).click();
  let dialog = page.locator('dialog');
  await dialog.getByLabel('Start', { exact: true }).fill('09:00');
  await dialog.getByLabel('End', { exact: true }).fill('12:00');
  await dialog.getByLabel('Label').fill('Deep work');
  await dialog.getByRole('button', { name: 'Add' }).click();

  await expect(page.locator('.block')).toContainText('Deep work');
  await expect(page.locator('.row').first()).toContainText('3h planned');

  // What actually happened is a second block, not an edit of the first.
  await page.getByRole('button', { name: 'Log a block' }).click();
  dialog = page.locator('dialog');
  await dialog.getByLabel('Start', { exact: true }).fill('09:30');
  await dialog.getByLabel('End', { exact: true }).fill('11:00');
  await dialog.getByLabel('Label').fill('Deep work');
  await dialog.getByRole('button', { name: 'Add' }).click();

  await expect(page.locator('.block')).toHaveCount(2);
  await expect(page.locator('.block--logged')).toBeVisible();
  await expect(page.locator('.dist')).toContainText('1h 30m / 3h');
});

test('a plan can be logged as done in one click', async ({ page }) => {
  await page.goto('/#/time');
  await page.getByRole('button', { name: 'Plan a block' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Start', { exact: true }).fill('14:00');
  await dialog.getByLabel('End', { exact: true }).fill('15:00');
  await dialog.getByLabel('Label').fill('Reading');
  await dialog.getByRole('button', { name: 'Add' }).click();

  await page.getByRole('button', { name: 'Log the 14:00 block as done' }).click();
  await expect(page.locator('.block--logged')).toBeVisible();
  await expect(page.locator('.row').first()).toContainText('1h logged');
  // Nothing left unlogged, so the offer disappears.
  await expect(page.getByRole('button', { name: /Log the .* block as done/ })).toHaveCount(0);
});

test('a block can be assigned to the gym or the GRE, not only to a thread', async ({ page }) => {
  await page.goto('/#/time');
  await page.getByRole('button', { name: 'Log a block' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Start', { exact: true }).fill('18:00');
  await dialog.getByLabel('End', { exact: true }).fill('19:30');
  await dialog.getByLabel('Activity').selectOption({ label: 'Gym' });
  await dialog.getByRole('button', { name: 'Add' }).click();

  await expect(page.locator('.block')).toContainText('Gym');
  await expect(page.locator('.dist')).toContainText('Gym');
  await expect(page.locator('.dist')).toContainText('1h 30m / 0m');
});

test('the block form does not ask for a date — the day view already knows it', async ({ page }) => {
  await page.goto('/#/time');
  await page.getByRole('button', { name: 'Plan a block' }).click();
  const dialog = page.locator('dialog');
  await expect(dialog.getByLabel('Date')).toHaveCount(0);
  await expect(dialog.getByLabel('Actually started')).toHaveCount(0);
  await expect(dialog.getByLabel('Actually ended')).toHaveCount(0);
  await expect(dialog.getByLabel('Status')).toBeVisible();
});

test('overlapping blocks of the same kind are flagged before they are saved', async ({ page }) => {
  await page.goto('/#/time');
  await page.getByRole('button', { name: 'Plan a block' }).click();
  let dialog = page.locator('dialog');
  await dialog.getByLabel('Start', { exact: true }).fill('09:00');
  await dialog.getByLabel('End', { exact: true }).fill('10:00');
  await dialog.getByRole('button', { name: 'Add' }).click();

  await page.getByRole('button', { name: 'Plan a block' }).click();
  dialog = page.locator('dialog');
  await dialog.getByLabel('Start', { exact: true }).fill('09:30');
  await dialog.getByLabel('End', { exact: true }).fill('10:30');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('dialog')).toContainText('overlaps another block');
});

test('a block that ends before it starts is refused', async ({ page }) => {
  await page.goto('/#/time');
  await page.getByRole('button', { name: 'Plan a block' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Start', { exact: true }).fill('14:00');
  await dialog.getByLabel('End', { exact: true }).fill('13:00');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('A block has to end after it starts.')).toBeVisible();
});

test('habits log against a weekly target and build a history', async ({ page }) => {
  await page.goto('/#/habits');
  await page.getByRole('button', { name: 'New habit' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Name').fill('Gym');
  await dialog.getByLabel('Times per week').fill('2');
  await dialog.getByRole('button', { name: 'Add' }).click();

  await expect(page.locator('.card')).toContainText('0/2 this week');

  // Log today from the week strip.
  await page.locator('.week-day--today').click();
  await expect(page.locator('.card').first()).toContainText('1/2 this week');

  await page.goto('/#/today');
  await expect(page.locator('.section', { hasText: 'Habits' })).toContainText('1/2 this week');
});

test('a stalled thread is surfaced on Today and in its own filter', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.cairn.store.mutate('seed stalled', (state) => {
      state.threads.push({
        id: 'thr_stalled', name: 'Abandoned project', type: 'project', archived: false, notes: '', links: [],
        description: '', createdAt: '2026-01-01T09:00:00',
        stages: [{
          id: 's1', title: 'Stage', doneWhen: 'x', forceUnlocked: false, forceCompleted: false, forceCompletedAt: null,
          notes: '', links: [], createdAt: '2026-01-01T09:00:00',
          steps: [{ id: 'p1', title: 'Step', notes: '', links: [], createdAt: '2026-01-01T09:00:00', tasks: [
            { id: 'k1', title: 'Never done', done: false, doneAt: null, due: null, estimateMinutes: null, notes: '', links: [], createdAt: '2026-01-01T09:00:00' },
          ] }],
        }],
      });
    });
    window.cairn.render();
  });

  await page.goto('/#/today');
  await expect(page.getByText('has not moved')).toBeVisible();
  await expect(page.locator('.banner')).toContainText('Abandoned project');

  await page.getByRole('link', { name: 'Look at them' }).click();
  const card = page.locator('.card', { hasText: 'Abandoned project' });
  await expect(card).toBeVisible();
  await expect(card.locator('.tag--danger')).toContainText('stalled');
});

test('search finds tasks, questions and what was hesitated on', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.cairn.store.mutate('seed search', (state) => {
      state.threads.push({
        id: 't1', name: 'Compiler', type: 'project', archived: false, notes: '', links: [], description: '',
        createdAt: '2026-06-01T09:00:00',
        stages: [{ id: 's1', title: 'Lexer', doneWhen: 'x', forceUnlocked: false, forceCompleted: false, forceCompletedAt: null, notes: '', links: [], createdAt: '2026-06-01T09:00:00',
          steps: [{ id: 'p1', title: 'Numbers', notes: '', links: [], createdAt: '2026-06-01T09:00:00', tasks: [
            { id: 'k1', title: 'Integer literals', done: false, doneAt: null, due: null, estimateMinutes: null, notes: '', links: [], createdAt: '2026-06-01T09:00:00' },
          ] }] }],
      });
      state.questions.push({
        id: 'q1', bank: 'sql', title: 'Window functions', url: '', tags: [], difficulty: 'hard', fields: {}, notes: '',
        intervalIndex: 0, dueDate: '2026-08-07', retired: false, retiredAt: null, createdAt: '2026-08-01',
        attempts: [{ id: 'a1', date: '2026-08-01', unaided: false, minutes: 20, hesitation: 'partition versus order by' }],
      });
    });
  });

  await page.goto('/#/search?q=integer');
  await expect(page.locator('.result').first()).toContainText('Integer literals');

  await page.goto('/#/search?q=partition');
  await expect(page.locator('.result')).toHaveCount(1);
  await expect(page.locator('.result')).toContainText('Window functions');

  // Clicking a result jumps to it.
  await page.locator('.result').first().click();
  await expect(page).toHaveURL(/#\/questions\/sql/);
});

test('the weekly review is generated and exports as markdown', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const today = new Date();
    const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}T10:00:00`;
    window.cairn.store.mutate('seed review', (state) => {
      state.threads.push({
        id: 't1', name: 'Compiler', type: 'project', archived: false, notes: '', links: [], description: '',
        createdAt: '2026-06-01T09:00:00',
        stages: [{ id: 's1', title: 'Lexer', doneWhen: 'x', forceUnlocked: false, forceCompleted: false, forceCompletedAt: null, notes: '', links: [], createdAt: '2026-06-01T09:00:00',
          steps: [{ id: 'p1', title: 'Numbers', notes: '', links: [], createdAt: '2026-06-01T09:00:00', tasks: [
            { id: 'k1', title: 'Integer literals', done: true, doneAt: stamp, due: null, estimateMinutes: null, notes: '', links: [], createdAt: '2026-06-01T09:00:00' },
          ] }] }],
      });
    });
  });

  await page.goto('/#/weekly');
  await expect(page.locator('.stat__value').first()).toHaveText('1');
  await expect(page.locator('.section', { hasText: 'What moved' })).toContainText('Integer literals');
  await expect(page.locator('pre.markdown')).toContainText('# Weekly review');
  await expect(page.locator('pre.markdown')).toContainText('Integer literals');
  await expect(page.locator('pre.markdown')).not.toContainText('undefined');
});

test('on a narrow screen the tree collapses to an outline and the menu is reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/#/threads');
  await page.getByRole('button', { name: 'New thread' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Name').fill('Phone thread');
  await dialog.getByLabel('First stage').fill('Stage one');
  await dialog.getByLabel('That stage is done when').fill('done');
  await dialog.getByRole('button', { name: 'Create' }).click();

  // Connectors are dropped; the stage is still there as an outline row.
  const stage = page.locator('.stage').first();
  await expect(stage).toBeVisible();
  expect(await stage.evaluate((node) => getComputedStyle(node, '::before').display)).toBe('none');

  // The sidebar is off-canvas until the menu button opens it.
  await expect(page.locator('#sidebar')).not.toBeInViewport();
  await page.getByRole('button', { name: '☰ Menu' }).click();
  await expect(page.locator('#sidebar')).toBeInViewport();
});

test('keyboard shortcuts move between the main views', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('r');
  await expect(page).toHaveURL(/#\/threads/);
  await page.keyboard.press('q');
  await expect(page).toHaveURL(/#\/questions/);
  await page.keyboard.press('t');
  await expect(page).toHaveURL(/#\/today/);
  await page.keyboard.press('/');
  await expect(page).toHaveURL(/#\/search/);
  await expect(page.locator('input[type="search"]')).toBeFocused();
});
