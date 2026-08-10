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

test('the sidebar foot reads as one list', async ({ page }) => {
  await page.goto('/');
  const foot = page.locator('.sidebar__foot');
  // Search, Settings and Shortcuts are the same component, so they align.
  await expect(foot.locator('.nav__link')).toHaveCount(3);
  await expect(foot).toContainText('Search');
  await expect(foot).toContainText('Settings');
  await expect(foot).toContainText('Shortcuts');

  // Same layout, same box, same starting edge — a button no longer centres
  // its label while the link beside it starts at the left.
  const boxes = await foot.locator('.nav__link').evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      return [
        style.display,
        style.justifyContent,
        style.textAlign,
        style.paddingLeft,
        Math.round(node.getBoundingClientRect().left),
        Math.round(node.getBoundingClientRect().width),
      ].join('|');
    }));
  expect(new Set(boxes).size).toBe(1);

  // And the focus ring still lands on them.
  await foot.getByRole('button', { name: 'Search' }).focus();
  const outline = await foot.getByRole('button', { name: 'Search' })
    .evaluate((node) => getComputedStyle(node).outlineWidth);
  expect(outline).not.toBe('0px');
});
