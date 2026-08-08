import { test, expect } from '@playwright/test';

// Pasting a plan from a chat and turning it into threads. The cases that
// matter are the refusals: a stage must never go missing, and a thread must
// never be silently duplicated.

const OUTLINE = `# Compiler project (project)

## Lexer
> every token type has a passing test and the fuzzer runs clean
### Numbers
- Integer literals @45m
- Float literals ^2026-12-01
### Strings
- Escapes

## Parser
> the grammar round-trips every fixture in tests/fixtures
### Expressions
- Precedence climbing @2h
- Unary operators

## Type checker
> every fixture type-checks and errors name the offending span
### Inference
- Hindley-Milner core
`;

async function paste(page, text) {
  await page.goto('/#/threads');
  await page.getByRole('button', { name: 'Import outline' }).click();
  await page.locator('dialog textarea').fill(text);
  // The preview is debounced.
  await page.waitForTimeout(400);
}

test('a pasted outline previews accurately and imports every stage', async ({ page }) => {
  await paste(page, OUTLINE);

  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('1 thread');
  await expect(dialog).toContainText('3 stages');
  await expect(dialog).toContainText('4 steps');
  await expect(dialog).toContainText('6 tasks');
  await expect(dialog).toContainText('new thread');

  // Each stage is listed with its done-when before anything is written.
  await expect(dialog).toContainText('Lexer');
  await expect(dialog).toContainText('Parser');
  await expect(dialog).toContainText('Type checker');
  await expect(dialog).toContainText('the grammar round-trips every fixture');

  await dialog.getByRole('button', { name: 'Import', exact: true }).click();

  // Lands on the thread, with all three stages and correct lock states.
  await expect(page.getByRole('heading', { name: 'Compiler project', level: 1 })).toBeVisible();
  const stages = page.locator('.stage');
  await expect(stages).toHaveCount(3);
  await expect(stages.nth(0)).toHaveAttribute('data-state', 'available');
  await expect(stages.nth(1)).toHaveAttribute('data-state', 'locked');
  await expect(stages.nth(2)).toHaveAttribute('data-state', 'locked');

  // Tasks, estimates and due dates survived.
  await expect(page.locator('.task')).toHaveCount(6);
  await expect(page.locator('.task', { hasText: 'Integer literals' })).toContainText('45m');
  await expect(page.locator('.task', { hasText: 'Float literals' })).toContainText('1 Dec');

  // And the whole import is one undoable step.
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.goto('/#/threads');
  await expect(page.getByText('No threads yet')).toBeVisible();
});

test('a missing done-when blocks the import and names the stage', async ({ page }) => {
  await paste(page, `# Thread
## Good stage
> this one is fine
### Step
- a task
## Bad stage
### Step
- another task
`);

  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('nothing will be imported');
  await expect(dialog).toContainText('"Bad stage" has no done-when');
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
});

test('an unparseable line blocks the import and quotes it', async ({ page }) => {
  await paste(page, `# Thread
## Stage
> done when
### Step
- a task
Here is some commentary the model added.
`);

  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('does not match the outline format');
  await expect(dialog).toContainText('line 6');
  await expect(dialog).toContainText('Here is some commentary the model added.');
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
});

test('fixing the error in the box re-enables the import', async ({ page }) => {
  await paste(page, `# Thread\n## Stage\n### Step\n- a task\n`);
  const dialog = page.locator('dialog');
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();

  await dialog.locator('textarea').fill(`# Thread\n## Stage\n> now it has one\n### Step\n- a task\n`);
  await page.waitForTimeout(400);
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  await expect(dialog).toContainText('1 thread');
});

test('an existing thread name appends rather than creating a duplicate', async ({ page }) => {
  await paste(page, OUTLINE);
  await page.locator('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('.stage')).toHaveCount(3);

  // Import a second outline using the same thread name.
  await paste(page, `# Compiler project
## Codegen
> hello world compiles and runs
### Emit
- Stack machine
`);
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('adds to the existing thread');
  await expect(dialog).toContainText('already exists');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();

  // One thread, four stages — not two threads called the same thing.
  await page.goto('/#/threads');
  await expect(page.locator('.card')).toHaveCount(1);
  await page.locator('.card').getByRole('link', { name: 'Open' }).click();
  await expect(page.locator('.stage')).toHaveCount(4);
  await expect(page.locator('.stage').nth(3)).toContainText('Codegen');
});

test('a stage title the thread already has is flagged before importing', async ({ page }) => {
  await paste(page, OUTLINE);
  await page.locator('dialog').getByRole('button', { name: 'Import', exact: true }).click();

  await paste(page, `# Compiler project
## Lexer
> a second stage with the same name
### Step
- a task
`);
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('Stage titles that already exist');
  await expect(dialog).toContainText('two stages with each of those names');
  // Allowed, but only with eyes open.
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
});

test('tasks written under a stage are kept, and the invented step is reported', async ({ page }) => {
  await paste(page, `# Thread
## Stage
> done when this is done
- first task
- second task
`);
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('a step called "Tasks" was created');
  await expect(dialog).toContainText('2 tasks');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('.task')).toHaveCount(2);
  await expect(page.locator('.step')).toContainText('Tasks');
});

test('a chat answer wrapped in a code fence still parses', async ({ page }) => {
  await paste(page, '```markdown\n# Thread\n## Stage\n> done when\n### Step\n- a task\n```');
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('1 thread');
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
});

test('the example button fills a valid outline', async ({ page }) => {
  await page.goto('/#/threads');
  await page.getByRole('button', { name: 'Import outline' }).click();
  await page.getByRole('button', { name: 'Show me an example' }).click();
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('2 stages');
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
});

test('import is disabled until something is pasted', async ({ page }) => {
  await page.goto('/#/threads');
  await page.getByRole('button', { name: 'Import outline' }).click();
  await expect(page.locator('dialog').getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await expect(page.locator('dialog')).toContainText('Nothing pasted yet');
});
