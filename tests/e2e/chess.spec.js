import { test, expect } from '@playwright/test';

// The chess log. One field is mandatory, and the page that collects it is the
// reason the rest exists.

async function logGame(page, { result = 'win', colour = 'white', lesson, opening = '', rating = '' }) {
  await page.getByRole('button', { name: 'Log a game' }).first().click();
  const dialog = page.locator('dialog');
  await dialog.locator('select').nth(0).selectOption(colour);
  await dialog.locator('select').nth(1).selectOption(result);
  if (rating) await dialog.locator('input[type="number"]').fill(rating);
  if (opening) await dialog.locator('.input').nth(3).fill(opening);
  if (lesson !== undefined) await dialog.locator('textarea').fill(lesson);
  await dialog.getByRole('button', { name: 'Log it' }).click();
  return dialog;
}

test('a game cannot be logged without saying what went wrong', async ({ page }) => {
  await page.goto('/#/chess');
  const dialog = await logGame(page, { lesson: '' });

  // Still open, and it says why rather than just "required".
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('a game logged without it is not logged');
  await expect(page.locator('.game')).toHaveCount(0);

  await dialog.locator('textarea').fill('traded into a lost endgame a pawn down');
  await dialog.getByRole('button', { name: 'Log it' }).click();
  await expect(page.locator('.game')).toHaveCount(1);
  await expect(page.locator('.game')).toContainText('traded into a lost endgame a pawn down');
});

test('a logged game shows its result, colour and opening', async ({ page }) => {
  await page.goto('/#/chess');
  await logGame(page, {
    result: 'loss',
    colour: 'black',
    opening: 'Caro-Kann, advance',
    rating: '1480',
    lesson: 'hung a knight on move 14',
  });

  const game = page.locator('.game');
  await expect(game).toHaveAttribute('data-result', 'loss');
  await expect(game).toContainText('as black');
  await expect(game).toContainText('Caro-Kann, advance');
  await expect(game).toContainText('vs 1480');
  await expect(page.locator('.stat', { hasText: 'average opponent' })).toContainText('1480');
});

test('the score counts a draw as half a point', async ({ page }) => {
  await page.goto('/#/chess');
  await logGame(page, { result: 'win', lesson: 'a' });
  await logGame(page, { result: 'loss', lesson: 'b' });
  await logGame(page, { result: 'draw', lesson: 'c' });
  await logGame(page, { result: 'draw', lesson: 'd' });

  await expect(page.locator('.stat', { hasText: 'games' })).toContainText('4');
  await expect(page.locator('.stat', { hasText: 'score' })).toContainText('50%');
  await expect(page.locator('.stat', { hasText: '(W-D-L)' })).toContainText('1-2-1');
});

test('the lessons page collects every line and surfaces what repeats', async ({ page }) => {
  await page.goto('/#/chess');
  await logGame(page, { result: 'loss', lesson: 'hung a knight after a careless trade' });
  await logGame(page, { result: 'loss', lesson: 'hung a knight again in time trouble' });
  await logGame(page, { result: 'win', lesson: 'converted a clean rook endgame' });

  await page.getByRole('link', { name: 'Lessons' }).click();
  await expect(page.getByRole('heading', { name: 'Lessons', level: 1 })).toBeVisible();
  await expect(page.locator('#view')).toContainText('3 lines');

  // "knight" turns up in two separate games, so it is a theme.
  await expect(page.locator('#view')).toContainText('What keeps coming up');
  await page.getByRole('link', { name: 'knight 2' }).click();

  await expect(page.locator('.card', { hasText: 'hung a knight' })).toHaveCount(2);
  await expect(page.locator('#view')).not.toContainText('converted a clean rook endgame');

  await page.getByRole('link', { name: 'Clear' }).click();
  await expect(page.locator('#view')).toContainText('converted a clean rook endgame');
});

test('a game can be edited from the lessons page', async ({ page }) => {
  await page.goto('/#/chess');
  await logGame(page, { lesson: 'drifted' });

  await page.getByRole('link', { name: 'Lessons' }).click();
  await page.getByRole('button', { name: /^Edit the game/ }).click();
  await page.locator('dialog').locator('textarea').fill('drifted in a level endgame instead of making a plan');
  await page.locator('dialog').getByRole('button', { name: 'Save' }).click();

  await expect(page.locator('#view')).toContainText('instead of making a plan');
});

test('clearing the lesson on an existing game is refused too', async ({ page }) => {
  await page.goto('/#/chess');
  await logGame(page, { lesson: 'something' });

  await page.getByRole('button', { name: /^Edit the game/ }).click();
  const dialog = page.locator('dialog');
  await dialog.locator('textarea').fill('   ');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('a game logged without it is not logged');
});

test('a game can be deleted', async ({ page }) => {
  await page.goto('/#/chess');
  await logGame(page, { lesson: 'a mistake worth remembering' });
  await expect(page.locator('.game')).toHaveCount(1);

  await page.getByRole('button', { name: /^Edit the game/ }).click();
  await page.locator('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Delete' }).click();

  await expect(page.locator('.game')).toHaveCount(0);
  await expect(page.locator('#view')).toContainText('No games logged');
});

test('with nothing logged, both pages explain what they are for', async ({ page }) => {
  await page.goto('/#/chess');
  await expect(page.locator('#view')).toContainText('the clusters are the study list');

  await page.goto('/#/chess/lessons');
  await expect(page.locator('#view')).toContainText('No lessons yet');
});
