// Reading: a list, not a reader.
//
// Cairn used to import PDFs and render them page by page. It no longer does —
// reading happens on paper or on a device made for it, and an in-app reader
// nobody opened was carrying a vendored PDF engine, an IndexedDB store for the
// file bytes, and a whole class of "the file is missing on this device"
// problems that only existed because the files were here at all.
//
// What is left is the part that was actually used: what I am reading, what I
// have finished, and what I thought of it.

import { el, tag, empty, confirm, toast } from '../ui.js';
import { pageHead, editRecord, statTile } from './shared.js';
import { makeReading, READING_STATUSES } from '../../core/schema.js';
import { todayISO } from '../../core/dates.js';

export function title() {
  return 'Reading';
}

/** Shelf order: what you are reading now, then what is waiting, then the past. */
const STATUS_ORDER = { reading: 0, 'to read': 1, finished: 2 };

const STATUS_LABEL = {
  reading: 'Reading',
  'to read': 'Want to read',
  finished: 'Finished',
};

const STATUS_VARIANT = { reading: 'amber', finished: 'teal', 'to read': '' };

export function render(ctx) {
  const books = [...(ctx.state.reading ?? [])].sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) ||
      String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) ||
      a.title.localeCompare(b.title),
  );

  const counts = Object.fromEntries(
    READING_STATUSES.map((status) => [status, books.filter((b) => b.status === status).length]),
  );

  return el('div', [
    pageHead('Reading', {
      sub: 'A list of books and where you are in them.',
      actions: [el('button.btn.btn--primary', { type: 'button', text: 'Add a book', onclick: () => addBook(ctx) })],
    }),

    el('div.grid.grid--3', [
      statTile(counts.reading ?? 0, 'reading', counts.reading ? 'amber' : ''),
      statTile(counts['to read'] ?? 0, 'want to read'),
      statTile(counts.finished ?? 0, 'finished', 'teal'),
    ]),

    books.length
      ? el('div.card', { style: { marginTop: 'var(--sp-4)' } }, books.map((book) => bookRow(ctx, book)))
      : empty(
          'No books yet',
          'Add what you are reading. Cairn keeps the title, the author, where you are and what you thought — it does not open the file.',
          el('button.btn.btn--primary', { type: 'button', text: 'Add the first book', onclick: () => addBook(ctx) }),
        ),
  ]);
}

function bookRow(ctx, book) {
  return el('div.book-row', { dataset: { id: book.id, status: book.status } }, [
    el('div', [
      el('div.break', [
        el('strong', { text: book.title || 'Untitled' }),
        book.author ? el('span.section__meta', { text: ` — ${book.author}` }) : null,
      ]),
      book.notes ? el('div.section__meta.break', { text: book.notes }) : null,
    ]),

    el('div.row', [
      tag(STATUS_LABEL[book.status] ?? book.status, STATUS_VARIANT[book.status] ?? ''),
      // A page number means something while you are reading it and nothing
      // afterwards, so it only shows where it means something.
      book.status === 'reading' && book.page ? tag(`page ${book.page}`) : null,
      book.status === 'finished' && book.rating ? tag('★'.repeat(book.rating), 'teal') : null,
      el('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        text: 'Edit',
        'aria-label': `Edit ${book.title}`,
        onclick: () => editBook(ctx, book),
      }),
    ]),
  ]);
}

// --- add and edit -----------------------------------------------------------

function fields(values = {}) {
  const status = values.status ?? 'reading';
  return [
    { key: 'title', label: 'Title', required: true },
    { key: 'author', label: 'Author' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      options: READING_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] })),
      default: status,
    },
    { key: 'page', label: 'Current page', type: 'number', hint: 'Optional. Only meaningful while you are reading it.' },
    { key: 'rating', label: 'Rating', type: 'number', hint: 'Optional, 1 to 5, once you have finished it.' },
    { key: 'notes', label: 'Notes', type: 'textarea', rows: 4 },
  ];
}

function clean(values) {
  const page = values.page === null || values.page === '' ? null : Math.max(0, Math.round(Number(values.page)));
  const rating = values.rating === null || values.rating === '' ? null : Math.round(Number(values.rating));
  return {
    title: values.title,
    author: values.author,
    status: READING_STATUSES.includes(values.status) ? values.status : 'reading',
    page: Number.isFinite(page) ? page || null : null,
    rating: Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : null,
    notes: values.notes,
    updatedAt: todayISO(),
  };
}

async function addBook(ctx) {
  const values = await editRecord({
    title: 'Add a book',
    submitLabel: 'Add',
    fields: fields(),
  });
  if (!values) return;
  ctx.commit('add book', (state) => {
    state.reading.push(makeReading(clean(values)));
  }, { undoable: false });
}

async function editBook(ctx, book) {
  const values = await editRecord({
    title: 'Book',
    fields: fields(book),
    values: { ...book, page: book.page ?? '', rating: book.rating ?? '' },
    deletable: true,
  });
  if (!values) return;

  if (values.__delete) {
    const answer = await confirm({
      title: 'Remove this book?',
      message: `"${book.title}" will be removed from the list, along with its notes. This can be undone.`,
      confirmLabel: 'Remove',
    });
    if (answer !== 'confirm') return;
    ctx.commit('remove book', (state) => {
      const index = state.reading.findIndex((b) => b.id === book.id);
      if (index >= 0) state.reading.splice(index, 1);
    });
    return;
  }

  const patch = clean(values);
  ctx.commit('edit book', () => Object.assign(book, patch), { undoable: false });
  if (patch.status === 'finished' && book.status !== 'finished') toast(`Finished "${patch.title}".`);
}
