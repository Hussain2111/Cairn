// Reading list: title, author, position, status, notes.

import { el, tag, empty, confirm, meter } from '../ui.js';
import { pageHead, editRecord } from './shared.js';
import { makeReading, READING_STATUSES } from '../../core/schema.js';
import { todayISO, formatDate } from '../../core/dates.js';

export function title() {
  return 'Reading';
}

export function render(ctx) {
  const books = [...ctx.state.reading].sort((a, b) => {
    const order = READING_STATUSES.indexOf(a.status) - READING_STATUSES.indexOf(b.status);
    return order || String(a.title).localeCompare(String(b.title));
  });

  return el('div', [
    pageHead('Reading', {
      sub: `${books.filter((b) => b.status === 'reading').length} in progress · ${books.length} tracked`,
      actions: [el('button.btn.btn--primary', { type: 'button', text: 'Add a book', onclick: () => editBook(ctx, null) })],
    }),

    books.length
      ? el('div.grid.grid--2', books.map((book) => bookCard(ctx, book)))
      : empty(
          'Nothing on the list',
          'Track what you are reading and where you got to, so a book you put down in April does not quietly disappear.',
          el('button.btn.btn--primary', { type: 'button', text: 'Add the first book', onclick: () => editBook(ctx, null) }),
        ),
  ]);
}

function bookCard(ctx, book) {
  const ratio = book.unit === 'percent'
    ? Math.min(1, (Number(book.position) || 0) / 100)
    : book.total
      ? Math.min(1, (Number(book.position) || 0) / Number(book.total))
      : 0;

  return el('div.card', [
    el('div.card__body.stack--tight.stack', [
      el('div.row.row--between', [
        el('strong.break', { text: book.title }),
        tag(book.status, book.status === 'finished' ? 'teal' : book.status === 'abandoned' ? 'locked' : ''),
      ]),
      book.author ? el('div.muted.break', { text: book.author }) : null,
      meter(ratio, book.status === 'finished' ? 'complete' : ''),
      el('div.row.row--between', [
        el('span.mono.faint', {
          text: book.unit === 'percent'
            ? `${book.position}%`
            : `page ${book.position}${book.total ? ` of ${book.total}` : ''}`,
        }),
        el('div.row', [
          el('span.section__meta', { text: `updated ${formatDate(book.updatedAt)}` }),
          el('button.btn.btn--ghost.btn--sm', { type: 'button', text: 'Edit', onclick: () => editBook(ctx, book) }),
        ]),
      ]),
      book.notes ? el('p.muted.break', { text: book.notes }) : null,
    ]),
  ]);
}

async function editBook(ctx, book) {
  const isNew = !book;
  const values = await editRecord({
    title: isNew ? 'Add a book' : 'Book',
    submitLabel: isNew ? 'Add' : 'Save',
    deletable: !isNew,
    fields: [
      { key: 'title', label: 'Title', required: true },
      { key: 'author', label: 'Author' },
      { key: 'status', label: 'Status', type: 'select', options: READING_STATUSES, default: 'reading' },
      { key: 'unit', label: 'Track by', type: 'select', options: ['page', 'percent'], default: 'page' },
      { key: 'position', label: 'Current position', type: 'number', default: 0 },
      { key: 'total', label: 'Total pages', type: 'number' },
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 4 },
    ],
    values: book ?? {},
  });
  if (!values) return;

  if (values.__delete) {
    const answer = await confirm({
      title: 'Remove this book?',
      message: `"${book.title}" and its notes will be removed. This can be undone.`,
      confirmLabel: 'Remove',
    });
    if (answer !== 'confirm') return;
    ctx.commit('delete book', (state) => {
      const index = state.reading.findIndex((b) => b.id === book.id);
      if (index >= 0) state.reading.splice(index, 1);
    });
    return;
  }

  if (isNew) {
    ctx.commit('add book', (state) => {
      state.reading.push(makeReading({ ...values, position: Number(values.position) || 0, updatedAt: todayISO() }));
    }, { undoable: false });
    return;
  }
  ctx.commit('edit book', () => {
    Object.assign(book, values, { position: Number(values.position) || 0, updatedAt: todayISO() });
  }, { undoable: false });
}
