import { test, expect } from '@playwright/test';

// Fails the run on any uncaught page error, so a broken import or a typo in a
// view surfaces here rather than as a mysteriously missing element.
test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.errors = errors;
});

test('every view renders without a console error', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();

  for (const route of ['#/threads', '#/threads?filter=done', '#/questions', '#/questions/sql', '#/questions/gre', '#/questions/review', '#/pipelines', '#/time', '#/weekly', '#/gym', '#/gym/library', '#/gym/pain', '#/gym/history', '#/reading', '#/settings']) {
    await page.goto(`/${route}`);
    await expect(page.locator('h1.page-title')).toBeVisible();
  }

  expect(page.errors).toEqual([]);
});

test('the empty state on Today explains the first action', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No active threads')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create a thread' })).toBeVisible();
});

test('theme choice persists across a reload', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the sidebar foot is Settings alone, and there is no search or shortcuts anywhere', async ({ page }) => {
  await page.goto('/');
  const foot = page.locator('.sidebar__foot');
  await expect(foot.locator('.nav__link')).toHaveCount(1);
  await expect(foot).toContainText('Settings');

  const sidebar = page.locator('#sidebar');
  await expect(sidebar).not.toContainText('Search');
  await expect(sidebar).not.toContainText('Shortcuts');
  await expect(sidebar).not.toContainText('Notes');
  await expect(sidebar).not.toContainText('GRE');

  // The keys those features answered to do nothing now.
  await page.keyboard.press('?');
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.keyboard.press('/');
  await expect(page).toHaveURL(/#\/today|#\/$|\/$/);
});

test('undo still works from the keyboard, since it is the only way to reverse a delete', async ({ page }) => {
  await page.goto('/#/threads');
  await page.getByRole('button', { name: 'New thread' }).click();
  await page.locator('dialog').getByLabel('Name').fill('Undo me');
  await page.locator('dialog').getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Undo me', level: 1 })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+z');
  await page.goto('/#/threads');
  await expect(page.locator('#view')).not.toContainText('Undo me');
});
