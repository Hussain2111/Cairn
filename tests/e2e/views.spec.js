import { test, expect } from '@playwright/test';

// The remaining surfaces: pipelines and the spreadsheet importer, time
// blocking, the weekly review, reading and the narrow-screen layout.

function iso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

test('a block can be assigned to the gym or to practice, not only to a thread', async ({ page }) => {
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
