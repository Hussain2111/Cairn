// Reading: a shelf of covers, and a reader.
//
// A book is two things kept apart on purpose. The record — title, author, where
// you got to, what you marked — lives in the main store with everything else,
// so it exports, imports, migrates and undoes like any other record. The file
// itself lives in IndexedDB, because a 40 MB PDF has no business in
// localStorage. The consequence is stated out loud wherever it matters: a JSON
// export carries the shelf, not the books.

import { el, tag, empty, confirm, meter, toast, openDialog, input } from '../ui.js';
import { pageHead, editRecord } from './shared.js';
import {
  shelfOrder,
  bookById,
  isPdf,
  totalPages,
  progress,
  clampPage,
  openAtPage,
  recordPosition,
  bookmarks,
  bookmarkOn,
  fieldsFromPdf,
  libraryBytes,
  booksMissingFiles,
  statusVariant,
} from '../../core/reading.js';
import { makeReading, makeBookmark, READING_STATUSES } from '../../core/schema.js';
import { todayISO } from '../../core/dates.js';
import {
  putBook,
  getBook,
  deleteBook,
  storedIds,
  usage,
  quotaEstimate,
  formatBytes,
} from '../books-db.js';

export function title(ctx) {
  const book = bookById(ctx.state, ctx.route.params[0]);
  return book ? book.title : 'Reading';
}

export function render(ctx) {
  const id = ctx.route.params[0];
  if (!id) return renderShelf(ctx);
  const book = bookById(ctx.state, id);
  if (!book) {
    return empty('That book is not here', 'It may have been removed, or the link came from another device.',
      el('a.btn', { href: '#/reading', text: 'Back to the shelf' }));
  }
  return renderReader(ctx, book);
}

// --- the shelf --------------------------------------------------------------

function renderShelf(ctx) {
  const books = shelfOrder(ctx.state);
  const reading = books.filter((b) => b.status === 'reading').length;

  const storage = el('div.stack--tight.stack');
  const missing = el('div');
  fillStorage(ctx, storage);
  fillMissing(ctx, missing);

  // One picker for the whole view. Two file inputs sharing an id would be an
  // invalid document, and the second would never be the one that fires.
  const picker = filePicker(ctx);

  return el('div', [
    picker,
    pageHead('Reading', {
      sub: books.length
        ? `${reading} in progress · ${books.length} on the shelf · ${formatBytes(libraryBytes(ctx.state))} of books`
        : 'Drop in a PDF and read it here.',
      actions: [
        importButton(picker),
        el('button.btn', { type: 'button', text: 'Track without a file', onclick: () => editBook(ctx, null) }),
      ],
    }),

    missing,

    books.length
      ? el('div.shelf', books.map((book) => coverCard(ctx, book)))
      : empty(
          'Nothing on the shelf',
          'Import a PDF and Cairn reads the title, author and page count out of it, renders the first page as a cover, and opens it where you left off. A book you are only tracking by hand works too.',
          importButton(picker),
        ),

    el('section.section', [
      el('div.section__head', [
        el('h2.section__title', { text: 'Storage' }),
        el('div.section__rule'),
      ]),
      storage,
    ]),
  ]);
}

function coverCard(ctx, book) {
  const total = totalPages(book);
  const ratio = progress(book);

  return el('a.book', {
    href: `#/reading/${book.id}`,
    'aria-label': `Open ${book.title}`,
    dataset: { status: book.status },
  }, [
    book.cover
      ? el('img.book__cover', { src: book.cover, alt: '', loading: 'lazy' })
      : el('div.book__cover.book__cover--blank', [
          el('span.book__blank-title', { text: book.title || 'Untitled' }),
          isPdf(book) ? null : el('span.book__blank-note', { text: 'tracked by hand' }),
        ]),
    el('div.book__body', [
      el('div.book__title.break', { text: book.title || 'Untitled' }),
      book.author ? el('div.book__author.break', { text: book.author }) : null,
      meter(ratio, book.status === 'finished' ? 'complete' : ''),
      el('div.row.row--between', [
        el('span.mono.faint', {
          text: book.unit === 'percent'
            ? `${book.position}%`
            : total
              ? `${book.position || 0} / ${total}`
              : `page ${book.position || 0}`,
        }),
        tag(book.status, statusVariant(book.status)),
      ]),
    ]),
  ]);
}

async function fillStorage(ctx, host) {
  const used = await usage();
  const estimate = await quotaEstimate();
  host.replaceChildren();

  host.appendChild(
    el('div.row', [
      tag(`${used.books} file${used.books === 1 ? '' : 's'}`),
      tag(formatBytes(used.bytes), used.bytes > 200 * 1024 * 1024 ? 'amber' : ''),
      estimate ? tag(`${Math.round(estimate.ratio * 100)}% of what this browser allows`, estimate.ratio > 0.8 ? 'danger' : '') : null,
    ]),
  );
  if (estimate) host.appendChild(meter(estimate.ratio, estimate.ratio > 0.8 ? '' : 'complete'));

  host.appendChild(
    el('p.field__hint', {
      text: 'Book files are held in this browser\'s own storage, separately from everything else. They are not included in Settings › Export JSON — that file carries the shelf, your place in each book and your bookmarks, but not the PDFs, which would make it hundreds of megabytes. Keep the original files, or use "Save the file" on a book to get a copy back out.',
    }),
  );

  if (used.books) {
    host.appendChild(
      el('div.row', [
        el('button.btn.btn--sm', {
          type: 'button',
          text: 'Save every book file',
          onclick: () => saveEveryFile(ctx),
        }),
        el('span.field__hint', { text: 'Downloads each PDF back to disk, one after another.' }),
      ]),
    );
  }

  if (estimate && estimate.ratio > 0.8) {
    host.appendChild(
      el('div.banner.banner--warn', [
        el('div.banner__body', [
          el('div.banner__title', { text: 'This browser is running out of room' }),
          el('div.banner__text', {
            text: 'The next import may be refused. Remove a book you have finished — the record and your notes can stay, only the file goes.',
          }),
        ]),
      ]),
    );
  }
}

async function fillMissing(ctx, host) {
  const missing = booksMissingFiles(ctx.state, await storedIds());
  host.replaceChildren();
  if (!missing.length) return;

  host.appendChild(
    el('div.banner.banner--warn', [
      el('div.banner__body', [
        el('div.banner__title', {
          text: `${missing.length} book${missing.length === 1 ? '' : 's'} on this shelf ${missing.length === 1 ? 'has' : 'have'} no file on this device`,
        }),
        el('div.banner__text', {
          text: `${missing.map((b) => b.title).join(', ')} — your place and bookmarks are here, but the PDF is not. That is what happens after importing a backup: import the file again and everything reattaches.`,
        }),
      ]),
    ]),
  );
}

// --- importing --------------------------------------------------------------

function filePicker(ctx) {
  const picker = el('input', {
    type: 'file',
    accept: 'application/pdf,.pdf',
    multiple: true,
    style: { display: 'none' },
    'aria-label': 'Choose a PDF',
    id: 'reading-file',
    onchange: async (event) => {
      const files = [...(event.target.files ?? [])];
      picker.value = '';
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop -- one dialog at a time
        await importPdf(ctx, file);
      }
    },
  });
  return picker;
}

function importButton(picker) {
  return el('button.btn.btn--primary', {
    type: 'button',
    text: 'Import a PDF',
    onclick: () => picker.click(),
  });
}

async function importPdf(ctx, file) {
  if (!file) return;
  if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    toast(`${file.name} is not a PDF.`, { variant: 'danger' });
    return;
  }

  const notice = toast(`Reading ${file.name}…`, { timeout: 0 });
  let parsed;
  let cover = null;
  try {
    const { openDocument, readMetadata, renderCover } = await import('../pdf.js');
    const doc = await openDocument(file);
    parsed = await readMetadata(doc);
    cover = await renderCover(doc);
    await doc.destroy();
  } catch (error) {
    notice.remove();
    toast(error?.message ?? 'That PDF could not be read.', { variant: 'danger', timeout: 12000 });
    return;
  }
  notice.remove();

  const fields = fieldsFromPdf(parsed, file.name);

  // Everything is shown before anything is written, because a filename-derived
  // title is a guess and guesses should be visible.
  const values = await editRecord({
    title: 'Add this book',
    submitLabel: 'Add it',
    wide: true,
    fields: [
      {
        key: 'title',
        label: 'Title',
        required: true,
        hint: fields.guessed.includes('title')
          ? 'The PDF has no title of its own, so this came from the filename. Correct it here.'
          : 'Read from the PDF.',
      },
      {
        key: 'author',
        label: 'Author',
        hint: fields.guessed.includes('author') ? 'Not in the file — fill it in if you want it on the shelf.' : 'Read from the PDF.',
      },
      { key: 'status', label: 'Status', type: 'select', options: READING_STATUSES, default: 'reading' },
    ],
    values: { title: fields.title, author: fields.author, status: 'reading' },
  });
  if (!values) return;

  const record = makeReading({
    title: values.title,
    author: values.author,
    status: values.status,
    source: 'pdf',
    fileName: file.name,
    fileSize: file.size,
    pageCount: fields.pageCount,
    cover,
    unit: 'page',
    total: fields.pageCount,
    position: 0,
    updatedAt: todayISO(),
  });

  // The bytes go in first. If there is no room, no record is created, so the
  // shelf never shows a book that was never actually stored.
  const stored = await putBook(record.id, file);
  if (!stored.ok) {
    await openDialog({
      title: stored.reason === 'quota' ? 'No room for this book' : 'The book could not be saved',
      body: el('div.stack', [
        el('p.break', { text: stored.message }),
        el('p.field__hint', {
          text: `${file.name} is ${formatBytes(file.size)}. Nothing was added to your shelf, and nothing else in Cairn was changed.`,
        }),
      ]),
      footer: (close) => [el('button.btn', { type: 'button', text: 'Close', onclick: () => close() })],
    });
    return;
  }

  ctx.commit('add book', (state) => { state.reading.push(record); }, { undoable: false });
  toast(`${record.title} added${fields.pageCount ? ` — ${fields.pageCount} pages` : ''}.`);
  ctx.navigate(`#/reading/${record.id}`);
}

// --- the reader -------------------------------------------------------------

// One reader at a time. The token invalidates in-flight page renders when the
// view is rebuilt or another book is opened, so a slow page from the last book
// cannot paint over the new one.
let readerToken = 0;

function renderReader(ctx, book) {
  const token = ++readerToken;

  if (!isPdf(book)) return renderManualBook(ctx, book);

  const canvas = el('canvas.reader__canvas', { 'aria-label': `${book.title}, page view` });
  const stage = el('div.reader__stage', [canvas]);
  const status = el('div.reader__status.mono.faint', { text: 'Opening…' });
  const pageBox = input({
    type: 'number',
    min: '1',
    value: String(openAtPage(book)),
    'aria-label': 'Page number',
    className: 'input--num',
  });
  const total = totalPages(book);
  const totalLabel = el('span.mono.faint', { text: total ? `/ ${total}` : '' });
  const markButton = el('button.btn.btn--sm', { type: 'button', text: 'Bookmark' });
  const marksPanel = el('div.reader__marks', { hidden: true });

  const view = {
    doc: null,
    page: openAtPage(book),
    rendering: false,
    pending: null,
  };

  const alive = () => token === readerToken;

  const drawMarks = () => {
    marksPanel.replaceChildren();
    const list = bookmarks(book);
    marksPanel.appendChild(
      el('div.row.row--between', [
        el('strong', { text: `Bookmarks (${list.length})` }),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Close',
          onclick: () => { marksPanel.hidden = true; },
        }),
      ]),
    );
    if (!list.length) {
      marksPanel.appendChild(el('p.field__hint', { text: 'Nothing marked yet. "Bookmark" marks the page you are on, with an optional note.' }));
      return;
    }
    for (const mark of list) {
      marksPanel.appendChild(
        el('div.row.row--between.mark', [
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: `p. ${mark.page}`,
            'aria-label': `Go to page ${mark.page}`,
            onclick: () => goTo(mark.page),
          }),
          mark.note ? el('span.break.mark__note', { text: mark.note }) : el('span.faint', { text: 'no note' }),
          el('button.btn.btn--ghost.btn--sm.btn--icon', {
            type: 'button',
            text: '✕',
            title: 'Remove this bookmark',
            'aria-label': `Remove the bookmark on page ${mark.page}`,
            onclick: () => {
              ctx.commit('remove bookmark', () => {
                book.bookmarks = book.bookmarks.filter((m) => m.id !== mark.id);
              }, { undoable: false, rerender: false });
              drawMarks();
              syncMarkButton();
            },
          }),
        ]),
      );
    }
  };

  const syncMarkButton = () => {
    const marked = !!bookmarkOn(book, view.page);
    markButton.textContent = marked ? '★ Bookmarked' : 'Bookmark';
    markButton.setAttribute('aria-pressed', String(marked));
  };

  /**
   * Save where we got to, without rebuilding the view under the reader.
   *
   * Written on every page turn rather than on a timer of its own. A debounce
   * here would be a second one stacked on the store's, and the page you were on
   * when you navigated away is exactly the one that would be lost.
   */
  const savePosition = () => {
    ctx.commit('reading position', () => recordPosition(book, view.page, { today: ctx.today }), {
      undoable: false,
      rerender: false,
    });
  };

  const paint = async () => {
    if (!view.doc || !alive()) return;
    if (view.rendering) {
      // Holding the newest request and dropping the ones in between keeps
      // held-down arrow keys from queueing up thirty renders.
      view.pending = view.page;
      return;
    }
    view.rendering = true;
    try {
      const width = Math.max(280, Math.min(stage.clientWidth || 720, 1100));
      await renderCurrent(view.doc, view.page, canvas, width);
      if (!alive()) return;
      status.textContent = `page ${view.page}${total ? ` of ${total}` : ''}`;
    } catch (error) {
      status.textContent = error?.message ?? 'That page could not be drawn.';
    } finally {
      view.rendering = false;
      if (view.pending !== null && alive()) {
        const next = view.pending;
        view.pending = null;
        if (next !== view.page) view.page = next;
        paint();
      }
    }
  };

  const goTo = (page) => {
    const target = clampPage(book, page);
    if (target === view.page) return;
    view.page = target;
    pageBox.value = String(target);
    marksPanel.hidden = true;
    syncMarkButton();
    savePosition();
    paint();
  };

  pageBox.addEventListener('change', () => goTo(Number(pageBox.value)));
  markButton.addEventListener('click', async () => {
    const existing = bookmarkOn(book, view.page);
    if (existing) {
      ctx.commit('remove bookmark', () => {
        book.bookmarks = book.bookmarks.filter((m) => m.id !== existing.id);
      }, { undoable: false, rerender: false });
      syncMarkButton();
      drawMarks();
      toast(`Bookmark removed from page ${view.page}.`);
      return;
    }
    const note = await askForNote(view.page);
    if (note === null) return;
    ctx.commit('add bookmark', () => {
      book.bookmarks.push(makeBookmark({ page: view.page, note }));
    }, { undoable: false, rerender: false });
    syncMarkButton();
    drawMarks();
  });

  // Arrow keys reach here through the shell's key event, so they work without
  // clicking into the page first.
  const onKey = (event) => {
    if (!alive()) {
      document.removeEventListener('cairn:key', onKey);
      return;
    }
    const key = event.detail?.key;
    if (key === 'ArrowRight' || key === 'n') goTo(view.page + 1);
    else if (key === 'ArrowLeft' || key === 'b') goTo(view.page - 1);
  };
  document.addEventListener('cairn:key', onKey);

  const node = el('div.reader', [
    el('a.crumb', { href: '#/reading', text: '← Shelf' }),
    el('div.reader__bar', [
      el('div.row', [
        el('strong.break', { text: book.title }),
        book.author ? el('span.section__meta', { text: book.author }) : null,
      ]),
      el('div.spacer'),
      el('div.row', [
        el('button.btn.btn--sm', {
          type: 'button',
          text: '‹ Prev',
          'aria-label': 'Previous page',
          onclick: () => goTo(view.page - 1),
        }),
        pageBox,
        totalLabel,
        el('button.btn.btn--sm', {
          type: 'button',
          text: 'Next ›',
          'aria-label': 'Next page',
          onclick: () => goTo(view.page + 1),
        }),
        markButton,
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Bookmarks',
          onclick: () => { marksPanel.hidden = !marksPanel.hidden; },
        }),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Save the file',
          'aria-label': 'Save this PDF back to disk',
          onclick: () => saveFile(book),
        }),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Details',
          onclick: () => editBook(ctx, book),
        }),
      ]),
    ]),
    marksPanel,
    status,
    stage,
  ]);

  drawMarks();
  syncMarkButton();
  mountReader(ctx, book, view, alive, status, totalLabel, pageBox, paint);
  return node;
}

async function renderCurrent(doc, page, canvas, cssWidth) {
  const { renderPage } = await import('../pdf.js');
  await renderPage(doc, page, canvas, { cssWidth });
}

async function mountReader(ctx, book, view, alive, status, totalLabel, pageBox, paint) {
  const blob = await getBook(book.id);
  if (!alive()) return;

  if (!blob) {
    status.textContent = '';
    status.replaceChildren(
      el('div.banner.banner--warn', [
        el('div.banner__body', [
          el('div.banner__title', { text: 'The file for this book is not on this device' }),
          el('div.banner__text', {
            text: 'Your place and your bookmarks are safe — they travel in the JSON export. The PDF does not, because it would make that file enormous. Import the same PDF again and it reattaches to this record.',
          }),
        ]),
        reattachButton(ctx, book),
      ]),
    );
    return;
  }

  try {
    const { openDocument } = await import('../pdf.js');
    view.doc = await openDocument(blob);
    if (!alive()) {
      view.doc.destroy();
      return;
    }
  } catch (error) {
    status.textContent = error?.message ?? 'This book could not be opened.';
    return;
  }

  // A file replaced outside Cairn, or a page count that was never read, is
  // corrected here rather than left to clamp the reader to the wrong range.
  if (view.doc.numPages && view.doc.numPages !== book.pageCount) {
    ctx.commit('page count', () => {
      book.pageCount = view.doc.numPages;
      book.total = view.doc.numPages;
    }, { undoable: false, rerender: false });
    totalLabel.textContent = `/ ${view.doc.numPages}`;
    pageBox.max = String(view.doc.numPages);
  }

  view.page = clampPage(book, view.page);
  pageBox.value = String(view.page);
  await paint();
}

function reattachButton(ctx, book) {
  const picker = el('input', {
    type: 'file',
    accept: 'application/pdf,.pdf',
    style: { display: 'none' },
    'aria-label': 'Choose the file again',
    onchange: async (event) => {
      const file = event.target.files?.[0];
      picker.value = '';
      if (!file) return;
      const stored = await putBook(book.id, file);
      if (!stored.ok) {
        toast(stored.message, { variant: 'danger', timeout: 12000 });
        return;
      }
      ctx.commit('reattach book file', () => {
        book.fileName = file.name;
        book.fileSize = file.size;
        book.source = 'pdf';
      }, { undoable: false });
      toast('File reattached — your place and bookmarks are as you left them.');
    },
  });
  return el('span', [
    picker,
    el('button.btn.btn--sm', { type: 'button', text: 'Find the file', onclick: () => picker.click() }),
  ]);
}

function askForNote(page) {
  const box = input({ placeholder: 'Why this page? (optional)', 'aria-label': 'Bookmark note' });
  return openDialog({
    title: `Bookmark page ${page}`,
    body: el('div.stack', [box, el('p.field__hint', { text: 'The note is what makes the bookmark findable six months later.' })]),
    footer: (close) => [
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      el('button.btn.btn--primary', { type: 'button', text: 'Mark it', onclick: () => close(box.value.trim()) }),
    ],
  });
}

// --- a book with no file ----------------------------------------------------

function renderManualBook(ctx, book) {
  const total = totalPages(book);
  const position = input({
    type: 'number',
    min: '0',
    value: String(book.position ?? 0),
    'aria-label': 'Current position',
    className: 'input--num',
  });
  position.addEventListener('change', () => {
    ctx.commit('reading position', () => recordPosition(book, Number(position.value), { today: ctx.today }), {
      undoable: false,
    });
  });

  return el('div', [
    el('a.crumb', { href: '#/reading', text: '← Shelf' }),
    pageHead(book.title, {
      sub: `${book.author || 'No author recorded'} · tracked by hand`,
      actions: [el('button.btn', { type: 'button', text: 'Details', onclick: () => editBook(ctx, book) })],
    }),
    el('div.card', [
      el('div.card__body.stack', [
        meter(progress(book), book.status === 'finished' ? 'complete' : ''),
        el('div.row', [
          el('span.field__label', { text: book.unit === 'percent' ? 'Percent read' : 'Page' }),
          position,
          total ? el('span.mono.faint', { text: `of ${total}` }) : null,
          tag(book.status, statusVariant(book.status)),
        ]),
        book.notes ? el('p.muted.break', { text: book.notes }) : null,
        el('p.field__hint', {
          text: 'This book has no file. Import the PDF from the shelf to read it here instead of typing the page number.',
        }),
      ]),
    ]),
  ]);
}

// --- editing ----------------------------------------------------------------

async function editBook(ctx, book) {
  const isNew = !book;
  const values = await editRecord({
    title: isNew ? 'Track a book' : 'Book',
    submitLabel: isNew ? 'Add' : 'Save',
    deletable: !isNew,
    fields: [
      { key: 'title', label: 'Title', required: true },
      { key: 'author', label: 'Author' },
      { key: 'status', label: 'Status', type: 'select', options: READING_STATUSES, default: 'reading' },
      ...(isPdf(book)
        ? []
        : [
            { key: 'unit', label: 'Track by', type: 'select', options: ['page', 'percent'], default: 'page' },
            { key: 'position', label: 'Current position', type: 'number', default: 0 },
            { key: 'total', label: 'Total pages', type: 'number' },
          ]),
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 4 },
    ],
    values: book ?? {},
  });
  if (!values) return;

  if (values.__delete) {
    await deleteBookRecord(ctx, book);
    return;
  }

  if (isNew) {
    ctx.commit('add book', (state) => {
      state.reading.push(makeReading({ ...values, position: Number(values.position) || 0, updatedAt: todayISO() }));
    }, { undoable: false });
    return;
  }

  ctx.commit('edit book', () => {
    Object.assign(book, values, { updatedAt: todayISO() });
    if (isPdf(book)) book.position = clampPage(book, book.position || 1);
    else book.position = Number(values.position) || 0;
  }, { undoable: false });
}

async function deleteBookRecord(ctx, book) {
  const hasFile = isPdf(book);
  const answer = await confirm({
    title: 'Remove this book?',
    message: hasFile
      ? `"${book.title}" — the record, your place and ${book.bookmarks?.length ?? 0} bookmark(s) go, and the ${formatBytes(book.fileSize)} file is deleted from this browser. Deleting only the file keeps everything else and frees the space.`
      : `"${book.title}" and its notes will be removed. This can be undone.`,
    confirmLabel: 'Remove everything',
    extraLabel: hasFile ? 'Delete the file only' : null,
  });
  if (!answer) return;

  if (answer === 'extra') {
    await deleteBook(book.id);
    // `source` stays 'pdf': the record still refers to a PDF, it just is not on
    // this device any more. That is what makes it show up as missing and what
    // lets the same file be reattached later.
    ctx.commit('delete book file', () => {
      book.fileSize = 0;
      book.fileName = '';
      book.cover = null;
    }, { undoable: false });
    toast('The file is gone. Your place and bookmarks are still here, and importing the PDF again reattaches it.');
    ctx.navigate('#/reading');
    return;
  }

  await deleteBook(book.id);
  ctx.commit('delete book', (state) => {
    const index = state.reading.findIndex((b) => b.id === book.id);
    if (index >= 0) state.reading.splice(index, 1);
  });
  ctx.navigate('#/reading');
}

// --- getting the files back out ---------------------------------------------

/**
 * The other half of being honest about export. Saying "the PDFs are not in the
 * JSON" is only fair if there is a way to get them, so every book can be saved
 * back to disk exactly as it came in.
 */
async function saveFile(book) {
  const blob = await getBook(book.id);
  if (!blob) {
    toast('There is no file here to save.', { variant: 'danger' });
    return false;
  }
  const name = book.fileName || `${book.title.replace(/[^\w\d -]+/g, '') || 'book'}.pdf`;
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: name });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

async function saveEveryFile(ctx) {
  const books = (ctx.state.reading ?? []).filter(isPdf);
  if (!books.length) {
    toast('There are no book files to save.');
    return;
  }
  let saved = 0;
  for (const book of books) {
    // eslint-disable-next-line no-await-in-loop -- browsers rate-limit bursts of downloads
    if (await saveFile(book)) saved += 1;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 400); });
  }
  toast(`${saved} of ${books.length} book file(s) saved. Keep them with your JSON backup — the two together are the whole library.`, { timeout: 12000 });
}
