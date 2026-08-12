// "Import from a spreadsheet": read a CSV or XLSX of job applications.
//
// Same shape as the outline importer, because the problem is the same: take
// something the user already wrote somewhere else and turn it into records,
// showing everything before writing anything.
//
// The one difference is that the columns are theirs, not ours. A guessed
// mapping is offered, every one of the guesses is correctable, and the preview
// updates as they are corrected — so what is on screen when Import is pressed
// is exactly what gets created.

import { el, openDialog, toast, tag, select } from '../ui.js';
import { parseCsv } from '../../core/csv.js';
import { parseXlsx } from '../../core/xlsx.js';
import { IMPORT_COLUMNS, guessMapping, buildPreview, missingRequired } from '../../core/app-import.js';
import { formatDate } from '../../core/dates.js';

export function openApplicationImport(ctx) {
  /** @type {{headers:string[], rows:Array, problems:Array, name:string}|null} */
  let sheet = null;
  let mapping = {};
  let preview = null;

  const fileInput = el('input.input', {
    type: 'file',
    accept: '.csv,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'aria-label': 'Spreadsheet file',
  });
  const mappingNode = el('div.stack--tight.stack');
  const previewNode = el('div.stack');

  const goButton = el('button.btn.btn--primary', { type: 'button', text: 'Import', disabled: true });

  // --- reading the file -----------------------------------------------------

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    sheet = null;
    mapping = {};
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsed = parseXlsx(bytes);
        sheet = { ...parsed, name: file.name };
      } else {
        const text = await file.text();
        const parsed = parseCsv(text);
        sheet = { ...parsed, name: file.name };
      }
    } catch (error) {
      sheet = null;
      toast(`That file could not be read — ${error.message}`, { variant: 'danger', timeout: 8000 });
      draw();
      return;
    }

    if (!sheet.headers.length) {
      toast('That file has no header row, so there is nothing to map columns from.', { variant: 'danger' });
      sheet = null;
      draw();
      return;
    }

    mapping = guessMapping(sheet.headers);
    draw();
  });

  // --- the mapping table ----------------------------------------------------

  const drawMapping = () => {
    mappingNode.replaceChildren();
    if (!sheet) return;

    mappingNode.appendChild(el('span.field__label', { text: 'Which column is which' }));
    mappingNode.appendChild(el('p.field__hint', {
      text: 'Cairn guessed these from your header row. Anything marked "guessed" is worth a look — change any of them and the preview below updates.',
    }));

    for (const column of IMPORT_COLUMNS) {
      const current = mapping[column.key];
      const options = [
        { value: '', label: '— not in this file —' },
        ...sheet.headers.map((header, index) => ({ value: String(index), label: header || `(column ${index + 1})` })),
      ];
      const picker = select(options, current ? String(current.index) : '', {
        'aria-label': `Column for ${column.label}`,
      });
      picker.addEventListener('change', () => {
        const value = picker.value;
        mapping[column.key] = value === ''
          ? null
          : { index: Number(value), confidence: 'chosen', header: sheet.headers[Number(value)] };
        draw();
      });

      mappingNode.appendChild(
        el('div.row.row--between.map-row', { dataset: { field: column.key } }, [
          el('div.row', [
            el('span.field__label', { text: column.label }),
            column.required ? tag('required', current ? '' : 'danger') : null,
            current?.confidence === 'partial' ? tag('guessed', 'amber') : null,
          ]),
          picker,
        ]),
      );
    }
  };

  // --- the preview ----------------------------------------------------------

  const drawPreview = () => {
    previewNode.replaceChildren();

    if (!sheet) {
      previewNode.appendChild(el('p.field__hint', {
        text: 'No file chosen yet. Everything that would be created is listed here before anything is written.',
      }));
      goButton.disabled = true;
      return;
    }

    const missing = missingRequired(mapping);
    if (missing.length) {
      previewNode.appendChild(banner('danger', `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not mapped`,
        'An application is identified by its company and its role. Point those at a column above, or add them to the spreadsheet.'));
      goButton.disabled = true;
      return;
    }

    preview = buildPreview(sheet.rows, mapping, { existing: ctx.state.applications, today: ctx.today });
    const fresh = preview.records.filter((r) => !r.duplicate);

    previewNode.appendChild(
      el('div.row', [
        tag(`${sheet.rows.length} row(s) read`),
        tag(`${fresh.length} to create`, fresh.length ? 'teal' : ''),
        preview.duplicates ? tag(`${preview.duplicates} already here`, 'amber') : null,
        preview.skipped ? tag(`${preview.skipped} unusable`, 'danger') : null,
      ]),
    );

    // Problems from the file itself — a ragged row, an unclosed quote.
    const fileProblems = sheet.problems ?? [];
    if (fileProblems.length) {
      previewNode.appendChild(problemList('The file itself', fileProblems));
    }
    if (preview.problems.length) {
      previewNode.appendChild(problemList('Rows that needed a decision', preview.problems));
    }

    if (!preview.records.length) {
      previewNode.appendChild(banner('warn', 'Nothing to import', 'Every row was unusable. The list above says why, row by row.'));
      goButton.disabled = true;
      return;
    }

    previewNode.appendChild(el('span.field__label', { text: 'What will be created' }));
    const table = el('table.table', [
      el('thead', [el('tr', ['Row', 'Company', 'Role', 'Applied', 'Status', ''].map((h) => el('th', { text: h })))]),
      el('tbody', preview.records.slice(0, 60).map((entry) =>
        el('tr', { dataset: { line: String(entry.line), duplicate: entry.duplicate ? 'true' : 'false' } }, [
          el('td.mono.faint', { text: String(entry.line) }),
          el('td.break', { text: entry.record.company }),
          el('td.break', { text: entry.record.role }),
          el('td', { text: entry.record.dateApplied ? formatDate(entry.record.dateApplied) : '—' }),
          el('td', { text: entry.record.status }),
          el('td', [
            entry.duplicate ? tag(`already here — ${entry.duplicate.on}`, 'amber') : null,
            entry.incomplete ? tag('incomplete', 'amber') : null,
          ]),
        ]))),
    ]);
    previewNode.appendChild(el('div', { style: { overflowX: 'auto' } }, [table]));
    if (preview.records.length > 60) {
      previewNode.appendChild(el('span.muted', { text: `…and ${preview.records.length - 60} more.` }));
    }

    if (preview.duplicates) {
      previewNode.appendChild(el('p.field__hint', {
        text: `${preview.duplicates} row(s) match an application already in Cairn, by company and role or by link. They are left out — importing the same sheet twice will not double your pipeline.`,
      }));
    }

    goButton.disabled = fresh.length === 0;
    if (!fresh.length) {
      previewNode.appendChild(banner('warn', 'Everything in this file is already here', 'Nothing left to import.'));
    }
  };

  const draw = () => {
    drawMapping();
    drawPreview();
  };

  draw();

  return openDialog({
    title: 'Import applications from a spreadsheet',
    wide: true,
    body: el('div.stack', [
      el('label.field', [
        el('span.field__label', { text: 'CSV or XLSX file' }),
        fileInput,
        el('span.field__hint', {
          // Said here rather than left to be wondered about.
          text: 'There is no Google Sheets button on purpose: connecting to Sheets needs a server to hold the credentials, and Cairn has no server. File › Download › Comma-separated values gets you a file this reads, in two clicks.',
        }),
      ]),
      mappingNode,
      previewNode,
    ]),
    footer: (close) => {
      goButton.onclick = () => close({ go: true });
      return [
        el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
        goButton,
      ];
    },
    onClose: (value) => {
      if (!value?.go || !preview) return;
      const fresh = preview.records.filter((entry) => !entry.duplicate).map((entry) => entry.record);
      if (!fresh.length) return;
      ctx.commit('import applications', (state) => {
        state.applications.push(...fresh);
      }, { message: `${fresh.length} application(s) imported.` });
    },
  });
}

function banner(variant, title, text) {
  return el(`div.banner.banner--${variant}`, [
    el('div.banner__body', [
      el('div.banner__title', { text: title }),
      el('div.banner__text', { text }),
    ]),
  ]);
}

/** Every problem is shown with its line number and its content, never a count alone. */
function problemList(heading, problems) {
  return el('div.stack--tight.stack', [
    el('strong', { text: `${heading} — ${problems.length}` }),
    el('div.unparsed', problems.slice(0, 40).map((problem) =>
      el('div.row', [
        tag(`line ${problem.line}`, problem.severity === 'skipped' ? 'danger' : 'amber'),
        el('span.break', { text: problem.message }),
        problem.raw ? el('span.section__meta.break', { text: problem.raw }) : null,
      ]))),
    problems.length > 40 ? el('span.muted', { text: `…and ${problems.length - 40} more.` }) : null,
  ]);
}
