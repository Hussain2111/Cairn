// An .xlsx reader, limited to what a job-applications spreadsheet needs: the
// first worksheet, as a grid of strings.
//
// An .xlsx file is a ZIP of XML parts. fflate does the inflating (see
// vendor/fflate); the rest is here because the alternative — a full spreadsheet
// library — is megabytes of code to read one sheet of text.
//
// The one part worth being careful about is dates. A date in a spreadsheet is
// not text: it is a number of days since 1899-12-30 that *renders* as a date
// because of the format applied to it. Reading the number and guessing would
// turn "2026-08-04" into "45873" or, worse, into a plausible wrong date. So the
// style table is read and a cell counts as a date only when its number format
// actually says so.

import { unzipSync, strFromU8 } from '../../vendor/fflate/fflate.mjs';

/** Built-in number-format ids that mean a date or a time. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

const decodeEntities = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');

/** Attribute value off an XML tag, without pulling in a parser. */
function attr(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? decodeEntities(match[1]) : null;
}

/** "BC12" → { col: 54, row: 12 }. Columns are base-26 with no zero. */
export function parseRef(ref) {
  const match = /^([A-Z]+)(\d+)$/.exec(String(ref ?? '').toUpperCase());
  if (!match) return null;
  let col = 0;
  for (const char of match[1]) col = col * 26 + (char.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(match[2]) };
}

/**
 * Excel's day zero is 1899-12-30, not 1900-01-01: the format deliberately
 * reproduces a Lotus 1-2-3 bug that treated 1900 as a leap year.
 */
export function serialToISO(serial) {
  const days = Math.floor(Number(serial));
  if (!Number.isFinite(days)) return null;
  const ms = Date.UTC(1899, 11, 30) + days * 86400000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function sharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  // Each <si> is one string, but it may be split across several <t> runs when
  // part of it is styled differently.
  for (const si of xml.match(/<si\b[\s\S]*?<\/si>|<si\b[^>]*\/>/g) ?? []) {
    const parts = [...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1]));
    out.push(parts.join(''));
  }
  return out;
}

/** Which style indexes render as dates. */
function dateStyles(xml) {
  const dates = new Set();
  if (!xml) return dates;

  const customDateFormats = new Set();
  for (const numFmt of xml.match(/<numFmt\b[^>]*\/>/g) ?? []) {
    const id = Number(attr(numFmt, 'numFmtId'));
    const code = attr(numFmt, 'formatCode') ?? '';
    // Strip the parts of a format string that are not field codes before
    // looking for date fields, so a currency format with a literal "d" in its
    // text does not read as a date.
    const stripped = code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
    if (/[dmyh]/i.test(stripped) && !/^[^dmy]*$/i.test(stripped)) customDateFormats.add(id);
  }

  const cellXfs = xml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? '';
  const xfs = cellXfs.match(/<xf\b[^>]*\/>|<xf\b[\s\S]*?<\/xf>/g) ?? [];
  xfs.forEach((xf, index) => {
    const id = Number(attr(xf, 'numFmtId'));
    if (BUILTIN_DATE_FORMATS.has(id) || customDateFormats.has(id)) dates.add(index);
  });
  return dates;
}

/** The path of the first worksheet, following workbook.xml.rels properly. */
function firstSheetPath(files) {
  const workbook = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  const rels = files['xl/_rels/workbook.xml.rels'] ? strFromU8(files['xl/_rels/workbook.xml.rels']) : '';
  const sheet = workbook.match(/<sheet\b[^>]*\/>/)?.[0];
  const relId = sheet ? attr(sheet, 'r:id') : null;

  if (relId && rels) {
    for (const rel of rels.match(/<Relationship\b[^>]*\/>/g) ?? []) {
      if (attr(rel, 'Id') === relId) {
        const target = attr(rel, 'Target') ?? '';
        return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      }
    }
  }
  // Fall back to the conventional location, then to whatever worksheet exists.
  if (files['xl/worksheets/sheet1.xml']) return 'xl/worksheets/sheet1.xml';
  return Object.keys(files).find((name) => /^xl\/worksheets\/.*\.xml$/.test(name)) ?? null;
}

/**
 * Read the first worksheet of an .xlsx file.
 *
 * @param {Uint8Array} bytes
 * @returns {{headers:string[], rows:{cells:string[], line:number}[], problems:Array, sheetName:string|null}}
 */
export function parseXlsx(bytes) {
  let files;
  try {
    files = unzipSync(new Uint8Array(bytes));
  } catch (error) {
    throw new Error(`this is not a readable .xlsx file — ${error.message}`);
  }

  const path = firstSheetPath(files);
  if (!path || !files[path]) {
    throw new Error('the file has no worksheet in it');
  }

  const strings = sharedStrings(files['xl/sharedStrings.xml'] ? strFromU8(files['xl/sharedStrings.xml']) : '');
  const dateStyleIndexes = dateStyles(files['xl/styles.xml'] ? strFromU8(files['xl/styles.xml']) : '');
  const sheet = strFromU8(files[path]);
  const workbook = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  const sheetName = workbook.match(/<sheet\b[^>]*\/>/)?.[0] ? attr(workbook.match(/<sheet\b[^>]*\/>/)[0], 'name') : null;

  const problems = [];
  const grid = new Map();
  let width = 0;

  for (const rowXml of sheet.match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) ?? []) {
    const rowNumber = Number(attr(rowXml, 'r')) || grid.size + 1;
    const cells = new Map();

    for (const cellXml of rowXml.match(/<c\b[\s\S]*?<\/c>|<c\b[^>]*\/>/g) ?? []) {
      const ref = parseRef(attr(cellXml, 'r') ?? '');
      const column = ref ? ref.col : cells.size;
      const type = attr(cellXml, 't');
      const styleIndex = Number(attr(cellXml, 's'));

      let raw;
      if (type === 'inlineStr') {
        raw = [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1])).join('');
      } else {
        const v = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
        raw = v === undefined ? '' : decodeEntities(v);
      }

      let text = raw;
      if (type === 's') {
        const index = Number(raw);
        text = strings[index] ?? '';
        if (strings[index] === undefined && raw !== '') {
          problems.push({ line: rowNumber, message: 'a cell points at a missing shared string — read as empty', raw });
        }
      } else if (type === 'b') {
        text = raw === '1' ? 'TRUE' : 'FALSE';
      } else if (type === 'e') {
        // A formula error such as #REF!. Kept verbatim so it is visible in the
        // preview rather than silently becoming a value.
        text = raw;
      } else if (!type || type === 'n') {
        if (raw !== '' && Number.isFinite(Number(styleIndex)) && dateStyleIndexes.has(styleIndex)) {
          text = serialToISO(raw) ?? raw;
        }
      }

      cells.set(column, String(text).trim());
      if (column + 1 > width) width = column + 1;
    }
    grid.set(rowNumber, cells);
  }

  const rowNumbers = [...grid.keys()].sort((a, b) => a - b);
  const records = rowNumbers
    .map((n) => ({
      line: n,
      cells: Array.from({ length: width }, (_, i) => grid.get(n).get(i) ?? ''),
    }))
    .filter((record) => record.cells.some((cell) => cell !== ''));

  if (!records.length) {
    return { headers: [], rows: [], problems: [{ line: 1, message: 'the sheet is empty', raw: '' }], sheetName };
  }

  const headers = records[0].cells.map((cell) => cell.trim());
  // Trailing empty header columns are formatting, not data.
  while (headers.length && !headers[headers.length - 1]) headers.pop();

  const rows = records.slice(1).map((record) => ({
    line: record.line,
    cells: headers.map((_, i) => record.cells[i] ?? ''),
  }));

  return { headers, rows, problems, sheetName };
}
