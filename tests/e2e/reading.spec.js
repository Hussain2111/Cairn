import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Importing a PDF, reading it, and the honest bits: where the bytes actually
// live, what an export does and does not carry, and what happens when the file
// is not on this device.

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const DESCRIBED = join(fixtures, 'described.pdf');
const BARE = join(fixtures, 'Kent Beck - Test Driven Development.pdf');

async function importPdf(page, file) {
  await page.goto('/#/reading');
  await page.locator('#reading-file').setInputFiles(file);
  const dialog = page.locator('dialog');
  await expect(dialog).toBeVisible({ timeout: 20000 });
  return dialog;
}

test('a PDF is imported using the title and author inside it', async ({ page }) => {
  const dialog = await importPdf(page, DESCRIBED);

  await expect(dialog.locator('.input').first()).toHaveValue('The Rings of Saturn');
  await expect(dialog.locator('.input').nth(1)).toHaveValue('W G Sebald');
  await expect(dialog).toContainText('Read from the PDF.');
  await dialog.getByRole('button', { name: 'Add it' }).click();

  // Opens straight into the reader, at the first page.
  await expect(page.locator('.reader__canvas')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.reader__status')).toContainText('page 1 of 4');
  await expect(page.locator('.reader__bar')).toContainText('The Rings of Saturn');
});

test('a PDF with no metadata falls back to the filename and says it guessed', async ({ page }) => {
  const dialog = await importPdf(page, BARE);

  await expect(dialog.locator('.input').first()).toHaveValue('Test Driven Development');
  await expect(dialog.locator('.input').nth(1)).toHaveValue('Kent Beck');
  await expect(dialog).toContainText('came from the filename');

  // And it can be corrected before anything is written.
  await dialog.locator('.input').first().fill('TDD by Example');
  await dialog.getByRole('button', { name: 'Add it' }).click();

  await expect(page.locator('.reader__canvas')).toBeVisible({ timeout: 20000 });
  await page.goto('/#/reading');
  await expect(page.locator('.book__title')).toContainText('TDD by Example');
});

test('the shelf shows covers rendered from the first page', async ({ page }) => {
  const dialog = await importPdf(page, DESCRIBED);
  await dialog.getByRole('button', { name: 'Add it' }).click();
  // Importing lands in the reader, so wait for that before going back — or the
  // shelf is torn down again the moment it appears.
  await expect(page.locator('.reader__canvas')).toBeVisible({ timeout: 20000 });
  await page.goto('/#/reading');

  // An actual image, drawn from page one — not the placeholder.
  const cover = page.locator('img.book__cover');
  await expect(cover).toBeVisible();
  await expect(cover).toHaveAttribute('src', /^data:image\/jpeg/);
  await expect(page.locator('.book__cover--blank')).toHaveCount(0);
});

test('the position is saved and the book reopens where it was left', async ({ page }) => {
  const dialog = await importPdf(page, DESCRIBED);
  await dialog.getByRole('button', { name: 'Add it' }).click();
  await expect(page.locator('.reader__canvas')).toBeVisible({ timeout: 20000 });

  await page.getByRole('button', { name: 'Next page' }).click();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('.reader__status')).toContainText('page 3 of 4');

  // Leave, come back — and after a full reload, not just a re-render.
  await page.goto('/#/reading');
  await expect(page.locator('.book')).toContainText('3 / 4');
  await page.reload();
  await page.locator('.book').click();
  await expect(page.locator('.reader__status')).toContainText('page 3 of 4', { timeout: 20000 });
});

test('a page can be jumped to, and cannot leave the book', async ({ page }) => {
  const dialog = await importPdf(page, DESCRIBED);
  await dialog.getByRole('button', { name: 'Add it' }).click();
  await expect(page.locator('.reader__canvas')).toBeVisible({ timeout: 20000 });

  await page.getByLabel('Page number').fill('4');
  await page.getByLabel('Page number').press('Enter');
  await expect(page.locator('.reader__status')).toContainText('page 4 of 4');

  // Past the end clamps rather than erroring.
  await page.getByLabel('Page number').fill('99');
  await page.getByLabel('Page number').press('Enter');
  await expect(page.locator('.reader__status')).toContainText('page 4 of 4');

  await page.getByLabel('Page number').fill('0');
  await page.getByLabel('Page number').press('Enter');
  await expect(page.locator('.reader__status')).toContainText('page 1 of 4');
});

test('reaching the last page marks the book finished', async ({ page }) => {
  const dialog = await importPdf(page, DESCRIBED);
  await dialog.getByRole('button', { name: 'Add it' }).click();
  await expect(page.locator('.reader__canvas')).toBeVisible({ timeout: 20000 });

  await page.getByLabel('Page number').fill('4');
  await page.getByLabel('Page number').press('Enter');
  await expect(page.locator('.reader__status')).toContainText('page 4 of 4');

  await page.goto('/#/reading');
  await expect(page.locator('.book')).toHaveAttribute('data-status', 'finished');
});

test('a page can be bookmarked with a note, and the note jumps back to it', async ({ page }) => {
  const dialog = await importPdf(page, DESCRIBED);
  await dialog.getByRole('button', { name: 'Add it' }).click();
  await expect(page.locator('.reader__canvas')).toBeVisible({ timeout: 20000 });

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('.reader__status')).toContainText('page 2 of 4');

  await page.getByRole('button', { name: 'Bookmark', exact: true }).click();
  await page.locator('dialog').getByLabel('Bookmark note').fill('the herring passage');
  await page.locator('dialog').getByRole('button', { name: 'Mark it' }).click();
  await expect(page.getByRole('button', { name: '★ Bookmarked' })).toBeVisible();

  // Move away, then come back through the bookmark list.
  await page.getByLabel('Page number').fill('4');
  await page.getByLabel('Page number').press('Enter');
  await page.getByRole('button', { name: 'Bookmarks' }).click();
  await expect(page.locator('.reader__marks')).toContainText('the herring passage');
  await page.getByRole('button', { name: 'Go to page 2' }).click();
  await expect(page.locator('.reader__status')).toContainText('page 2 of 4');

  // Bookmarks survive a reload, because they live with the record.
  await page.reload();
  await page.getByRole('button', { name: 'Bookmarks' }).click();
  await expect(page.locator('.reader__marks')).toContainText('the herring passage');
});

test('a bookmark can be removed from the page it is on', async ({ page }) => {
  const dialog = await importPdf(page, DESCRIBED);
  await dialog.getByRole('button', { name: 'Add it' }).click();
  await expect(page.locator('.reader__canvas')).toBeVisible({ timeout: 20000 });

  await page.getByRole('button', { name: 'Bookmark', exact: true }).click();
  await page.locator('dialog').getByRole('button', { name: 'Mark it' }).click();
  await expect(page.getByRole('button', { name: '★ Bookmarked' })).toBeVisible();

  await page.getByRole('button', { name: '★ Bookmarked' }).click();
  await expect(page.getByRole('button', { name: 'Bookmark', exact: true })).toBeVisible();
});

test('the export carries the shelf and the bookmarks, but not the file — and says so', async ({ page }) => {
  const dialog = await importPdf(page, DESCRIBED);
  await dialog.getByRole('button', { name: 'Add it' }).click();
  await expect(page.locator('.reader__canvas')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.getByRole('button', { name: 'Bookmark', exact: true }).click();
  await page.locator('dialog').getByLabel('Bookmark note').fill('worth coming back to');
  await page.locator('dialog').getByRole('button', { name: 'Mark it' }).click();

  const exported = await page.evaluate(() => JSON.parse(window.cairn.store.exportJSON()));
  const [book] = exported.reading;

  expect(book.title).toBe('The Rings of Saturn');
  expect(book.position).toBe(2);
  expect(book.bookmarks).toHaveLength(1);
  expect(book.pageCount).toBe(4);
  // The bytes are not in it, and nothing pretends otherwise.
  expect(JSON.stringify(exported).includes('%PDF')).toBe(false);
  expect(book.fileSize).toBeGreaterThan(0);

  // Both places the user might look say it plainly.
  await page.goto('/#/reading');
  await expect(page.locator('#view')).toContainText('not included in Settings › Export JSON');
  await page.goto('/#/settings');
  await expect(page.locator('#view')).toContainText('does not include the 1 book file');
});

test('a record whose file is gone keeps the place and offers to reattach', async ({ page }) => {
  const dialog = await importPdf(page, DESCRIBED);
  await dialog.getByRole('button', { name: 'Add it' }).click();
  await expect(page.locator('.reader__canvas')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('.reader__status')).toContainText('page 2 of 4');

  // Delete the file, keep everything else.
  await page.getByRole('button', { name: 'Details' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Delete the file only' }).click();

  await expect(page.locator('#view')).toContainText('no file on this device');
  await page.locator('.book').click();
  await expect(page.locator('#view')).toContainText('Import the same PDF again');

  // Reattaching restores the reader, still on page 2.
  await page.locator('input[aria-label="Choose the file again"]').setInputFiles(DESCRIBED);
  await expect(page.locator('.reader__canvas')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.reader__status')).toContainText('page 2 of 4');
});

test('a book with no file at all can still be tracked by hand', async ({ page }) => {
  await page.goto('/#/reading');
  await page.getByRole('button', { name: 'Track without a file' }).click();
  const dialog = page.locator('dialog');
  await dialog.locator('.input').first().fill('A paper book');
  await dialog.locator('input[type="number"]').first().fill('40');
  await dialog.locator('input[type="number"]').nth(1).fill('200');
  await dialog.getByRole('button', { name: 'Add' }).click();

  await expect(page.locator('.book')).toContainText('A paper book');
  await expect(page.locator('.book')).toContainText('40 / 200');
  await page.locator('.book').click();
  await expect(page.locator('#view')).toContainText('tracked by hand');
  await expect(page.locator('.reader__canvas')).toHaveCount(0);
});

test('removing a book takes its file with it', async ({ page }) => {
  const dialog = await importPdf(page, DESCRIBED);
  await dialog.getByRole('button', { name: 'Add it' }).click();
  await expect(page.locator('.reader__canvas')).toBeVisible({ timeout: 20000 });

  await page.getByRole('button', { name: 'Details' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Remove everything' }).click();

  await expect(page.locator('#view')).toContainText('Nothing on the shelf');
  const files = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('cairn.books', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve) => {
      const count = db.transaction('files', 'readonly').objectStore('files').count();
      count.onsuccess = () => resolve(count.result);
    });
  });
  expect(files).toBe(0);
});
