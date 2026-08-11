import { test, expect } from '@playwright/test';

// The gym flows that are left after the tab was cut back to what it is used
// for: recording what was lifted, seeing whether a lift is moving, and pain.
// Anything a sentence records as well as a dropdown did is now a note.

async function seed(page) {
  await page.goto('/#/gym');
  await page.getByRole('button', { name: 'Add the starter library' }).click();
  await expect(page.locator('#view')).toContainText('This week');
}

async function openSessionForm(page) {
  await page.getByRole('button', { name: 'Log a session' }).first().click();
  return page.locator('dialog');
}

async function addExercise(dialog, name) {
  await dialog.getByLabel('Add an exercise').selectOption({ label: name });
  await expect(dialog.locator('.exercise-block', { hasText: name })).toBeVisible();
}

test('a session records sets, reps, how it felt and how long it took', async ({ page }) => {
  await seed(page);

  const dialog = await openSessionForm(page);
  await dialog.getByLabel('Start time').fill('18:05');
  await dialog.getByLabel('End time').fill('19:20');

  await addExercise(dialog, 'Bench press');
  await dialog.getByLabel('Bench press set 1 reps').fill('10');
  await dialog.getByLabel('Bench press set 1 weight').fill('60');
  await dialog.getByLabel('Note for Bench press').fill('no tension in the target muscle');
  await dialog.getByLabel('Session notes').fill('ten minutes on the bike first, skipped the last set');

  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/gym/history');
  await expect(page.locator('.session')).toContainText('Bench press — 10×60');
  await expect(page.locator('.session')).toContainText('no tension in the target muscle');
  await expect(page.locator('.session')).toContainText('18:05–19:20');
  await expect(page.locator('.session')).toContainText('1h 15m');
  // Everything the session-level dropdowns used to hold is one line of text.
  await expect(page.locator('.session')).toContainText('skipped the last set');
});

test('the week counts sessions against the target', async ({ page }) => {
  await seed(page);

  const dialog = await openSessionForm(page);
  await addExercise(dialog, 'Bench press');
  await dialog.getByLabel('Bench press set 1 reps').fill('10');
  await dialog.getByLabel('Bench press set 1 weight').fill('60');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/gym');
  await expect(page.locator('.stat', { hasText: 'sessions' })).toContainText('1');
  await expect(page.locator('.stat', { hasText: 'target' })).toContainText('4');
  await expect(page.locator('.stat', { hasText: 'still to do' })).toContainText('3');
  // The day it was logged on is marked on the strip.
  await expect(page.locator('.week-day--on')).toHaveCount(1);
});

test('"repeat set" copies the row above, and next time the whole block is filled in', async ({ page }) => {
  await seed(page);

  let dialog = await openSessionForm(page);
  await addExercise(dialog, 'Squat');
  await dialog.getByLabel('Squat set 1 reps').fill('5');
  await dialog.getByLabel('Squat set 1 weight').fill('100');
  await dialog.getByRole('button', { name: 'Repeat last set of Squat' }).click();
  await expect(dialog.getByLabel('Squat set 2 reps')).toHaveValue('5');
  await expect(dialog.getByLabel('Squat set 2 weight')).toHaveValue('100');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  dialog = await openSessionForm(page);
  await addExercise(dialog, 'Squat');
  await expect(dialog.getByLabel('Squat set 1 weight')).toHaveValue('100');
  await expect(dialog.getByLabel('Squat set 2 weight')).toHaveValue('100');
  await dialog.getByLabel('Squat set 2 weight').fill('105');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/gym/history');
  await expect(page.locator('.session').first()).toContainText('Squat — 5×100, 5×105');
});

test('an exercise can be dropped and brought back with one button', async ({ page }) => {
  await seed(page);
  await page.goto('/#/gym/library');

  // Anchored: the starter list also has a "Cable lateral raise", which stays.
  await page.getByRole('button', { name: /^Drop Lateral raise$/ }).click();
  const row = page.locator('.exercise-row', { hasText: /^Lateral raise/ });
  await expect(row).toHaveAttribute('data-status', 'dropped');

  await page.getByRole('button', { name: /^Bring back Lateral raise$/ }).click();
  await expect(page.locator('.exercise-row', { hasText: /^Lateral raise/ })).toHaveAttribute('data-status', 'active');
});

test('a dropped exercise leaves every session that used it exactly as it was', async ({ page }) => {
  await seed(page);

  const dialog = await openSessionForm(page);
  await addExercise(dialog, 'Lateral raise');
  await dialog.getByLabel('Lateral raise set 1 reps').fill('15');
  await dialog.getByLabel('Lateral raise set 1 weight').fill('8');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/gym/library');
  await page.getByRole('button', { name: /^Drop Lateral raise$/ }).click();
  await expect(page.locator('#view')).toContainText('1 sets across 1 session(s)');

  // Gone from the picker...
  await page.goto('/#/gym');
  const second = await openSessionForm(page);
  await expect(second.getByLabel('Add an exercise').locator('option', { hasText: /^Lateral raise$/ })).toHaveCount(0);
  await expect(second.getByLabel('Add an exercise').locator('option', { hasText: /^Cable lateral raise$/ })).toHaveCount(1);
  await second.getByRole('button', { name: 'Cancel' }).click();

  // ...and still exactly as it was in the session that used it.
  await page.goto('/#/gym/history');
  await expect(page.locator('.session')).toContainText('Lateral raise — 15×8');
});

test('pain says whether it follows the movement or follows me', async ({ page }) => {
  await seed(page);
  await page.goto('/#/gym/pain');

  const record = async (location, exercise) => {
    await page.getByRole('button', { name: 'Record pain' }).first().click();
    const dialog = page.locator('dialog');
    await dialog.getByLabel('Where').fill(location);
    await dialog.getByLabel('Exercise').selectOption({ label: exercise });
    await dialog.getByRole('button', { name: 'Record it' }).click();
  };

  await record('right shoulder', 'Bench press');
  await expect(page.locator('.pain-group')).toHaveAttribute('data-recurring', 'false');
  await expect(page.locator('#view')).toContainText('one exercise only');

  await record('right shoulder', 'Overhead press');
  await expect(page.locator('.pain-group').first()).toHaveAttribute('data-recurring', 'true');
  await expect(page.locator('#view')).toContainText('2 different exercises');
  await expect(page.locator('#view')).toContainText('hurting across more than one exercise');

  // A second location that only ever appears on one movement stays separate.
  await record('lower back', 'Deadlift');
  await expect(page.locator('.pain-group')).toHaveCount(2);
});

test('pain is recordable from inside a session, with every exercise and date attached to the location', async ({ page }) => {
  await seed(page);

  const dialog = await openSessionForm(page);
  await addExercise(dialog, 'Barbell row');
  await dialog.getByLabel('Barbell row set 1 reps').fill('10');
  await dialog.getByRole('button', { name: 'Record pain during Barbell row' }).click();

  const painDialog = page.locator('dialog').last();
  await painDialog.getByLabel('Where it hurt').fill('lower back');
  await painDialog.getByLabel('During or after').selectOption('after');
  await painDialog.getByRole('button', { name: 'Record it' }).click();

  await expect(dialog).toContainText('lower back');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/gym/pain');
  const group = page.locator('.pain-group');
  await expect(group).toContainText('lower back');
  await expect(group.locator('tbody tr')).toHaveCount(1);
  await expect(group.locator('tbody tr')).toContainText('Barbell row');
  await expect(group.locator('tbody tr')).toContainText('after');
  await expect(page.getByRole('button', { name: 'Export as CSV' })).toBeVisible();
});

test('progression tracks a bodyweight movement by reps', async ({ page }) => {
  await seed(page);

  for (const reps of ['6', '9']) {
    const dialog = await openSessionForm(page);
    await addExercise(dialog, 'Pull-up');
    await dialog.getByLabel('Pull-up set 1 reps').fill(reps);
    await dialog.getByRole('button', { name: 'Log it' }).click();
  }

  await page.goto('/#/gym');
  await page.getByLabel('Exercise to chart').selectOption({ label: 'Pull-up' });
  await expect(page.locator('#view')).toContainText('bodyweight — tracked by reps');
  await expect(page.locator('#view')).toContainText('best 9 reps');
});

test('progression tracks a loaded movement by weight', async ({ page }) => {
  await seed(page);

  for (const weight of ['60', '65']) {
    const dialog = await openSessionForm(page);
    await addExercise(dialog, 'Bench press');
    await dialog.getByLabel('Bench press set 1 reps').fill('8');
    await dialog.getByLabel('Bench press set 1 weight').fill(weight);
    await dialog.getByRole('button', { name: 'Log it' }).click();
  }

  await page.goto('/#/gym');
  await page.getByLabel('Exercise to chart').selectOption({ label: 'Bench press' });
  await expect(page.locator('#view')).toContainText('best 65 kg × 8');
  await expect(page.locator('#view')).toContainText('up 5 kg');
});
