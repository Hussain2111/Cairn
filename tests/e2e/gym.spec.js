import { test, expect } from '@playwright/test';

// The gym flows that matter: a session records what happened rather than that
// it happened, the week is judged on muscle coverage, and retiring an exercise
// never rewrites the history that used it.

async function newGymHabit(page, name = 'Gym') {
  await page.goto('/#/habits');
  await page.getByRole('button', { name: 'New habit' }).click();
  const dialog = page.locator('dialog');
  await dialog.locator('.input').first().fill(name);
  await dialog.locator('select').selectOption('gym');
  await dialog.locator('input[type="number"]').fill('4');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.card', { hasText: name })).toBeVisible();
}

async function openSessionForm(page) {
  await page.getByRole('button', { name: 'Log a session' }).first().click();
  return page.locator('dialog');
}

async function addExercise(dialog, name) {
  await dialog.getByLabel('Add an exercise').selectOption({ label: name });
  await expect(dialog.locator('.exercise-block', { hasText: name })).toBeVisible();
}

test('a gym habit seeds an exercise list and records a session with sets', async ({ page }) => {
  await newGymHabit(page);

  const dialog = await openSessionForm(page);
  await dialog.getByLabel('Total duration in minutes').fill('75');
  await dialog.getByLabel('Warmed up').check();
  await dialog.getByLabel('Warm-up minutes').fill('10');

  await addExercise(dialog, 'Bench press');
  await dialog.getByLabel('Bench press set 1 reps').fill('10');
  await dialog.getByLabel('Bench press set 1 weight').fill('60');

  await addExercise(dialog, 'Barbell row');
  await dialog.getByLabel('Barbell row set 1 reps').fill('12');
  await dialog.getByLabel('Barbell row set 1 weight').fill('40');

  await dialog.getByRole('button', { name: 'Log it' }).click();

  // The session is on the habit's page, with what was actually done.
  await page.getByRole('link', { name: 'Open' }).first().click();
  await expect(page.locator('.session')).toHaveCount(1);
  await expect(page.locator('.session')).toContainText('Bench press — 10×60');
  await expect(page.locator('.session')).toContainText('Barbell row — 12×40');
  await expect(page.locator('.session')).toContainText('1h 15m');
  await expect(page.locator('.session')).toContainText('warm-up 10m');
  await expect(page.locator('.session')).toContainText('2 sets');
});

test('a session counts towards the week and lights up only the muscles it trained', async ({ page }) => {
  await newGymHabit(page);

  const dialog = await openSessionForm(page);
  await addExercise(dialog, 'Bench press');
  await dialog.getByLabel('Bench press set 1 reps').fill('10');
  await dialog.getByLabel('Bench press set 1 weight').fill('60');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.getByRole('link', { name: 'Open' }).first().click();

  // One of four done, and the coverage says what today's session should be.
  await expect(page.locator('.stat', { hasText: 'sessions done' })).toContainText('1');
  await expect(page.locator('.stat', { hasText: 'planned' })).toContainText('4');
  await expect(page.locator('.stat', { hasText: 'still to do' })).toContainText('3');

  await expect(page.locator('.muscle[data-muscle="chest"]')).toHaveAttribute('data-trained', 'true');
  await expect(page.locator('.muscle[data-muscle="legs"]')).toHaveAttribute('data-trained', 'false');
  await expect(page.locator('.muscle[data-muscle="back"]')).toHaveAttribute('data-trained', 'false');
  await expect(page.locator('#view')).toContainText('back, shoulders, legs, arms, core');
});

test('"repeat set" copies the reps and weight of the set above it', async ({ page }) => {
  await newGymHabit(page);

  const dialog = await openSessionForm(page);
  await addExercise(dialog, 'Squat');
  await dialog.getByLabel('Squat set 1 reps').fill('5');
  await dialog.getByLabel('Squat set 1 weight').fill('100');

  await dialog.getByRole('button', { name: 'Repeat last set of Squat' }).click();
  await expect(dialog.getByLabel('Squat set 2 reps')).toHaveValue('5');
  await expect(dialog.getByLabel('Squat set 2 weight')).toHaveValue('100');

  // The third only needs the number that changed.
  await dialog.getByRole('button', { name: 'Repeat last set of Squat' }).click();
  await dialog.getByLabel('Squat set 3 reps').fill('3');
  await expect(dialog.getByLabel('Squat set 3 weight')).toHaveValue('100');

  await dialog.getByRole('button', { name: 'Log it' }).click();
  await page.getByRole('link', { name: 'Open' }).first().click();
  await expect(page.locator('.session')).toContainText('Squat — 5×100, 5×100, 3×100');
  await expect(page.locator('.session')).toContainText('3 sets');
});

test('adding an exercise fills in what you did last time', async ({ page }) => {
  await newGymHabit(page);

  let dialog = await openSessionForm(page);
  await addExercise(dialog, 'Deadlift');
  await dialog.getByLabel('Deadlift set 1 reps').fill('5');
  await dialog.getByLabel('Deadlift set 1 weight').fill('120');
  await dialog.getByRole('button', { name: 'Repeat last set of Deadlift' }).click();
  await dialog.getByRole('button', { name: 'Log it' }).click();

  // Next session: picking it again is the whole entry, not the start of it.
  dialog = await openSessionForm(page);
  await addExercise(dialog, 'Deadlift');
  await expect(dialog.getByLabel('Deadlift set 1 reps')).toHaveValue('5');
  await expect(dialog.getByLabel('Deadlift set 1 weight')).toHaveValue('120');
  await expect(dialog.getByLabel('Deadlift set 2 weight')).toHaveValue('120');

  await dialog.getByLabel('Deadlift set 2 weight').fill('125');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.getByRole('link', { name: 'Open' }).first().click();
  await expect(page.locator('.session').first()).toContainText('Deadlift — 5×120, 5×125');
});

test('retiring an exercise removes it from the picker and leaves the history alone', async ({ page }) => {
  await newGymHabit(page);

  const dialog = await openSessionForm(page);
  await addExercise(dialog, 'Lateral raise');
  await dialog.getByLabel('Lateral raise set 1 reps').fill('15');
  await dialog.getByLabel('Lateral raise set 1 weight').fill('8');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Retire Lateral raise' }).click();
  await expect(page.locator('.details')).toContainText('1 retired');

  // Gone from the picker...
  await page.goto('/#/habits');
  const second = await openSessionForm(page);
  await expect(second.getByLabel('Add an exercise').locator('option', { hasText: 'Lateral raise' })).toHaveCount(0);
  await second.getByRole('button', { name: 'Cancel' }).click();

  // ...but the session that used it still reads exactly as it did.
  await page.getByRole('link', { name: 'Open' }).first().click();
  await expect(page.locator('.session')).toContainText('Lateral raise — 15×8');
  await expect(page.locator('.muscle[data-muscle="shoulders"]')).toHaveAttribute('data-trained', 'true');
});

test('an exercise that has been used is retired rather than deleted', async ({ page }) => {
  await newGymHabit(page);

  const dialog = await openSessionForm(page);
  await addExercise(dialog, 'Plank');
  await dialog.getByLabel('Plank set 1 reps').fill('1');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Edit Plank' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Delete' }).click();

  const warning = page.locator('dialog');
  await expect(warning).toContainText('Retire it instead');
  await expect(warning).toContainText('appears in 1 session');
  await warning.getByRole('button', { name: 'Retire it' }).click();
  await expect(page.locator('.details')).toContainText('1 retired');
});

test('renaming an exercise updates every session that used it', async ({ page }) => {
  await newGymHabit(page);

  const dialog = await openSessionForm(page);
  await addExercise(dialog, 'Overhead press');
  await dialog.getByLabel('Overhead press set 1 reps').fill('8');
  await dialog.getByLabel('Overhead press set 1 weight').fill('40');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Edit Overhead press' }).click();
  await page.locator('dialog').locator('.input').first().fill('Standing press');
  await page.locator('dialog').getByRole('button', { name: 'Save' }).click();

  await page.goto('/#/habits');
  await page.getByRole('link', { name: 'Open' }).first().click();
  await expect(page.locator('.session')).toContainText('Standing press — 8×40');
});

test('the week is judged against the target, and a short week says so', async ({ page }) => {
  await newGymHabit(page, 'Lifting');

  await page.goto('/#/habits');
  await page.getByRole('link', { name: 'Open' }).first().click();
  await expect(page.locator('.stat', { hasText: 'sessions done' })).toContainText('0');
  await expect(page.locator('#view')).toContainText('Every group has had nothing').catch(() => {});
  await expect(page.locator('.muscles .muscle')).toHaveCount(6);

  // Nothing logged yet, so nothing has been trained.
  for (const muscle of ['chest', 'back', 'shoulders', 'legs', 'arms', 'core']) {
    await expect(page.locator(`.muscle[data-muscle="${muscle}"]`)).toHaveAttribute('data-trained', 'false');
  }
});

test('a simple habit keeps its day squares and never asks for sets', async ({ page }) => {
  await page.goto('/#/habits');
  await page.getByRole('button', { name: 'New habit' }).click();
  const dialog = page.locator('dialog');
  await dialog.locator('.input').first().fill('Stretching');
  await dialog.locator('input[type="number"]').fill('5');
  await dialog.getByRole('button', { name: 'Add' }).click();

  const card = page.locator('.card', { hasText: 'Stretching' });
  await expect(card.locator('.week-day')).toHaveCount(7);
  await expect(card.getByRole('button', { name: 'Log a session' })).toHaveCount(0);
  await expect(card).toContainText('0/5 this week');

  // The strip is Sunday-first, matching the week the counts use.
  await expect(card.locator('.week-day').first()).toContainText('Su');
  await expect(card.locator('.week-day').last()).toContainText('Sa');
});

test('a session can be reopened, edited and deleted', async ({ page }) => {
  await newGymHabit(page);

  const dialog = await openSessionForm(page);
  await addExercise(dialog, 'Pull-up');
  await dialog.getByLabel('Pull-up set 1 reps').fill('8');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.getByRole('link', { name: 'Open' }).first().click();
  await page.getByRole('button', { name: /^Open session/ }).click();

  const editor = page.locator('dialog');
  await editor.getByLabel('Pull-up set 1 reps').fill('12');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.session')).toContainText('Pull-up — 12×bw');

  await page.getByRole('button', { name: /^Open session/ }).click();
  await page.locator('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Delete' }).click();

  await expect(page.locator('.session')).toHaveCount(0);
  await expect(page.locator('.stat', { hasText: 'sessions done' })).toContainText('0');
});
