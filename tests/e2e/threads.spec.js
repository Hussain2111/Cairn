import { test, expect } from '@playwright/test';

// Flow 1 from the brief: create a thread, add stages and tasks, complete a
// stage and confirm the next one unlocks.

async function newThread(page, { name, stage, doneWhen }) {
  await page.goto('/#/threads');
  await page.getByRole('button', { name: 'New thread' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('First stage').fill(stage);
  await dialog.getByLabel('That stage is done when').fill(doneWhen);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

async function addStage(page, { title, doneWhen }) {
  await page.getByRole('button', { name: 'Add stage' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Stage title').fill(title);
  await dialog.getByLabel('Done when').fill(doneWhen);
  await dialog.getByRole('button', { name: 'Add stage' }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
}

async function addStep(page, stageIndex, title) {
  await page.locator('.stage').nth(stageIndex).getByRole('button', { name: '+ Step' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Step title').fill(title);
  await dialog.getByRole('button', { name: 'Add step' }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
}

async function addTask(page, stepTitle, title) {
  const step = page.locator('.step', { hasText: stepTitle }).first();
  const box = step.getByPlaceholder('Add a task…');
  await box.fill(title);
  await box.press('Enter');
  await expect(page.locator('.task', { hasText: title }).first()).toBeVisible();
}

test('completing a stage unlocks the next one', async ({ page }) => {
  await newThread(page, { name: 'Compiler', stage: 'Lexer', doneWhen: 'every token type has a passing test' });
  await addStage(page, { title: 'Parser', doneWhen: 'the grammar round-trips' });
  await addStage(page, { title: 'Codegen', doneWhen: 'hello world compiles' });

  const stages = page.locator('.stage');
  await expect(stages).toHaveCount(3);

  // Only the first stage starts unlocked. The rest are visible but greyed.
  await expect(stages.nth(0)).toHaveAttribute('data-state', 'available');
  await expect(stages.nth(1)).toHaveAttribute('data-state', 'locked');
  await expect(stages.nth(2)).toHaveAttribute('data-state', 'locked');
  await expect(stages.nth(1)).toBeVisible();

  await addStep(page, 0, 'Numbers');
  await addTask(page, 'Numbers', 'Integer literals');
  await addTask(page, 'Numbers', 'Float literals');
  await expect(stages.nth(0)).toHaveAttribute('data-state', 'available');

  // A locked stage cannot be ticked into.
  await addStep(page, 1, 'Grammar');
  await addTask(page, 'Grammar', 'Expression rules');
  const lockedTask = stages.nth(1).locator('.task').first();
  await expect(lockedTask.locator('.task__box')).toBeDisabled();

  // Tick everything in stage 1.
  const firstStageTasks = stages.nth(0).locator('.task__box');
  await firstStageTasks.nth(0).click();
  await expect(stages.nth(0)).toHaveAttribute('data-state', 'in-progress');
  await expect(stages.nth(1)).toHaveAttribute('data-state', 'locked');

  await firstStageTasks.nth(1).click();

  // The stage completes and exactly one more unlocks.
  await expect(stages.nth(0)).toHaveAttribute('data-state', 'complete');
  await expect(stages.nth(1)).toHaveAttribute('data-state', 'available');
  await expect(stages.nth(2)).toHaveAttribute('data-state', 'locked');
  await expect(page.getByText('"Parser" is now unlocked')).toBeVisible();

  // The formerly-locked task is now tickable.
  await expect(stages.nth(1).locator('.task__box').first()).toBeEnabled();
});

test('a stage cannot be started without a done-when', async ({ page }) => {
  await newThread(page, { name: 'Thesis', stage: 'Outline', doneWhen: 'chapters listed' });

  // Add a stage with no done-when by clearing it after creation.
  await addStage(page, { title: 'Draft', doneWhen: 'placeholder' });
  await page.locator('.stage').nth(1).getByRole('button', { name: 'Force unlock' }).click();
  await page.locator('.stage').nth(1).getByRole('button', { name: 'Edit stage' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByRole('textbox').nth(1).fill('   ');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.locator('.field__error')).toContainText('done-when');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('up next on Today shows one line per thread and ticking it advances', async ({ page }) => {
  await newThread(page, { name: 'Compiler', stage: 'Lexer', doneWhen: 'tokens tested' });
  await addStep(page, 0, 'Numbers');
  await addTask(page, 'Numbers', 'Integer literals');
  await addTask(page, 'Numbers', 'Float literals');

  await page.goto('/#/today');
  const row = page.locator('.upnext__row').first();
  await expect(row.locator('.upnext__task')).toHaveText('Integer literals');
  await expect(row.locator('.upnext__where')).toContainText('Lexer › Numbers');

  await row.locator('.upnext__tick').click();
  await expect(page.locator('.upnext__row').first().locator('.upnext__task')).toHaveText('Float literals');
});

test('a thread with no done-when says so on Today instead of showing nothing', async ({ page }) => {
  await page.goto('/#/threads');
  await page.getByRole('button', { name: 'New thread' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Name').fill('Vague plan');
  await dialog.getByLabel('First stage').fill('Do the thing');
  await dialog.getByRole('button', { name: 'Create' }).click();

  await page.goto('/#/today');
  await expect(page.locator('.upnext__row')).toContainText('needs a done-when');
});

test('reordering stages recomputes what is locked', async ({ page }) => {
  await newThread(page, { name: 'Ordering', stage: 'A', doneWhen: 'a done' });
  await addStage(page, { title: 'B', doneWhen: 'b done' });
  await addStep(page, 0, 'work');
  await addTask(page, 'work', 'a task');
  await page.locator('.stage').nth(0).locator('.task__box').first().click();

  const stages = page.locator('.stage');
  await expect(stages.nth(0)).toHaveAttribute('data-state', 'complete');
  await expect(stages.nth(1)).toHaveAttribute('data-state', 'available');

  // Move the completed stage to the end: B is now first and A stays complete.
  await stages.nth(0).getByRole('button', { name: 'Move A down' }).click();
  await expect(page.locator('.stage').nth(0)).toContainText('B');
  await expect(page.locator('.stage').nth(0)).toHaveAttribute('data-state', 'available');
  await expect(page.locator('.stage').nth(1)).toHaveAttribute('data-state', 'complete');
});

test('deleting a stage with completed work warns, and deletes it — there is no archive', async ({ page }) => {
  await newThread(page, { name: 'Delete me', stage: 'Stage one', doneWhen: 'done when done' });
  await addStep(page, 0, 'work');
  await addTask(page, 'work', 'finished task');
  await page.locator('.task__box').first().click();

  await page.locator('.stage').nth(0).locator('.stage__tools').getByRole('button', { name: 'Delete stage' }).click();
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('contains completed work');
  await expect(dialog).not.toContainText('Archive instead');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.locator('.stage')).toHaveCount(0);
  await page.goto('/#/settings');
  await expect(page.locator('#view')).not.toContainText('Archived');
});

test('a thread is active or done, and marking it done takes it off Today', async ({ page }) => {
  await newThread(page, { name: 'Finish me', stage: 'Stage one', doneWhen: 'x' });
  await addStep(page, 0, 'work');
  await addTask(page, 'work', 'a live task');

  await page.goto('/#/today');
  await expect(page.locator('.upnext')).toContainText('Finish me');

  await page.goto('/#/threads');
  await page.locator('.card', { hasText: 'Finish me' }).getByRole('link', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const dialog = page.locator('dialog');
  await expect(dialog).not.toContainText('Archived');
  await dialog.getByLabel('Status').selectOption('done');
  await dialog.getByRole('button', { name: 'Save' }).click();

  await page.goto('/#/today');
  await expect(page.locator('#view')).not.toContainText('Finish me');

  // Still there, under Done, with its history.
  await page.goto('/#/threads');
  await expect(page.locator('#view')).not.toContainText('Finish me');
  await page.getByRole('link', { name: /^Done/ }).click();
  await expect(page.locator('.card', { hasText: 'Finish me' })).toBeVisible();
});

test('deleting a thread deletes it, with no archive offered', async ({ page }) => {
  await newThread(page, { name: 'Gone for good', stage: 'Stage one', doneWhen: 'x' });
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.locator('dialog').getByRole('button', { name: 'Delete thread' }).click();
  const confirmDialog = page.locator('dialog');
  await expect(confirmDialog).not.toContainText('Archive instead');
  await expect(confirmDialog).toContainText('mark it done instead');
  await confirmDialog.getByRole('button', { name: 'Delete everything' }).click();

  await page.goto('/#/threads');
  await expect(page.locator('#view')).not.toContainText('Gone for good');
  await page.goto('/#/threads?filter=done');
  await expect(page.locator('#view')).not.toContainText('Gone for good');
});

test('force-completing a stage with open tasks warns and is recorded', async ({ page }) => {
  await newThread(page, { name: 'Force', stage: 'Stage one', doneWhen: 'good enough' });
  await addStage(page, { title: 'Stage two', doneWhen: 'later' });
  await addStep(page, 0, 'work');
  await addTask(page, 'work', 'unfinished task');

  await page.locator('.stage').nth(0).getByRole('button', { name: 'Mark complete' }).click();
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('1 task(s) that are not done');
  await dialog.getByRole('button', { name: 'Force-complete' }).click();

  await expect(page.locator('.stage').nth(0)).toHaveAttribute('data-state', 'complete');
  await expect(page.locator('.stage').nth(0)).toContainText('force-completed');
  await expect(page.locator('.stage').nth(1)).toHaveAttribute('data-state', 'available');
});

test('a destructive action can be undone', async ({ page }) => {
  await newThread(page, { name: 'Undo me', stage: 'Stage one', doneWhen: 'x' });
  await addStage(page, { title: 'Stage two', doneWhen: 'y' });
  await expect(page.locator('.stage')).toHaveCount(2);

  await page.locator('.stage').nth(1).locator('.stage__tools').getByRole('button', { name: 'Delete stage' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.stage')).toHaveCount(1);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.stage')).toHaveCount(2);
});

test('a task due inside a locked stage stays out of needs action', async ({ page }) => {
  await newThread(page, { name: 'Deadlines', stage: 'Open', doneWhen: 'open done' });
  await addStage(page, { title: 'Locked', doneWhen: 'locked done' });
  await addStep(page, 1, 'later work');
  await addTask(page, 'later work', 'due but locked');

  // Give it a due date of today.
  await page.locator('.task', { hasText: 'due but locked' }).locator('.task__title').click();
  const dialog = page.locator('dialog');
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await dialog.getByLabel('Due').fill(iso);
  await dialog.getByRole('button', { name: 'Save' }).click();

  await page.goto('/#/today');
  await expect(page.locator('.section', { hasText: 'Needs action' })).not.toContainText('due but locked');

  // Force-unlocking the stage brings it into view.
  await page.goto('/#/threads');
  await page.getByRole('link', { name: 'Open' }).first().click();
  await page.locator('.stage').nth(1).getByRole('button', { name: 'Force unlock' }).click();
  await page.goto('/#/today');
  await expect(page.locator('.section', { hasText: 'Needs action' })).toContainText('due but locked');
});

test('a completed task stops reading as overdue', async ({ page }) => {
  await page.goto('/#/threads');
  await page.getByRole('button', { name: 'New thread' }).click();
  let dialog = page.locator('dialog');
  await dialog.getByLabel('Name').fill('Compiler');
  await dialog.getByLabel('First stage').fill('Lexer');
  await dialog.getByLabel('That stage is done when').fill('tokens tested');
  await dialog.getByRole('button', { name: 'Create' }).click();

  await page.getByRole('button', { name: '+ Step' }).click();
  dialog = page.locator('dialog');
  await dialog.getByLabel('Step title').fill('Numbers');
  await dialog.getByRole('button', { name: 'Add' }).click();

  await page.getByPlaceholder('Add a task').fill('Integer literals');
  await page.getByPlaceholder('Add a task').press('Enter');

  // Give it a due date well in the past.
  await page.locator('.task__title').click();
  dialog = page.locator('dialog');
  await dialog.getByLabel('Due').fill('2020-01-01');
  await dialog.getByRole('button', { name: 'Save' }).click();

  const meta = page.locator('.task .task__meta');
  await expect(meta.locator('.tag--danger')).toHaveCount(1);
  await expect(meta).toContainText('overdue');

  // Ticking it makes the date history, not a deadline.
  await page.locator('.task__box').click();
  await expect(page.locator('.task')).toHaveClass(/task--done/);
  await expect(meta.locator('.tag--danger')).toHaveCount(0);
  await expect(meta).not.toContainText('overdue');
  await expect(meta).not.toContainText('1 Jan', 'the deadline is not information once it is met');
  await expect(meta).toContainText('Done');

  // And it comes back the moment the task is unticked.
  await page.locator('.task__box').click();
  await expect(meta.locator('.tag--danger')).toHaveCount(1);
});

test('the task editor says that Due and Estimate are optional', async ({ page }) => {
  await page.goto('/#/threads');
  await page.getByRole('button', { name: 'New thread' }).click();
  let dialog = page.locator('dialog');
  await dialog.getByLabel('Name').fill('Compiler');
  await dialog.getByLabel('First stage').fill('Lexer');
  await dialog.getByLabel('That stage is done when').fill('tokens tested');
  await dialog.getByRole('button', { name: 'Create' }).click();

  await page.getByRole('button', { name: '+ Step' }).click();
  dialog = page.locator('dialog');
  await dialog.getByLabel('Step title').fill('Numbers');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await page.getByPlaceholder('Add a task').fill('Integer literals');
  await page.getByPlaceholder('Add a task').press('Enter');

  await page.locator('.task__title').click();
  dialog = page.locator('dialog');
  await expect(dialog).toContainText('Only set one if the date is real');
  await expect(dialog).toContainText('Optional, in minutes');

  // And saving with both blank is fine.
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.task__meta .tag')).toHaveCount(0);
});

test('ticking a task below the fold does not throw the page back to the top', async ({ page }) => {
  await newThread(page, { name: 'Long thread', stage: 'Stage one', doneWhen: 'x' });
  await addStep(page, 0, 'work');

  // Enough tasks that the last one is well below the fold.
  const box = page.getByPlaceholder('Add a task');
  for (let i = 1; i <= 40; i += 1) {
    await box.fill(`task ${i}`);
    await box.press('Enter');
  }

  const last = page.locator('.task').nth(39);
  await last.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(200);

  await last.locator('.task__box').click();
  await expect(last).toHaveClass(/task--done/);

  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - before)).toBeLessThan(5);
  // The row is still where the eye was, not scrolled off the top.
  await expect(last).toBeInViewport();
});

test('navigating to another view still starts at the top', async ({ page }) => {
  await newThread(page, { name: 'Scrolled', stage: 'Stage one', doneWhen: 'x' });
  await addStep(page, 0, 'work');
  const box = page.getByPlaceholder('Add a task');
  for (let i = 1; i <= 40; i += 1) {
    await box.fill(`task ${i}`);
    await box.press('Enter');
  }
  await page.locator('.task').nth(39).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

  await page.goto('/#/questions');
  await expect(page.getByRole('heading', { name: 'Questions', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('moving a stage says which stages it locked', async ({ page }) => {
  // A finished first stage, so the second is workable and the third is not.
  await newThread(page, { name: 'Reorder', stage: 'Alpha', doneWhen: 'x' });
  await addStep(page, 0, 'work');
  await addTask(page, 'work', 'alpha task');
  await page.locator('.task__box').first().click();
  await addStage(page, { title: 'Beta', doneWhen: 'y' });
  await addStage(page, { title: 'Gamma', doneWhen: 'z' });

  const stages = page.locator('.stage');
  await expect(stages.nth(1)).toHaveAttribute('data-state', 'available');
  await expect(stages.nth(2)).toHaveAttribute('data-state', 'locked');

  // Pull Gamma above Beta: Gamma becomes workable, Beta stops being.
  await stages.nth(2).getByRole('button', { name: 'Move Gamma up' }).click();

  const said = page.locator('.toast', { hasText: 'That move' });
  await expect(said).toContainText('locked "Beta"');
  await expect(said).toContainText('unlocked "Gamma"');
  await expect(page.locator('.stage').nth(1)).toHaveAttribute('data-state', 'available');
  await expect(page.locator('.stage').nth(2)).toHaveAttribute('data-state', 'locked');
});

test('reordering two finished stages says nothing, because nothing changed', async ({ page }) => {
  // Both complete, so swapping them cannot lock or unlock anything.
  await newThread(page, { name: 'Quiet move', stage: 'Alpha', doneWhen: 'x' });
  await addStage(page, { title: 'Beta', doneWhen: 'y' });
  await addStage(page, { title: 'Gamma', doneWhen: 'z' });
  for (const index of [0, 1]) {
    await page.locator('.stage').nth(index).getByRole('button', { name: 'Mark complete' }).click();
  }
  await expect(page.locator('.stage').nth(2)).toHaveAttribute('data-state', 'available');

  await page.locator('.stage').nth(1).getByRole('button', { name: 'Move Beta up' }).click();
  await expect(page.locator('.stage').nth(0)).toContainText('Beta');
  await expect(page.locator('.toast', { hasText: 'That move' })).toHaveCount(0);
  await expect(page.locator('.stage').nth(2)).toHaveAttribute('data-state', 'available');
});
