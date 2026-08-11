import { test, expect } from '@playwright/test';

// The gym flows that matter: a session records what happened rather than that
// it happened, the week is judged on muscle coverage, dropping an exercise says
// why and never rewrites history, pain answers one question, and the logbook
// importer shows everything before it writes anything.

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

test('a session records sets, reps and how it felt', async ({ page }) => {
  await seed(page);

  const dialog = await openSessionForm(page);
  await dialog.getByLabel('Start time').fill('18:05');
  await dialog.getByLabel('End time').fill('19:20');
  await dialog.getByLabel('Warmed up').check();
  await dialog.getByLabel('Warm-up minutes').fill('10');

  await addExercise(dialog, 'Bench press');
  await dialog.getByLabel('Bench press set 1 reps').fill('10');
  await dialog.getByLabel('Bench press set 1 weight').fill('60');
  await dialog.getByLabel('Note for Bench press').fill('no tension in the target muscle');

  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/gym/history');
  await expect(page.locator('.session')).toContainText('Bench press — 10×60');
  await expect(page.locator('.session')).toContainText('no tension in the target muscle');
  await expect(page.locator('.session')).toContainText('1h 15m');
  await expect(page.locator('.session')).toContainText('warm-up 10m');
});

test('the week counts sessions and only lights up the muscles trained directly', async ({ page }) => {
  await seed(page);

  const dialog = await openSessionForm(page);
  await addExercise(dialog, 'Bench press');
  await dialog.getByLabel('Bench press set 1 reps').fill('10');
  await dialog.getByLabel('Bench press set 1 weight').fill('60');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/gym');
  await expect(page.locator('.stat', { hasText: 'sessions done' })).toContainText('1');
  await expect(page.locator('.stat', { hasText: 'target' })).toContainText('4');
  await expect(page.locator('.stat', { hasText: 'still to do' })).toContainText('3');

  await expect(page.locator('.muscle[data-muscle="chest"]')).toHaveAttribute('data-trained', 'true');
  // Bench press lists arms as a secondary, which is not an arms day.
  await expect(page.locator('.muscle[data-muscle="arms"]')).toHaveAttribute('data-trained', 'false');
  await expect(page.locator('.muscle[data-muscle="legs"]')).toHaveAttribute('data-trained', 'false');
  await expect(page.locator('#view')).toContainText('back, shoulders, legs, arms, core');
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

test('the rotation offers the next slot, and deviating from it is free', async ({ page }) => {
  await seed(page);
  await expect(page.locator('#view')).toContainText('Next in the rotation');

  const dialog = await openSessionForm(page);
  await expect(dialog).toContainText('is next in the rotation');
  await addExercise(dialog, 'Bench press');
  await dialog.getByLabel('Bench press set 1 reps').fill('8');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  // Having logged A, B is offered next.
  const second = await openSessionForm(page);
  await expect(second).toContainText('B — pull and legs is next');
  await second.getByRole('button', { name: 'Cancel' }).click();
});

test('a partial session records what was skipped and why', async ({ page }) => {
  await seed(page);

  const dialog = await openSessionForm(page);
  await addExercise(dialog, 'Bench press');
  await dialog.getByLabel('Bench press set 1 reps').fill('10');

  await dialog.getByLabel('Record a skipped exercise').selectOption({ label: 'Leg press' });
  const skip = page.locator('dialog').last();
  await expect(skip).toContainText('Skipped Leg press');
  await skip.getByLabel('Why it was skipped').selectOption('occupied');
  await skip.getByLabel('Skip note').fill('someone was camped on it');
  await skip.getByRole('button', { name: 'Record it' }).click();

  await expect(dialog).toContainText('Leg press');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/gym/history');
  await expect(page.locator('.session')).toContainText('Leg press — occupied');
  // A skipped exercise is not training.
  await page.goto('/#/gym');
  await expect(page.locator('.muscle[data-muscle="legs"]')).toHaveAttribute('data-trained', 'false');
});

test('a substitution is recorded as both the intended and the actual exercise', async ({ page }) => {
  await seed(page);

  const dialog = await openSessionForm(page);
  await dialog.getByLabel('Record a skipped exercise').selectOption({ label: 'Squat' });
  const skip = page.locator('dialog').last();
  await skip.getByLabel('Why it was skipped').selectOption('occupied');
  await skip.getByLabel('Did something else instead').selectOption({ label: 'Smith machine squat' });
  await skip.getByRole('button', { name: 'Record it' }).click();

  await expect(dialog).toContainText('instead of Squat');
  await dialog.getByLabel('Smith machine squat set 1 reps').fill('8');
  await dialog.getByLabel('Smith machine squat set 1 weight').fill('60');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/gym/history');
  await expect(page.locator('.session')).toContainText('Smith machine squat — 8×60');
  await expect(page.locator('.session')).toContainText('(instead of Squat)');
  await expect(page.locator('.session')).toContainText('Squat — occupied');
});

test('cues appear the moment the exercise is logged', async ({ page }) => {
  await seed(page);

  await page.goto('/#/gym/library');
  await page.getByRole('button', { name: 'Edit Bench press' }).click();
  await page.locator('dialog').locator('textarea').fill('brace, elbows at 45, touch the same spot every rep');
  await page.locator('dialog').getByRole('button', { name: 'Save' }).click();

  await page.goto('/#/gym');
  const dialog = await openSessionForm(page);
  await addExercise(dialog, 'Bench press');
  await expect(dialog.locator('.cues')).toContainText('touch the same spot every rep');
});

test('dropping an exercise asks why, and the three reasons stay apart', async ({ page }) => {
  await seed(page);

  await page.goto('/#/gym/library');
  await page.getByRole('button', { name: 'Drop Lateral raise' }).click();
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('three different problems');
  await dialog.getByLabel('Why it is being dropped').selectOption('pain');
  await dialog.getByLabel('Drop note').fill('right shoulder, every time');
  await dialog.getByRole('button', { name: 'Drop it' }).click();

  await expect(page.locator('#view')).toContainText('dropped: pain');
  await expect(page.locator('#view')).toContainText('right shoulder, every time');
});

test('a dropped exercise leaves every session that used it exactly as it was', async ({ page }) => {
  await seed(page);

  const dialog = await openSessionForm(page);
  await addExercise(dialog, 'Lateral raise');
  await dialog.getByLabel('Lateral raise set 1 reps').fill('15');
  await dialog.getByLabel('Lateral raise set 1 weight').fill('8');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/gym/library');
  await page.getByRole('button', { name: 'Drop Lateral raise' }).click();
  await page.locator('dialog').getByLabel('Why it is being dropped').selectOption('disliked');
  await page.locator('dialog').getByRole('button', { name: 'Drop it' }).click();

  // Gone from the picker...
  await page.goto('/#/gym');
  const second = await openSessionForm(page);
  // Anchored: the starter list also has a "Cable lateral raise", which stays.
  await expect(second.getByLabel('Add an exercise').locator('option', { hasText: /^Lateral raise$/ })).toHaveCount(0);
  await expect(second.getByLabel('Add an exercise').locator('option', { hasText: /^Cable lateral raise$/ })).toHaveCount(1);
  await second.getByRole('button', { name: 'Cancel' }).click();

  // ...and still exactly as it was in the session that used it.
  await page.goto('/#/gym/history');
  await expect(page.locator('.session')).toContainText('Lateral raise — 15×8');
  await page.goto('/#/gym');
  await expect(page.locator('.muscle[data-muscle="shoulders"]')).toHaveAttribute('data-trained', 'true');
});

test('the gap report names muscle groups with nothing usable left', async ({ page }) => {
  await seed(page);
  await page.goto('/#/gym/library');

  for (const name of ['Plank', 'Hanging leg raise']) {
    await page.getByRole('button', { name: `Drop ${name}` }).click();
    await page.locator('dialog').getByLabel('Why it is being dropped').selectOption('pain');
    await page.locator('dialog').getByRole('button', { name: 'Drop it' }).click();
  }

  await page.goto('/#/gym');
  await expect(page.locator('#view')).toContainText('Gaps in the library');
  await expect(page.locator('#view')).toContainText('everything dropped');
  await expect(page.locator('#view')).toContainText('2 dropped for pain');
});

test('equipment preference counts what was kept and what hurt', async ({ page }) => {
  await seed(page);

  const dialog = await openSessionForm(page);
  await addExercise(dialog, 'Cable fly');
  await dialog.getByLabel('Cable fly set 1 reps').fill('12');
  await dialog.getByLabel('Cable fly set 1 weight').fill('15');
  await dialog.getByRole('button', { name: 'Log it' }).click();

  await page.goto('/#/gym');
  const cable = page.locator('.dist[data-equipment="cable"]');
  await expect(cable).toContainText('1 sets');
  await expect(cable).toContainText('active');
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

test('pain is recordable from inside a session and exports as a dated table', async ({ page }) => {
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
  await expect(page.locator('.pain-group')).toContainText('lower back');
  await expect(page.locator('.pain-group')).toContainText('Barbell row');
  await expect(page.locator('.pain-group')).toContainText('after');
  await expect(page.getByRole('button', { name: 'Export as CSV' })).toBeVisible();
});

test('the logbook importer shows everything before it writes anything', async ({ page }) => {
  await page.goto('/#/gym');
  await page.getByRole('button', { name: 'Import logbook' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByRole('button', { name: 'Show me the shapes it understands' }).click();
  await page.waitForTimeout(400);

  await expect(dialog).toContainText('new exercises');
  await expect(dialog).toContainText('2 sessions');
  await expect(dialog).toContainText('15 sets');
  await expect(dialog).toContainText('Every line was understood');
  await expect(dialog).toContainText('Smith machine squat');
  await expect(dialog).toContainText('Leg press — occupied');

  await dialog.getByRole('button', { name: 'Import', exact: true }).click();

  await expect(page.locator('.session')).toHaveCount(2);
  await expect(page.locator('.session').first()).toContainText('Lat pulldown');
  await expect(page.locator('#view')).toContainText('no tension in the target muscle');

  await page.goto('/#/gym/pain');
  await expect(page.locator('.pain-group')).toContainText('right shoulder');

  await page.goto('/#/gym/library');
  await expect(page.locator('#view')).toContainText('dropped: pain');
  await expect(page.locator('#view')).toContainText('drive the elbows down');
});

test('the importer lists lines it could not interpret rather than dropping them', async ({ page }) => {
  await page.goto('/#/gym');
  await page.getByRole('button', { name: 'Import logbook' }).click();
  const dialog = page.locator('dialog');
  await dialog.locator('textarea').fill(`## 2026-08-03

- Bench press · 3×10 @ 60kg

Felt reasonably strong today, thinking about changing the split soon.
`);
  await page.waitForTimeout(400);

  await expect(dialog).toContainText('1 line(s) could not be interpreted');
  await expect(dialog).toContainText('line 5');
  await expect(dialog).toContainText('thinking about changing the split');
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
});

test('a guess made by the importer can be corrected before it is written', async ({ page }) => {
  await page.goto('/#/gym');
  await page.getByRole('button', { name: 'Import logbook' }).click();
  const dialog = page.locator('dialog');
  await dialog.locator('textarea').fill(`## 2026-08-03
- Cable fly · 3×12 @ 15kg
`);
  await page.waitForTimeout(400);

  await expect(dialog).toContainText('muscle read from the name');
  await dialog.getByLabel('Primary muscle for Cable fly').selectOption('shoulders');
  await dialog.getByLabel('Equipment for Cable fly').selectOption('cable');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();

  await page.goto('/#/gym/library');
  const row = page.locator('.exercise-row', { hasText: 'Cable fly' });
  await expect(row).toContainText('shoulders');
  await expect(row).toContainText('cable');
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
