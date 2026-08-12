// A CSV reader.
//
// Written rather than pulled in because the requirements are small and exact:
// the file comes out of Google Sheets, Excel or Numbers, so it has to handle
// quoted fields containing commas and newlines, doubled quotes, and whichever
// line ending the exporting machine felt like. Everything else — type
// inference, header mapping — belongs upstairs, where the user can correct it.
//
// The rule the whole importer is built on: a row is never dropped silently. A
// row with the wrong number of cells is returned *and* reported, so the caller
// can show it rather than pretend it was not there.

/** Delimiters worth sniffing for. Semicolons come out of European locales. */
const DELIMITERS = [',', ';', '\t'];

/**
 * Pick the delimiter by counting candidates outside quotes on the first line.
 * Counting inside quotes is how a single "Smith, Jane" cell convinces a naive
 * sniffer that a semicolon-delimited file is comma-delimited.
 */
export function sniffDelimiter(text) {
  let best = ',';
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') i += 1;
        else quoted = !quoted;
      } else if (!quoted && (char === '\n' || char === '\r')) break;
      else if (!quoted && char === delimiter) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      best = delimiter;
    }
  }
  return best;
}

/**
 * Parse CSV text into a header row and data rows.
 *
 * @returns {{headers:string[], rows:{cells:string[], line:number}[], problems:{line:number, message:string, raw:string}[], delimiter:string}}
 */
export function parseCsv(text, { delimiter = null } = {}) {
  // A BOM survives every round trip through Excel and turns the first header
  // into "﻿Company", which then matches nothing.
  const source = String(text ?? '').replace(/^﻿/, '');
  const sep = delimiter ?? sniffDelimiter(source);
  const problems = [];

  const records = [];
  let cells = [];
  let value = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let sawAnything = false;

  const endCell = () => {
    cells.push(value);
    value = '';
  };
  const endRecord = () => {
    endCell();
    records.push({ cells, line: recordLine });
    cells = [];
    recordLine = line;
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line += 1;
        value += char;
      }
      continue;
    }

    if (char === '"' && value === '') {
      quoted = true;
      sawAnything = true;
    } else if (char === sep) {
      sawAnything = true;
      endCell();
    } else if (char === '\r') {
      // Swallow it; the \n that follows ends the record.
      if (source[i + 1] !== '\n') {
        line += 1;
        endRecord();
      }
    } else if (char === '\n') {
      line += 1;
      endRecord();
    } else {
      sawAnything = true;
      value += char;
    }
  }

  if (quoted) {
    problems.push({
      line: recordLine,
      message: 'a quoted value is never closed — everything after it was read as one cell',
      raw: value.slice(0, 120),
    });
  }
  // A trailing newline should not manufacture an empty final record.
  if (value !== '' || cells.length) endRecord();
  if (!sawAnything && !records.length) {
    return { headers: [], rows: [], problems: [{ line: 1, message: 'the file is empty', raw: '' }], delimiter: sep };
  }

  const isBlank = (record) => record.cells.every((cell) => !cell.trim());
  const meaningful = records.filter((record) => !isBlank(record));
  if (!meaningful.length) {
    return { headers: [], rows: [], problems: [{ line: 1, message: 'the file has no rows in it', raw: '' }], delimiter: sep };
  }

  const headerRecord = meaningful[0];
  const headers = headerRecord.cells.map((cell) => cell.trim());
  const rows = [];

  for (const record of meaningful.slice(1)) {
    if (record.cells.length !== headers.length) {
      problems.push({
        line: record.line,
        message: `has ${record.cells.length} value(s) where the header row has ${headers.length}`,
        raw: record.cells.join(sep).slice(0, 200),
      });
      // Kept anyway, padded or truncated, so the importer can still show it and
      // let the mapping decide whether the missing cells actually mattered.
    }
    const cells = headers.map((_, index) => (record.cells[index] ?? '').trim());
    rows.push({ cells, line: record.line });
  }

  return { headers, rows, problems, delimiter: sep };
}
