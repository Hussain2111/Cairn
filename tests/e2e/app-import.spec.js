import { test, expect } from '@playwright/test';
import { zipSync, strToU8 } from '../../vendor/fflate/fflate.mjs';

// Importing applications from a spreadsheet.
//
// The flow that matters is the same one the outline importer has: read the
// file, propose a mapping, let every guess be corrected, show what will be
// created, and only then write. Nothing may be dropped without appearing in
// the preview first.

const CSV = `Company Name,Position,Date Applied,Status,Where I found it,Notes
Acme,"Backend Engineer, Platform",2026-08-04,Applied,LinkedIn,referred by Jane
Globex,Data Analyst,2026-07-30,Phone screen,Hiring Cafe,
Initech,,2026-07-01,Rejected,,no role on the listing
,,,,,
,,2026-07-15,Applied,LinkedIn,a row with a note but no company or role
Umbrella,SRE,03/04/2026,ghosted,Otta,ambiguous date on purpose
`;

async function openImport(page) {
  await page.goto('/#/pipelines');
  await page.getByRole('button', { name: 'Import spreadsheet' }).click();
  return page.locator('dialog');
}

async function attach(page, { name, mimeType, buffer }) {
  await page.locator('dialog input[type="file"]').setInputFiles({ name, mimeType, buffer });
}

const csvFile = (text = CSV) => ({
  name: 'applications.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(text, 'utf8'),
});

test('a CSV is read, mapped and previewed before anything is written', async ({ page }) => {
  const dialog = await openImport(page);
  await attach(page, csvFile());

  await expect(dialog).toContainText('5 row(s) read');
  await expect(dialog).toContainText('4 to create');

  // The guessed mapping is shown per field, and the loose ones say they are guesses.
  await expect(dialog.locator('.map-row[data-field="company"] select')).toHaveValue(/\d/);
  await expect(dialog.locator('.map-row[data-field="role"]')).toContainText('Role');

  // The preview is the record, row by row.
  const rows = dialog.locator('tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Acme');
  await expect(rows.nth(0)).toContainText('Backend Engineer, Platform');
  await expect(rows.nth(1)).toContainText('screening');

  // Nothing exists yet.
  expect(await page.evaluate(() => window.cairn.store.state.applications.length)).toBe(0);

  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.locator('#view')).toContainText('Acme');
  expect(await page.evaluate(() => window.cairn.store.state.applications.length)).toBe(4);
});

test('every row it could not use is reported by line number and content', async ({ page }) => {
  const dialog = await openImport(page);
  await attach(page, csvFile());

  await expect(dialog).toContainText('1 unusable');
  const problems = dialog.locator('.unparsed');
  // The wholly blank line 5 is formatting, not a row. Line 6 has content and
  // nothing to identify it by, so it is named and its text is shown.
  await expect(problems).toContainText('line 6');
  await expect(problems).toContainText('neither a company nor a role');
  await expect(problems).toContainText('a row with a note but no company or role');

  // The ambiguous date is a repair, not a loss: the row still arrives.
  await expect(problems).toContainText('day/month or month/day');
  await expect(dialog.locator('tbody tr')).toContainText(['Acme', 'Globex', 'Initech', 'Umbrella']);
});

test('a guessed column can be corrected, and the preview follows', async ({ page }) => {
  const dialog = await openImport(page);
  await attach(page, csvFile());
  await expect(dialog.locator('tbody tr').nth(0)).toContainText('Backend Engineer, Platform');

  // Point "Role" at the notes column instead and the preview changes with it.
  const notesIndex = await dialog.locator('.map-row[data-field="notes"] select').inputValue();
  await dialog.locator('.map-row[data-field="role"] select').selectOption(notesIndex);
  await expect(dialog.locator('tbody tr').nth(0)).toContainText('referred by Jane');
});

test('the import is blocked until company and role are mapped', async ({ page }) => {
  const dialog = await openImport(page);
  await attach(page, csvFile('Thing,Other\nfoo,bar\n'));

  await expect(dialog).toContainText('Company and Role');
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();

  await dialog.locator('.map-row[data-field="company"] select').selectOption('0');
  await dialog.locator('.map-row[data-field="role"] select').selectOption('1');
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  await expect(dialog).toContainText('1 to create');
});

test('a row that is already in the pipeline is flagged and left out', async ({ page }) => {
  // Import once...
  let dialog = await openImport(page);
  await attach(page, csvFile());
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);

  // ...then import the same file again.
  dialog = await openImport(page);
  await attach(page, csvFile());
  await expect(dialog).toContainText('4 already here');
  await expect(dialog).toContainText('0 to create');
  await expect(dialog.locator('tbody tr').nth(0)).toContainText('the same company and role');
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await expect(dialog).toContainText('Everything in this file is already here');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => window.cairn.store.state.applications.length)).toBe(4);
});

test('there is no Google Sheets button, and the dialog says why', async ({ page }) => {
  const dialog = await openImport(page);
  await expect(dialog).not.toContainText('Connect');
  await expect(dialog).toContainText('no Google Sheets button on purpose');
  await expect(dialog).toContainText('Comma-separated values');
});

test('an xlsx is read, including dates that are really numbers underneath', async ({ page }) => {
  // Built here rather than committed as a binary fixture, using the same
  // vendored library the reader uses to unpack one.
  const bytes = (() => {
    const strings = ['Company', 'Role', 'Date Applied', 'Status', 'Acme', 'Backend Engineer', 'Applied', 'Globex', 'Data Analyst', 'Interview'];
    const cell = (ref, index) => `<c r="${ref}" t="s"><v>${index}</v></c>`;
    const sheet =
      '<?xml version="1.0"?><worksheet><sheetData>' +
      `<row r="1">${cell('A1', 0)}${cell('B1', 1)}${cell('C1', 2)}${cell('D1', 3)}</row>` +
      `<row r="2">${cell('A2', 4)}${cell('B2', 5)}<c r="C2" s="1"><v>46238</v></c>${cell('D2', 6)}</row>` +
      `<row r="3">${cell('A3', 7)}${cell('B3', 8)}<c r="C3" s="1"><v>46233</v></c>${cell('D3', 9)}</row>` +
      '</sheetData></worksheet>';
    const files = {
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
      'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/styles.xml': strToU8('<?xml version="1.0"?><styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'),
      'xl/sharedStrings.xml': strToU8(`<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
    };
    return zipSync(files);
  })();

  const dialog = await openImport(page);
  await attach(page, {
    name: 'applications.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(bytes),
  });

  await expect(dialog).toContainText('2 row(s) read');
  const rows = dialog.locator('tbody tr');
  await expect(rows.nth(0)).toContainText('Acme');
  // 46238 is a date because the column says it is, not because it looks like one.
  await expect(rows.nth(0)).toContainText('4 Aug');
  await expect(rows.nth(1)).toContainText('30 Jul');

  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('#view')).toContainText('Acme');
});

test('a file that is not a spreadsheet is refused rather than half-read', async ({ page }) => {
  const dialog = await openImport(page);
  await attach(page, {
    name: 'notes.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('this is not a zip file at all', 'utf8'),
  });
  await expect(page.locator('.toast')).toContainText('could not be read');
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
});

test('an import is one undo, like everything else', async ({ page }) => {
  const dialog = await openImport(page);
  await attach(page, csvFile());
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('#view')).toContainText('Acme');

  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  expect(await page.evaluate(() => window.cairn.store.state.applications.length)).toBe(0);
});
