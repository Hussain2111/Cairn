import { test, expect } from '@playwright/test';

// Reading is a list now. There is no importer, no reader, no bookmarks and no
// cover — so what is left to test is that a book can be recorded, moved between
// the three states, and found again.

async function addBook(page, { title, author = '', status = null, page: currentPage = null, rating = null, notes = null }) {
  await page.getByRole('button', { name: 'Add a book' }).first().click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Title').fill(title);
  if (author) await dialog.getByLabel('Author').fill(author);
  if (status) await dialog.getByLabel('Status').selectOption({ label: status });
  if (currentPage) await dialog.getByLabel('Current page').fill(String(currentPage));
  if (rating) await dialog.getByLabel('Rating').fill(String(rating));
  if (notes) await dialog.getByLabel('Notes').fill(notes);
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
}

test('a book is a title, an author and a status', async ({ page }) => {
  await page.goto('/#/reading');
  await addBook(page, { title: 'Structure and Interpretation', author: 'Abelson and Sussman', page: 120 });

  const row = page.locator('.book-row', { hasText: 'Structure and Interpretation' });
  await expect(row).toContainText('Abelson and Sussman');
  await expect(row).toContainText('Reading');
  await expect(row).toContainText('page 120');
  await expect(page.locator('.stat', { hasText: 'reading' })).toContainText('1');
});

test('the three states are the whole model, and they sort in reading order', async ({ page }) => {
  await page.goto('/#/reading');
  await addBook(page, { title: 'Finished one', status: 'Finished', rating: 4 });
  await addBook(page, { title: 'Waiting one', status: 'Want to read' });
  await addBook(page, { title: 'Current one', status: 'Reading' });

  const rows = page.locator('.book-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Current one');
  await expect(rows.nth(1)).toContainText('Waiting one');
  await expect(rows.nth(2)).toContainText('Finished one');

  // The status picker offers three and only three.
  await page.getByRole('button', { name: 'Add a book' }).click();
  await expect(page.locator('dialog').getByLabel('Status').locator('option')).toHaveCount(3);
  await page.locator('dialog').getByRole('button', { name: 'Cancel' }).click();
});

test('a rating shows on a finished book and a page number does not', async ({ page }) => {
  await page.goto('/#/reading');
  await addBook(page, { title: 'Done with it', status: 'Finished', rating: 5, page: 300 });
  const row = page.locator('.book-row', { hasText: 'Done with it' });
  await expect(row).toContainText('★★★★★');
  await expect(row).not.toContainText('page 300', { useInnerText: true });
});

test('a book can be moved on and removed', async ({ page }) => {
  await page.goto('/#/reading');
  await addBook(page, { title: 'The Mythical Man-Month', notes: 'chapter 2 is the one' });

  await page.getByRole('button', { name: 'Edit The Mythical Man-Month' }).click();
  let dialog = page.locator('dialog');
  await expect(dialog.getByLabel('Notes')).toHaveValue('chapter 2 is the one');
  await dialog.getByLabel('Status').selectOption({ label: 'Finished' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.book-row', { hasText: 'Mythical' })).toContainText('Finished');

  await page.getByRole('button', { name: 'Edit The Mythical Man-Month' }).click();
  dialog = page.locator('dialog');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.book-row')).toHaveCount(0);
});

test('there is no file import and no reader left to open', async ({ page }) => {
  await page.goto('/#/reading');
  await addBook(page, { title: 'On paper' });
  await expect(page.locator('#view')).not.toContainText('Import');
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.locator('#view').getByRole('link', { name: 'Open' })).toHaveCount(0);
});
