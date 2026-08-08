import { test, expect } from '@playwright/test';

// Saving must never interrupt typing. Both of these are easy to get wrong when
// every mutation re-renders the view.

test('typing a note keeps focus and the caret through an autosave', async ({ page }) => {
  await page.goto('/#/notes');
  await page.getByRole('button', { name: 'New note' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Title').fill('Long note');
  await dialog.getByRole('button', { name: 'Create' }).click();

  const body = page.locator('.textarea--tall');
  await body.click();
  await body.pressSequentially('first sentence');

  // Autosave fires ~600ms after the last keystroke.
  await page.waitForTimeout(1200);
  await expect(body).toBeFocused();

  // Typed with no explicit target: it lands wherever focus actually is.
  await page.keyboard.type(' and the rest');
  await expect(body).toHaveValue('first sentence and the rest');

  await page.reload();
  await expect(page.locator('.textarea--tall')).toHaveValue('first sentence and the rest');
});

test('adding several tasks in a row keeps the cursor in the add box', async ({ page }) => {
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
  await dialog.getByRole('button', { name: 'Add step' }).click();

  const box = page.getByPlaceholder('Add a task…');
  await box.click();
  await box.fill('one');
  await box.press('Enter');
  await expect(page.locator('.task')).toHaveCount(1);

  // Without re-focusing after the re-render, this second task would be typed
  // into nothing.
  await expect(page.getByPlaceholder('Add a task…')).toBeFocused();
  await page.keyboard.type('two');
  await page.keyboard.press('Enter');
  await expect(page.locator('.task')).toHaveCount(2);
  await expect(page.locator('.task').nth(1)).toContainText('two');
});
