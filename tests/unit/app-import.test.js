import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from '../../vendor/fflate/fflate.mjs';

import { parseCsv, sniffDelimiter } from '../../src/core/csv.js';
import { parseXlsx, serialToISO, parseRef } from '../../src/core/xlsx.js';
import {
  guessMapping,
  buildPreview,
  readDate,
  readStatus,
  readSource,
  findDuplicate,
  missingRequired,
} from '../../src/core/app-import.js';

// --- CSV --------------------------------------------------------------------

test('a quoted field may contain the delimiter, a newline and a quote', () => {
  const { headers, rows, problems } = parseCsv(
    'Company,Role,Notes\nAcme,"Engineer, Platform","line one\nline ""two"""\n',
  );
  assert.deepEqual(headers, ['Company', 'Role', 'Notes']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cells[1], 'Engineer, Platform');
  assert.equal(rows[0].cells[2], 'line one\nline "two"');
  assert.deepEqual(problems, []);
});

test('CRLF, a BOM and a trailing newline do not produce phantom rows or headers', () => {
  const { headers, rows } = parseCsv('﻿Company,Role\r\nAcme,Engineer\r\n');
  assert.deepEqual(headers, ['Company', 'Role'], 'the BOM is not part of the first header');
  assert.equal(rows.length, 1);
});

test('the delimiter is sniffed outside quotes, so one comma in a cell cannot fool it', () => {
  assert.equal(sniffDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(sniffDelimiter('a\tb\tc'), '\t');
  assert.equal(sniffDelimiter('"Smith, Jane";Role;Date'), ';');
});

test('a row with the wrong number of cells is kept and reported, never dropped', () => {
  const { rows, problems } = parseCsv('Company,Role,Date\nAcme,Engineer\nGlobex,Analyst,2026-08-01,extra\n');
  assert.equal(rows.length, 2, 'both rows survive');
  assert.equal(rows[0].cells[2], '', 'the missing cell is empty rather than absent');
  assert.equal(problems.length, 2);
  assert.deepEqual(problems.map((p) => p.line), [2, 3]);
  assert.match(problems[0].message, /2 value\(s\) where the header row has 3/);
});

test('an unclosed quote is reported rather than swallowing the rest of the file in silence', () => {
  const { problems } = parseCsv('Company,Role\nAcme,"Engineer\n');
  assert.match(problems.map((p) => p.message).join(' '), /never closed/);
});

test('an empty file says so instead of returning an empty success', () => {
  assert.match(parseCsv('').problems[0].message, /empty/);
  assert.match(parseCsv('\n\n\n').problems[0].message, /no rows/);
});

// --- XLSX -------------------------------------------------------------------

/** Build a minimal .xlsx in memory so the reader is tested against a real ZIP. */
function buildXlsx({ rows, dateColumns = [] }) {
  const strings = [];
  const stringIndex = (value) => {
    const at = strings.indexOf(value);
    if (at >= 0) return at;
    strings.push(value);
    return strings.length - 1;
  };

  const colLetter = (i) => String.fromCharCode(65 + i);
  const sheetRows = rows.map((cells, r) => {
    const xml = cells.map((cell, c) => {
      const ref = `${colLetter(c)}${r + 1}`;
      if (cell === null || cell === undefined || cell === '') return '';
      if (dateColumns.includes(c) && r > 0) {
        // Style 1 is the date style declared below.
        return `<c r="${ref}" s="1"><v>${cell}</v></c>`;
      }
      if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
      return `<c r="${ref}" t="s"><v>${stringIndex(String(cell))}</v></c>`;
    }).join('');
    return `<row r="${r + 1}">${xml}</row>`;
  }).join('');

  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Applications" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/styles.xml': strToU8(
      '<?xml version="1.0"?><styleSheet><cellXfs count="2">' +
      '<xf numFmtId="0"/><xf numFmtId="14"/>' +
      '</cellXfs></styleSheet>',
    ),
    'xl/sharedStrings.xml': strToU8(
      `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`),
  };
  return zipSync(files);
}

test('an xlsx sheet reads as a header row and data rows', () => {
  const bytes = buildXlsx({
    rows: [
      ['Company', 'Role', 'Status'],
      ['Acme', 'Backend Engineer', 'Applied'],
      ['Wonka', 'Chocolatier & Co', 'offer'],
    ],
  });
  const { headers, rows, sheetName } = parseXlsx(bytes);
  assert.deepEqual(headers, ['Company', 'Role', 'Status']);
  assert.equal(sheetName, 'Applications');
  assert.deepEqual(rows.map((r) => r.cells), [
    ['Acme', 'Backend Engineer', 'Applied'],
    ['Wonka', 'Chocolatier & Co', 'offer'],
  ]);
});

test('a date cell is read as a date because its format says so, not because it looks like a number', () => {
  // 46238 is 2026-08-04 in Excel's day count.
  const bytes = buildXlsx({
    rows: [['Company', 'Date Applied', 'Headcount'], ['Acme', 46238, 46238]],
    dateColumns: [1],
  });
  const { rows } = parseXlsx(bytes);
  assert.equal(rows[0].cells[1], '2026-08-04', 'the styled column becomes a date');
  assert.equal(rows[0].cells[2], '46238', 'the unstyled column stays the number it is');
});

test('Excel day zero is 1899-12-30, reproducing the 1900 leap-year bug on purpose', () => {
  assert.equal(serialToISO(1), '1899-12-31');
  assert.equal(serialToISO(46238), '2026-08-04');
  assert.equal(serialToISO('nonsense'), null);
});

test('cell references parse past column Z', () => {
  assert.deepEqual(parseRef('A1'), { col: 0, row: 1 });
  assert.deepEqual(parseRef('Z9'), { col: 25, row: 9 });
  assert.deepEqual(parseRef('AA1'), { col: 26, row: 1 });
  assert.deepEqual(parseRef('BC12'), { col: 54, row: 12 });
  assert.equal(parseRef('nope'), null);
});

test('a file that is not a spreadsheet is refused with an explanation', () => {
  assert.throws(() => parseXlsx(strToU8('this is not a zip')), /not a readable \.xlsx/);
});

// --- mapping ----------------------------------------------------------------

test('headers are matched to fields, exact before partial', () => {
  const mapping = guessMapping(['Company Name', 'Position', 'Date Applied', 'Date', 'Notes']);
  assert.equal(mapping.company.header, 'Company Name');
  assert.equal(mapping.role.header, 'Position');
  assert.equal(mapping.dateApplied.header, 'Date Applied', 'the exact alias wins over the looser "Date"');
  assert.equal(mapping.notes.header, 'Notes');
});

test('a guess is labelled as a guess, so it can be checked before it is used', () => {
  const mapping = guessMapping(['Where I applied', 'Job title']);
  assert.equal(mapping.company.confidence, 'partial');
  assert.equal(mapping.role.header, 'Job title');
});

test('one column is never claimed by two fields', () => {
  const mapping = guessMapping(['Date']);
  const used = Object.values(mapping).filter(Boolean).map((m) => m.index);
  assert.equal(new Set(used).size, used.length);
});

test('a file with no company or role column is refused until one is chosen', () => {
  const mapping = guessMapping(['Thing', 'Other thing']);
  assert.deepEqual(missingRequired(mapping).sort(), ['Company', 'Role']);
  assert.deepEqual(missingRequired(guessMapping(['Company', 'Role'])), []);
});

// --- reading values ---------------------------------------------------------

test('an ambiguous slashed date is refused rather than guessed at', () => {
  const result = readDate('03/04/2026');
  assert.equal(result.value, null);
  assert.match(result.problem, /day\/month or month\/day/);
});

test('dates that can only mean one thing are read', () => {
  assert.equal(readDate('2026-08-04').value, '2026-08-04');
  assert.equal(readDate('2026-08-04T09:30:00').value, '2026-08-04');
  assert.equal(readDate('4 August 2026').value, '2026-08-04');
  assert.equal(readDate('August 4, 2026').value, '2026-08-04');
  assert.equal(readDate('25/12/2026').value, '2026-12-25', '25 cannot be a month');
  assert.equal(readDate('').value, null);
  assert.equal(readDate('').problem, null, 'an empty cell is not a problem');
});

test('status words are mapped onto the six Cairn has, and the rest are reported', () => {
  assert.equal(readStatus('Applied').value, 'applied');
  assert.equal(readStatus('phone screen').value, 'screening');
  assert.equal(readStatus('Onsite').value, 'interview');
  assert.equal(readStatus('No response').value, 'ghosted');
  assert.equal(readStatus('').value, 'applied');
  const odd = readStatus('vibing');
  assert.equal(odd.value, 'applied');
  assert.match(odd.problem, /not one Cairn has/);
});

test('an unrecognised source becomes "other" and keeps the original wording', () => {
  assert.equal(readSource('LinkedIn').value, 'LinkedIn');
  const odd = readSource('Otta');
  assert.equal(odd.value, 'other');
  assert.equal(odd.original, 'Otta');
});

// --- duplicates and the preview ---------------------------------------------

test('a duplicate is found by company and role, or by link', () => {
  const existing = [
    { id: 'a1', company: 'Acme Corp', role: 'Backend Engineer', url: '' },
    { id: 'a2', company: 'Globex', role: 'Analyst', url: 'https://jobs.example/1' },
  ];
  assert.equal(findDuplicate(existing, { company: 'acme  corp', role: 'backend engineer' }).application.id, 'a1');
  assert.equal(findDuplicate(existing, { company: 'Anything', role: 'Else', url: 'https://jobs.example/1' }).application.id, 'a2');
  assert.equal(findDuplicate(existing, { company: 'New', role: 'Role' }), null);
});

function preview(csv, { existing = [] } = {}) {
  const parsed = parseCsv(csv);
  return buildPreview(parsed.rows, guessMapping(parsed.headers), { existing, today: '2026-08-12' });
}

test('the preview builds one application per usable row', () => {
  const result = preview(
    'Company,Role,Date Applied,Status,Source\nAcme,Engineer,2026-08-04,Applied,LinkedIn\nGlobex,Analyst,2026-07-30,Interview,referral\n',
  );
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].record.company, 'Acme');
  assert.equal(result.records[0].record.dateApplied, '2026-08-04');
  assert.equal(result.records[1].record.status, 'interview');
  assert.equal(result.records[1].record.source, 'referral');
});

test('a row with neither company nor role is reported by line number rather than dropped', () => {
  const result = preview('Company,Role,Notes\n,,just a stray note\nAcme,Engineer,\n');
  assert.equal(result.records.length, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.problems[0].line, 2);
  assert.match(result.problems[0].raw, /just a stray note/, 'the row content is shown, not just its number');
});

test('a row missing only one of the two is kept and flagged as incomplete', () => {
  const result = preview('Company,Role\nAcme,\n');
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].incomplete, true);
  assert.equal(result.records[0].record.role, 'Unknown role');
});

test('a row that already exists is flagged rather than merged or duplicated', () => {
  const result = preview('Company,Role\nAcme,Engineer\nGlobex,Analyst\n', {
    existing: [{ id: 'a1', company: 'Acme', role: 'Engineer', url: '' }],
  });
  assert.equal(result.duplicates, 1);
  assert.equal(result.records[0].duplicate.on, 'the same company and role');
  assert.equal(result.records[1].duplicate, null);
});

test('a spreadsheet that repeats itself is caught within the one file', () => {
  const result = preview('Company,Role\nAcme,Engineer\nAcme,Engineer\n');
  assert.equal(result.duplicates, 1, 'the second copy is the duplicate, not the first');
  assert.equal(result.records[0].duplicate, null);
  assert.ok(result.records[1].duplicate);
});

test('an unreadable date does not lose the row — it falls back to today and says so', () => {
  const result = preview('Company,Role,Date Applied\nAcme,Engineer,03/04/2026\n');
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].record.dateApplied, '2026-08-12');
  assert.match(result.problems[0].message, /day\/month or month\/day/);
});

test('a status and a source Cairn does not have are kept in the notes', () => {
  const result = preview('Company,Role,Status,Source,Notes\nAcme,Engineer,vibing,Otta,keen on this one\n');
  const { record } = result.records[0];
  assert.match(record.notes, /keen on this one/);
  assert.match(record.notes, /Spreadsheet status: vibing/);
  assert.match(record.notes, /Source: Otta/);
});

test('what the preview shows is what would be created, field for field', () => {
  const result = preview(
    'Company,Role,Date Applied,Status,Source,Link,Resume,Referred by,Next step,Follow up date,Notes\n' +
    'Acme,Engineer,2026-08-04,Interview,LinkedIn,https://jobs.example/9,backend-v3,Jane,send the take-home,2026-08-20,keen\n',
  );
  const { record } = result.records[0];
  assert.equal(record.company, 'Acme');
  assert.equal(record.role, 'Engineer');
  assert.equal(record.url, 'https://jobs.example/9');
  assert.equal(record.resumeVersion, 'backend-v3');
  assert.equal(record.referral, 'Jane');
  assert.equal(record.nextAction, 'send the take-home');
  assert.equal(record.nextActionDate, '2026-08-20');
  assert.equal(record.notes, 'keen');
  assert.equal(record.lastMovedAt, '2026-08-04', 'the pipeline clock starts when it was applied for');
});
