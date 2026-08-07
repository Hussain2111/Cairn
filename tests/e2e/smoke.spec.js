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

  for (const route of ['#/threads', '#/questions', '#/notes', '#/pipelines', '#/time', '#/weekly', '#/habits', '#/reading', '#/search', '#/settings']) {
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
