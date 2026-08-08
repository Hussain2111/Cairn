import { test, expect } from '@playwright/test';

// Flow 2 from the brief: add a question, log a failed attempt, confirm it
// schedules correctly and appears in the review queue on the right day.

function isoToday(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function addQuestion(page, { bank = 'SQL', title, url = '', expectDuplicatePrompt = false }) {
  await page.goto('/#/questions');
  await page.getByRole('button', { name: 'Add question' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Bank').selectOption({ label: bank });
  await dialog.getByLabel('Title').fill(title);
  if (url) await dialog.getByLabel('Source URL').fill(url);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  // A duplicate leaves its own dialog open in place of the editor.
  if (!expectDuplicatePrompt) await expect(page.locator('dialog')).toHaveCount(0);
}

async function logAttempt(page, { unaided = false, hesitation = '', minutes = null }) {
  const dialog = page.locator('dialog');
  if (unaided) await dialog.getByLabel('Solved it unaided').check();
  if (minutes !== null) await dialog.getByLabel('Minutes').fill(String(minutes));
  if (hesitation) await dialog.getByLabel('What I hesitated on').fill(hesitation);
  await dialog.getByRole('button', { name: 'Record' }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
}

test('a new question is due today and shows in the review queue', async ({ page }) => {
  await addQuestion(page, { title: 'Second highest salary' });

  await page.goto('/#/today');
  await expect(page.locator('.section', { hasText: 'Review queue' })).toContainText('1 due');

  await page.goto('/#/questions/review');
  await expect(page.getByRole('heading', { name: 'Second highest salary' })).toBeVisible();
});

test('a failed attempt resets the chain and keeps the question due today', async ({ page }) => {
  await addQuestion(page, { title: 'Window functions' });

  // Walk it forward first so the reset has something to undo.
  await page.goto('/#/questions/sql');
  await page.getByRole('button', { name: 'Attempt' }).click();
  await logAttempt(page, { unaided: true, minutes: 9 });
  await expect(page.locator('.q-row')).toContainText(`in 2d`);

  // Now fail it. Day 2 offsets reset to day 0 — due again today.
  await page.getByRole('button', { name: 'Attempt' }).click();
  await logAttempt(page, { hesitation: 'forgot the frame clause entirely' });
  await expect(page.locator('.q-row')).toContainText('today');

  await page.goto('/#/questions/review');
  await expect(page.getByRole('heading', { name: 'Window functions' })).toBeVisible();
  await expect(page.getByText('forgot the frame clause entirely')).toBeVisible();
});

test('the scheduler walks 0 / 2 / 7 / 21 and then retires', async ({ page }) => {
  await addQuestion(page, { title: 'Two Sum', bank: 'LeetCode' });
  await page.goto('/#/questions/leetcode');

  const expected = [2, 7, 21];
  for (const days of expected) {
    await page.getByRole('button', { name: 'Attempt' }).click();
    // The dialog states the consequence before you commit to it.
    const dialog = page.locator('dialog');
    await dialog.getByLabel('Solved it unaided').check();
    await expect(dialog.locator('.field__hint').last()).toContainText(`in ${days}d`);
    await dialog.getByRole('button', { name: 'Record' }).click();
    await expect(page.locator('dialog')).toHaveCount(0);
  }

  // Fourth clean solve, at the final interval, retires it.
  await page.getByRole('button', { name: 'Attempt' }).click();
  await logAttempt(page, { unaided: true });
  await expect(page.getByText('Retired — solved unaided at the final interval.')).toBeVisible();

  await expect(page.locator('.q-row')).toHaveCount(0);
  await page.goto('/#/questions/leetcode?retired=1');
  await expect(page.locator('.q-row')).toContainText('Two Sum');
});

test('hesitation blocks retirement at the final interval', async ({ page }) => {
  await addQuestion(page, { title: 'Inequalities', bank: 'GRE' });
  await page.goto('/#/questions/gre');

  for (let i = 0; i < 3; i += 1) {
    await page.getByRole('button', { name: 'Attempt' }).click();
    await logAttempt(page, { unaided: true });
  }

  await page.getByRole('button', { name: 'Attempt' }).click();
  await logAttempt(page, { unaided: true, hesitation: 'had to check the sign flip' });
  await expect(page.getByText('stays at the final interval')).toBeVisible();
  await expect(page.locator('.q-row')).toContainText('in 21d');
});

test('a duplicate is detected by URL and can be merged', async ({ page }) => {
  await addQuestion(page, { title: 'Two Sum', bank: 'LeetCode', url: 'https://leetcode.com/problems/two-sum/' });
  await page.goto('/#/questions/leetcode');
  await page.getByRole('button', { name: 'Attempt' }).click();
  await logAttempt(page, { unaided: true, minutes: 12 });

  await addQuestion(page, {
    title: 'Two Sum (again)',
    bank: 'LeetCode',
    url: 'http://www.leetcode.com/problems/two-sum',
    expectDuplicatePrompt: true,
  });
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('already have');
  await expect(dialog).toContainText('1 attempt(s)');
  await dialog.getByRole('button', { name: 'Merge into the existing one' }).click();

  await expect(page.locator('.q-row')).toHaveCount(1);
});

test('review dates use local time and do not flip at UTC midnight', async ({ page }) => {
  // Pin the clock to 23:30 local on a fixed day. A UTC-derived date would
  // already read as the next day in London during BST.
  await page.clock.install({ time: new Date('2026-08-07T23:30:00+01:00') });
  await page.goto('/');
  await addQuestion(page, { title: 'Late night question' });

  await page.goto('/#/questions/sql');
  await expect(page.locator('.q-row')).toContainText('7 Aug');
  await expect(page.locator('.q-row')).toContainText('today');
});
