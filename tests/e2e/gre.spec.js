import { test, expect } from '@playwright/test';

// The GRE view. The flows that matter: the day shows the blocks due in order
// with A pinned, the fourth field is genuinely mandatory, re-attempts stay cold
// until a result is recorded, and the audit counts the thing the whole log is
// for — a portable move firing on a problem it was not written for.

async function setUpSchedule(page) {
  await page.goto('/#/gre');
  await page.getByRole('button', { name: 'Set up the schedule' }).click();
  const dialog = page.locator('dialog');
  await dialog.getByRole('button', { name: 'Show me the format' }).click();
  await page.waitForTimeout(400);
  await dialog.getByRole('button', { name: 'Import the schedule' }).click();
  await expect(page.locator('#view')).toContainText('Day');
}

/** Point the app at a schedule whose dates surround today. */
async function scheduleAroundToday(page) {
  await page.goto('/#/gre');
  await page.getByRole('button', { name: 'Set up the schedule' }).click();
  const dialog = page.locator('dialog');

  const text = await page.evaluate(() => {
    const iso = (offset) => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    return [
      '# Phases',
      '1. Foundations | module 12 by day 14',
      '2. Consolidation | module 24 by day 30',
      '# Days',
      `Day 1 | ${iso(-4)} | phase 1 | B, C, E1, E2, F | C: ratios | E2: text completion`,
      `Day 2 | ${iso(-3)} | phase 1 | B, C, E1, E2, F | C: percent change | E2: sentence equivalence`,
      `Day 3 | ${iso(-2)} | phase 1 | B, C, E1, E2, F | C: exponents | E2: reading comprehension`,
      `Day 4 | ${iso(-1)} | phase 1 | A, B, C, E1, E2, F | C: linear equations | E2: text completion | module 6`,
      `Day 5 | ${iso(0)} | phase 1 | A, B, C, D, E1, E2, F | C: word problems | E2: paired blanks`,
      `Day 6 | ${iso(1)} | phase 1 | checkpoint: timed quant section`,
      `Day 20 | ${iso(15)} | phase 2 | A, B, C, E1, E2, F | C: geometry | E2: reading comprehension`,
    ].join('\n');
  });

  await dialog.locator('textarea').fill(text);
  await page.waitForTimeout(400);
  await dialog.getByRole('button', { name: 'Import the schedule' }).click();
  await expect(page.locator('.gre-block')).not.toHaveCount(0);
}

async function logProblem(page, { portable, correct = false, cause = 'concept', source = 'OG2 Q47', applied = null }) {
  await page.getByRole('button', { name: 'Log a problem' }).first().click();
  const dialog = page.locator('dialog');
  await dialog.getByLabel('Problem ID or source').fill(source);
  await dialog.getByLabel('1. What it gave and what it asked').fill('a ratio of two mixtures, asked for the final concentration');
  await dialog.getByLabel('2. What you did').fill('set up a weighted average and dropped a denominator');
  await dialog.getByLabel('3. Where it broke — or the faster route').fill('the second denominator');
  if (portable !== undefined) await dialog.getByLabel('4. The portable move').fill(portable);
  if (correct) await dialog.getByLabel('I got it right').check();
  await dialog.getByLabel('Cause').selectOption(cause);
  if (applied) await dialog.getByLabel('A previous portable move applied here').selectOption({ index: applied });
  await dialog.getByRole('button', { name: 'Log it' }).click();
  return dialog;
}

// --- the day ----------------------------------------------------------------

test('the day shows the blocks due, in order, with the retrieval block pinned first', async ({ page }) => {
  await scheduleAroundToday(page);

  const codes = await page.locator('.gre-block__code').allTextContents();
  expect(codes[0]).toBe('A');
  expect(codes).toEqual(['A', 'B', 'C', 'D', 'E1', 'E2', 'F']);
  await expect(page.locator('.gre-block[data-code="A"]')).toContainText('first');
  await expect(page.locator('.gre-block[data-code="E1"]')).toContainText('every day');
});

test('blocks C and E2 show the topic assigned for today, not a generic label', async ({ page }) => {
  await scheduleAroundToday(page);
  await expect(page.locator('.gre-block[data-code="C"] .gre-topic')).toHaveText('word problems');
  await expect(page.locator('.gre-block[data-code="E2"] .gre-topic')).toHaveText('paired blanks');
  await expect(page.locator('.gre-block[data-code="B"] .gre-topic')).toHaveCount(0);
});

test('a block can be marked done, and the day tracks it', async ({ page }) => {
  await scheduleAroundToday(page);
  await expect(page.locator('.stat', { hasText: 'blocks done' })).toContainText('0/7');

  await page.getByRole('button', { name: /^Mark E1/ }).click();
  await expect(page.locator('.gre-block[data-code="E1"]')).toHaveAttribute('data-done', 'true');
  await expect(page.locator('.stat', { hasText: 'blocks done' })).toContainText('1/7');

  // And it survives a reload.
  await page.reload();
  await expect(page.locator('.gre-block[data-code="E1"]')).toHaveAttribute('data-done', 'true');
});

test('the vocab streak counts the days it was done, and the countdown runs', async ({ page }) => {
  await scheduleAroundToday(page);
  await expect(page.locator('.stat', { hasText: 'streak' })).toBeVisible();
  await expect(page.locator('.stat', { hasText: 'days left' })).toBeVisible();
  await expect(page.locator('#view')).toContainText('the one that breaks if it is skipped');

  await page.getByRole('button', { name: /^Mark E1/ }).click();
  await expect(page.locator('.stat', { hasText: 'streak' })).toContainText('1');
});

test('a gate that has not been reached by its day is flagged, not softened', async ({ page }) => {
  await scheduleAroundToday(page);
  // Day 4 recorded module 6, and the gate wants 12 by day 14 — still open.
  await expect(page.locator('#view')).toContainText('module 12 by day 14');
  await expect(page.locator('#view')).toContainText('Reached module 6 of 12');
  await expect(page.locator('#view')).not.toContainText('missed its gate');
});

test('the schedule page lists the days, phases and blocks that were pasted in', async ({ page }) => {
  await setUpSchedule(page);
  await page.goto('/#/gre/schedule');

  await expect(page.locator('tbody tr')).toHaveCount(7);
  await expect(page.locator('tr[data-day="14"]')).toContainText('checkpoint');
  await expect(page.locator('#view')).toContainText('Foundations');
  await expect(page.locator('#view')).toContainText('module 12 by day 14');
  await expect(page.locator('#view')).toContainText('ratios and proportions');
});

test('the schedule importer reports lines it could not read', async ({ page }) => {
  await page.goto('/#/gre');
  await page.getByRole('button', { name: 'Set up the schedule' }).click();
  const dialog = page.locator('dialog');
  await dialog.locator('textarea').fill(`# Days
Day 1 | 2026-09-01 | B, E1
I should probably move the checkpoint back a week.
`);
  await page.waitForTimeout(400);
  await expect(dialog).toContainText('1 line(s) could not be read');
  await expect(dialog).toContainText('line 3');
  await expect(dialog).toContainText('move the checkpoint back a week');
});

// --- the problem log --------------------------------------------------------

test('an entry without the portable move is refused, with an explanation', async ({ page }) => {
  await page.goto('/#/gre/log');
  const dialog = await logProblem(page, { portable: '' });

  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('the extraction did not happen');
  await expect(dialog).toContainText('check units before choosing the answer');
  await expect(page.locator('.gre-entry')).toHaveCount(0);

  await dialog.getByLabel('4. The portable move').fill('check every denominator survives');
  await dialog.getByRole('button', { name: 'Log it' }).click();
  await expect(page.locator('.gre-entry')).toHaveCount(1);
  await expect(page.locator('.portable')).toHaveText('check every denominator survives');
});

test('the form says what a portable move is, with a good and a bad example', async ({ page }) => {
  await page.goto('/#/gre/log');
  await page.getByRole('button', { name: 'Log a problem' }).first().click();
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('A rule about problems in general, not about this one');
  await expect(dialog).toContainText('Good: "check units before choosing the answer"');
  await expect(dialog).toContainText('Bad: "remember that this triangle was isosceles"');
});

test('correct answers are logged too, and read differently from misses', async ({ page }) => {
  await page.goto('/#/gre/log');
  await logProblem(page, { portable: 'read the question before the stem', correct: true, cause: 'timing', source: 'OG2 Q10' });
  await logProblem(page, { portable: 'check every denominator survives', correct: false, source: 'OG2 Q47' });

  await expect(page.locator('.gre-entry[data-correct="true"]')).toHaveCount(1);
  await expect(page.locator('.gre-entry[data-correct="false"]')).toHaveCount(1);
  await expect(page.locator('.gre-entry[data-correct="true"]')).toContainText('correct');
  await expect(page.locator('#view')).toContainText('A right answer reached the slow way');
});

// --- retrieval --------------------------------------------------------------

test('a re-attempt stays cold until a result is recorded', async ({ page }) => {
  await page.goto('/#/gre/log');
  await logProblem(page, { portable: 'check every denominator survives' });

  // Bring it forward to today so it is due.
  await page.evaluate(() => {
    window.cairn.store.mutate('due now', (state) => {
      state.greEntries[0].dueDate = state.greEntries[0].date;
    });
    window.cairn.render();
  });

  await page.goto('/#/gre/retrieval');
  const card = page.locator('.retrieval');
  await expect(card).toHaveAttribute('data-revealed', 'false');
  await expect(card).toContainText('OG2 Q47');
  await expect(card).toContainText('recognition, not retrieval');
  // The notes are not on the page at all until a result is in.
  await expect(card).not.toContainText('check every denominator survives');
  await expect(card).not.toContainText('a ratio of two mixtures');

  await card.getByRole('button', { name: /^Record a correct re-attempt/ }).click();
  await expect(page.locator('.retrieval')).toHaveAttribute('data-revealed', 'true');
  await expect(page.locator('.retrieval')).toContainText('check every denominator survives');
});

test('a failed re-attempt resets the chain and a clean one at the end retires it', async ({ page }) => {
  await page.goto('/#/gre/log');
  await logProblem(page, { portable: 'check every denominator survives' });

  const dueNow = () => page.evaluate(() => {
    window.cairn.store.mutate('due now', (state) => {
      state.greEntries[0].dueDate = state.greEntries[0].date;
    });
    window.cairn.render();
  });

  await dueNow();
  await page.goto('/#/gre/retrieval');
  await page.getByRole('button', { name: /^Record a failed re-attempt/ }).click();
  await expect(page.getByText('Back to the start of the chain')).toBeVisible();

  const after = await page.evaluate(() => {
    const entry = window.cairn.store.state.greEntries[0];
    return { index: entry.intervalIndex, attempts: entry.attempts.length, retired: entry.retired };
  });
  expect(after).toEqual({ index: 0, attempts: 1, retired: false });

  // A day later, at the far end of the chain, a clean re-attempt retires it.
  await page.evaluate(() => {
    window.cairn.store.mutate('another day', (state) => {
      const entry = state.greEntries[0];
      entry.intervalIndex = 1;
      entry.attempts = [];
      entry.dueDate = entry.date;
    });
    window.cairn.render();
  });
  await page.goto('/#/gre/retrieval');
  await page.getByRole('button', { name: /^Record a correct re-attempt/ }).click();
  await expect(page.getByText('Retrieved clean at the last interval')).toBeVisible();

  await page.goto('/#/gre/log');
  await expect(page.locator('.gre-entry')).toContainText('retrieved clean');
});

test('the sidebar shows what is due for retrieval', async ({ page }) => {
  await page.goto('/#/gre/log');
  await logProblem(page, { portable: 'check every denominator survives' });
  await page.evaluate(() => {
    window.cairn.store.mutate('due now', (state) => {
      state.greEntries[0].dueDate = state.greEntries[0].date;
    });
    window.cairn.render();
  });
  await expect(page.locator('.nav__badge').first()).toBeVisible();
  await expect(page.locator('#sidebar')).toContainText('GRE');
});

// --- the audit --------------------------------------------------------------

test('the audit leads with portable moves that fired on a later problem', async ({ page }) => {
  await scheduleAroundToday(page);
  await page.goto('/#/gre/log');

  await logProblem(page, { portable: 'check every denominator survives', source: 'OG2 Q47' });
  await logProblem(page, {
    portable: 'name the unknown before solving',
    source: 'OG2 Q88',
    applied: 1,
  });

  await page.goto('/#/gre/audit');
  await expect(page.locator('#view')).toContainText('Portable moves that fired again');
  await expect(page.locator('.stat', { hasText: 'fired on a later problem' })).toContainText('1');
  await expect(page.locator('#view')).toContainText('This is the output of the whole log');
  await expect(page.locator('#view')).toContainText('check every denominator survives');
});

test('the cause breakdown is per phase, and counts misses rather than everything', async ({ page }) => {
  await scheduleAroundToday(page);
  await page.goto('/#/gre/log');

  await logProblem(page, { portable: 'a', cause: 'concept', source: 'q1' });
  await logProblem(page, { portable: 'b', cause: 'careless', source: 'q2' });
  await logProblem(page, { portable: 'c', cause: 'timing', correct: true, source: 'q3' });

  await page.goto('/#/gre/audit');
  await expect(page.locator('#view')).toContainText('Why problems were missed');
  await expect(page.locator('#view')).toContainText('Foundations');
  await expect(page.locator('#view')).toContainText('3 logged');
  await expect(page.locator('#view')).toContainText('2 missed');
  await expect(page.locator('#view')).toContainText('50% concept');
  await expect(page.locator('.causebar__part--concept')).toBeVisible();
});

test('with nothing logged, the audit says what it would be measuring', async ({ page }) => {
  await page.goto('/#/gre/audit');
  await expect(page.locator('#view')).toContainText('are concept gaps falling');
  await expect(page.locator('#view')).toContainText('problems they were not written for');
});

test('with no schedule, the GRE view explains why the plan is not in the app', async ({ page }) => {
  await page.goto('/#/gre');
  await expect(page.locator('#view')).toContainText('No schedule yet');
  await expect(page.locator('#view')).toContainText('lives in your data rather than in the app');
});
