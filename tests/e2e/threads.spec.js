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
  await stages.nth(0).getByRole('button', { name: '↓' }).click();
  await expect(page.locator('.stage').nth(0)).toContainText('B');
  await expect(page.locator('.stage').nth(0)).toHaveAttribute('data-state', 'available');
  await expect(page.locator('.stage').nth(1)).toHaveAttribute('data-state', 'complete');
});

test('deleting a stage with completed work offers to archive instead', async ({ page }) => {
  await newThread(page, { name: 'Archive me', stage: 'Stage one', doneWhen: 'done when done' });
  await addStep(page, 0, 'work');
  await addTask(page, 'work', 'finished task');
  await page.locator('.task__box').first().click();

  await page.locator('.stage').nth(0).locator('.stage__tools').getByRole('button', { name: 'Delete stage' }).click();
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('contains completed work');
  await dialog.getByRole('button', { name: 'Archive instead' }).click();

  await expect(page.locator('.stage')).toHaveCount(0);
  await page.goto('/#/settings');
  await expect(page.getByText('Archived stages')).toBeVisible();
  await expect(page.getByText('Stage one')).toBeVisible();
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
  await expect(meta).toContainText('due 1 Jan');

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
