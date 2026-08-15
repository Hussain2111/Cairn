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

// Adding an exercise is two steps now: the group, then the exercise.
async function addExercise(dialog, group, name) {
  await dialog.getByLabel('Muscle group').selectOption(group);
  await dialog.getByLabel('Exercise', { exact: true }).selectOption({ label: name });
  await expect(dialog.locator('.exercise-block', { hasText: name })).toBeVisible();
}

test('a session records sets, reps, how it felt and how long it took', async ({ page }) => {
  await seed(page);

  const dialog = await openSessionForm(page);
  await dialog.getByLabel('Start time').fill('18:05');
  await dialog.getByLabel('End time').fill('19:20');

  await addExercise(dialog, 'chest', 'Bench press');
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
  await addExercise(dialog, 'chest', 'Bench press');
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
  await addExercise(dialog, 'legs', 'Squat');
  await dialog.getByLabel('Squat set 1 reps').fill('5');
  await dialog.getByLabel('Squat set 1 weight').fill('100');
  await dialog.getByRole('button', { name: 'Repeat last set of Squat' }).click();
  await expect(dialog.getByLabel('Squat set 2 reps')).toHaveValue('5');
  await expect(dialog.getByLabel('Squat set 2 weight')).toHaveValue('100');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  dialog = await openSessionForm(page);
  await addExercise(dialog, 'legs', 'Squat');
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
  await addExercise(dialog, 'shoulders', 'Lateral raise');
  await dialog.getByLabel('Lateral raise set 1 reps').fill('15');
  await dialog.getByLabel('Lateral raise set 1 weight').fill('8');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/gym/library');
  await page.getByRole('button', { name: /^Drop Lateral raise$/ }).click();
  await expect(page.locator('#view')).toContainText('1 sets across 1 session(s)');

  // Gone from the picker...
  await page.goto('/#/gym');
  const second = await openSessionForm(page);
  await second.getByLabel('Muscle group').selectOption('shoulders');
  const options = second.getByLabel('Exercise', { exact: true }).locator('option');
  await expect(options.filter({ hasText: /^Lateral raise$/ })).toHaveCount(0);
  await expect(options.filter({ hasText: /^Cable lateral raise$/ })).toHaveCount(1);
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
  await addExercise(dialog, 'back', 'Barbell row');
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



// --- the two-step picker ----------------------------------------------------

test('the exercise list is narrowed by group, with what I have logged first', async ({ page }) => {
  await seed(page);

  // Log a back exercise so it has a recency to order by.
  let dialog = await openSessionForm(page);
  await addExercise(dialog, 'back', 'Lat pulldown');
  await dialog.getByLabel('Lat pulldown set 1 reps').fill('10');
  await dialog.getByLabel('Lat pulldown set 1 weight').fill('50');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  dialog = await openSessionForm(page);
  const exercises = dialog.getByLabel('Exercise', { exact: true });
  await expect(exercises).toBeDisabled();

  await dialog.getByLabel('Muscle group').selectOption('back');
  await expect(exercises).toBeEnabled();

  // Only back exercises, and the one that was logged is under "Done before".
  await expect(exercises.locator('optgroup[label="Done before"] option')).toHaveText(['Lat pulldown']);
  const all = await exercises.locator('option').allTextContents();
  expect(all).not.toContain('Bench press');
  expect(all).toContain('Pull-up');

  // Switching group replaces the list rather than adding to it.
  await dialog.getByLabel('Muscle group').selectOption('chest');
  const chest = await exercises.locator('option').allTextContents();
  expect(chest).toContain('Bench press');
  expect(chest).not.toContain('Pull-up');
});

test('a new exercise can be created inline, and is asked only for a name', async ({ page }) => {
  await seed(page);
  const dialog = await openSessionForm(page);
  await dialog.getByLabel('Muscle group').selectOption('shoulders');
  await dialog.getByLabel('Exercise', { exact: true }).selectOption('__new');

  const create = page.locator('dialog').last();
  await expect(create).toContainText('New shoulders exercise');
  // The group is already known, so the form does not ask again.
  await expect(create.locator('select')).toHaveCount(0);
  await create.getByLabel('Exercise name').fill('Cuban rotation');
  await create.getByRole('button', { name: 'Add' }).click();

  // Created and added to the session in one step.
  await expect(dialog.locator('.exercise-block', { hasText: 'Cuban rotation' })).toBeVisible();
  await dialog.getByLabel('Cuban rotation set 1 reps').fill('12');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/gym/library');
  const row = page.locator('.exercise-row', { hasText: 'Cuban rotation' });
  await expect(row).toContainText('shoulders');
  await expect(row).toContainText('no muscle set');
});

// --- times ------------------------------------------------------------------

test('session times are hour and minute only', async ({ page }) => {
  await seed(page);
  const dialog = await openSessionForm(page);
  // step="60" is what stops the picker offering a seconds field at all.
  await expect(dialog.getByLabel('Start time')).toHaveAttribute('step', '60');
  await expect(dialog.getByLabel('End time')).toHaveAttribute('step', '60');

  await dialog.getByLabel('Start time').fill('18:05');
  await dialog.getByLabel('End time').fill('19:20');
  await addExercise(dialog, 'chest', 'Bench press');
  await dialog.getByLabel('Bench press set 1 reps').fill('10');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  const stored = await page.evaluate(() => {
    const s = window.cairn.store.state.gymSessions[0];
    return [s.startTime, s.endTime];
  });
  expect(stored).toEqual(['18:05', '19:20']);
});

// --- the warm-up ------------------------------------------------------------

test('a warm-up is recorded separately from the exercises', async ({ page }) => {
  await seed(page);
  await page.goto('/#/gym/library');
  await page.getByRole('button', { name: 'Add the usual ones' }).click();
  await expect(page.locator('#view')).toContainText('Cat-cow');

  await page.goto('/#/gym');
  const dialog = await openSessionForm(page);
  await dialog.getByRole('button', { name: 'Warm-up: Treadmill' }).click();
  await dialog.getByRole('button', { name: 'Warm-up: Leg swings' }).click();
  await dialog.getByLabel('Warm-up minutes').fill('10');

  await addExercise(dialog, 'chest', 'Bench press');
  await dialog.getByLabel('Bench press set 1 reps').fill('10');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/gym/history');
  const session = page.locator('.session');
  await expect(session).toContainText('Warm-up');
  await expect(session).toContainText('Treadmill');
  await expect(session).toContainText('Leg swings');
  await expect(session).toContainText('10m');
  // The warm-up is not an exercise: it contributes no sets.
  await expect(session).toContainText('1 exercise');
});

test('warm-up movements are their own library, not a muscle group', async ({ page }) => {
  await seed(page);
  await page.goto('/#/gym/library');
  await page.getByRole('button', { name: 'Add the usual ones' }).click();

  // Cat-cow is in the warm-up list...
  await expect(page.locator('#view')).toContainText('Warm-up movements');
  await expect(page.getByRole('button', { name: 'Edit Cat-cow' })).toBeVisible();

  // ...and not offered as a core exercise.
  await page.goto('/#/gym');
  const dialog = await openSessionForm(page);
  await dialog.getByLabel('Muscle group').selectOption('core');
  const options = await dialog.getByLabel('Exercise', { exact: true }).locator('option').allTextContents();
  expect(options.join(' ')).not.toContain('Cat-cow');
  expect(options.join(' ')).toContain('Plank');
});

// --- the body diagram -------------------------------------------------------

test('the diagram and the muscle list are two views of one selection', async ({ page }) => {
  await seed(page);
  await page.goto('/#/gym/library');
  await page.getByRole('button', { name: 'Edit Bench press' }).click();
  const dialog = page.locator('dialog');

  // Two figures, front and back.
  await expect(dialog.locator('.figure')).toHaveCount(2);
  await expect(dialog).toContainText('Front');
  await expect(dialog).toContainText('Back');

  // The exercise's own muscle starts selected in both views.
  await expect(dialog.locator('.region[data-muscle="mid chest"]')).toHaveAttribute('data-selected', 'true');
  await expect(dialog.locator('.muscle-chip[data-muscle="mid chest"]')).toHaveAttribute('aria-pressed', 'true');

  // Picking on the diagram moves the list.
  await dialog.locator('.region[data-muscle="upper chest"]').click();
  await expect(dialog.locator('.muscle-chip[data-muscle="upper chest"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('.muscle-chip[data-muscle="mid chest"]')).toHaveAttribute('aria-pressed', 'false');

  // Picking in the list moves the diagram.
  await dialog.locator('.muscle-chip[data-muscle="lats"]').click();
  await expect(dialog.locator('.region[data-muscle="lats"]')).toHaveAttribute('data-selected', 'true');
  await expect(dialog.locator('.region[data-muscle="upper chest"]')).toHaveAttribute('data-selected', 'false');
  // And the broad group follows the muscle rather than being asked for twice.
  await expect(dialog.getByLabel('Broad group')).toHaveValue('back');

  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.exercise-row', { hasText: 'Bench press' })).toContainText('lats');
});

test('every region is reachable and selectable from the keyboard', async ({ page }) => {
  await seed(page);
  await page.goto('/#/gym/library');
  await page.getByRole('button', { name: 'Edit Bench press' }).click();
  const dialog = page.locator('dialog');

  const region = dialog.locator('.region[data-muscle="lower chest"]');
  await expect(region).toHaveAttribute('tabindex', '0');
  await expect(region).toHaveAttribute('role', 'button');

  await region.focus();
  await page.keyboard.press('Enter');
  await expect(region).toHaveAttribute('aria-pressed', 'true');

  // Space works too, and toggles it back off.
  await page.keyboard.press(' ');
  await expect(region).toHaveAttribute('aria-pressed', 'false');
});

test('a region absent from one figure is absent, not drawn greyed', async ({ page }) => {
  await seed(page);
  await page.goto('/#/gym/library');
  await page.getByRole('button', { name: 'Edit Bench press' }).click();
  const dialog = page.locator('dialog');

  // Lats are on the back only; the chest is on the front only.
  const front = dialog.locator('.figure').first();
  const back = dialog.locator('.figure').last();
  await expect(front.locator('.region[data-muscle="lats"]')).toHaveCount(0);
  await expect(back.locator('.region[data-muscle="lats"]')).toHaveCount(1);
  await expect(back.locator('.region[data-muscle="mid chest"]')).toHaveCount(0);
  await expect(front.locator('.region[data-muscle="mid chest"]')).toHaveCount(1);

  // Every muscle in the taxonomy is drawn exactly once across the two figures.
  await expect(dialog.locator('.region')).toHaveCount(20);
});
