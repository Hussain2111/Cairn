import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shelfOrder,
  totalPages,
  progress,
  clampPage,
  openAtPage,
  recordPosition,
  bookmarks,
  bookmarkOn,
  titleFromFilename,
  splitFilename,
  fieldsFromPdf,
  libraryBytes,
  booksMissingFiles,
  isPdf,
} from '../../src/core/reading.js';
import { createEmptyState, makeReading, makeBookmark } from '../../src/core/schema.js';

const TODAY = '2026-08-07';

const pdf = (patch) => makeReading({ source: 'pdf', unit: 'page', ...patch });

// --- position ---------------------------------------------------------------

test('a page is clamped to the book it is in', () => {
  const book = pdf({ pageCount: 300 });
  assert.equal(clampPage(book, 1), 1);
  assert.equal(clampPage(book, 300), 300);
  assert.equal(clampPage(book, 0), 1, 'there is no page zero');
  assert.equal(clampPage(book, -5), 1);
  assert.equal(clampPage(book, 4000), 300);
  assert.equal(clampPage(book, 'nonsense'), 1);
  assert.equal(clampPage(book, 12.6), 13);
});

test('a book with no known page count is not clamped upwards', () => {
  const book = pdf({ pageCount: null, total: null });
  assert.equal(totalPages(book), null);
  assert.equal(clampPage(book, 900), 900);
  assert.equal(clampPage(book, 0), 1);
});

test('a book never opened opens at the first page, not page zero', () => {
  assert.equal(openAtPage(pdf({ pageCount: 100, position: 0 })), 1);
  assert.equal(openAtPage(pdf({ pageCount: 100, position: 42 })), 42);
  assert.equal(openAtPage(pdf({ pageCount: 30, position: 900 })), 30, 'a stale position is brought back inside');
});

test('recording a position moves a to-read book into reading', () => {
  const book = pdf({ pageCount: 200, status: 'to read' });
  recordPosition(book, 12, { today: TODAY });
  assert.equal(book.position, 12);
  assert.equal(book.status, 'reading');
  assert.equal(book.lastOpenedAt, TODAY);
  assert.equal(book.updatedAt, TODAY);
});

test('reaching the last page finishes the book', () => {
  const book = pdf({ pageCount: 200, status: 'reading' });
  recordPosition(book, 199, { today: TODAY });
  assert.equal(book.status, 'reading');
  recordPosition(book, 200, { today: TODAY });
  assert.equal(book.status, 'finished');
});

test('an abandoned book is not quietly revived by scrolling to the end', () => {
  const book = pdf({ pageCount: 200, status: 'abandoned' });
  recordPosition(book, 200, { today: TODAY });
  assert.equal(book.status, 'abandoned', 'only a book being read finishes itself');
});

test('progress works for pages and for percent', () => {
  assert.equal(progress(pdf({ pageCount: 200, position: 50 })), 0.25);
  assert.equal(progress(makeReading({ unit: 'percent', position: 40 })), 0.4);
  assert.equal(progress(makeReading({ unit: 'percent', position: 400 })), 1, 'never over a whole');
  assert.equal(progress(pdf({ pageCount: null, position: 12 })), 0, 'unknown length is not a fraction');
});

// --- bookmarks --------------------------------------------------------------

test('bookmarks come back in page order regardless of when they were made', () => {
  const book = pdf({ pageCount: 300 });
  book.bookmarks = [makeBookmark({ page: 120 }), makeBookmark({ page: 12, note: 'the proof' }), makeBookmark({ page: 60 })];
  assert.deepEqual(bookmarks(book).map((m) => m.page), [12, 60, 120]);
  assert.equal(bookmarkOn(book, 12).note, 'the proof');
  assert.equal(bookmarkOn(book, 13), null);
});

// --- what a file is called --------------------------------------------------

test('a filename becomes a readable title', () => {
  assert.equal(titleFromFilename('the-pragmatic-programmer.pdf'), 'The - pragmatic - programmer');
  assert.equal(titleFromFilename('Structure_and_Interpretation.pdf'), 'Structure and Interpretation');
  assert.equal(titleFromFilename('/downloads/Deep Work.PDF'), 'Deep Work');
  assert.equal(titleFromFilename(''), 'Untitled');
  assert.equal(titleFromFilename('.pdf'), 'Untitled');
});

test('download-site noise is stripped out of the title', () => {
  assert.equal(titleFromFilename('Thinking Fast and Slow (Z-Library).pdf'), 'Thinking Fast and Slow');
  assert.equal(titleFromFilename('Some Book (z-lib.org).pdf'), 'Some Book');
  assert.equal(titleFromFilename('Another Book (PDFDrive).pdf'), 'Another Book');
});

test('an author is only split off the filename when it actually looks like a name', () => {
  assert.deepEqual(splitFilename('Kent Beck - Test Driven Development.pdf'), {
    title: 'Test Driven Development',
    author: 'Kent Beck',
  });
  assert.deepEqual(splitFilename('Test Driven Development - Kent Beck.pdf'), {
    title: 'Test Driven Development',
    author: 'Kent Beck',
  });

  // Neither half is a name: guessing would be a coin flip, so it does not.
  const chapter = splitFilename('Chapter 1 - Introduction to compilers.pdf');
  assert.equal(chapter.author, '');
  assert.ok(chapter.title.includes('Chapter 1'));

  // Both halves are capitalised words, so the tie-breakers have to decide.
  assert.deepEqual(splitFilename('Ursula K Le Guin - The Dispossessed.pdf'), {
    title: 'The Dispossessed',
    author: 'Ursula K Le Guin',
  }, 'books begin "The", people do not');

  // Same shape on both sides: a coin flip, so it does not call it.
  assert.equal(splitFilename('Steady State - Rolling Thunder.pdf').author, '');

  // Three sections is not a shape worth guessing at either.
  assert.equal(splitFilename('A - B - C.pdf').author, '');
});

test('PDF metadata wins over the filename, and what was guessed is reported', () => {
  const fromFile = fieldsFromPdf(
    { info: { Title: 'Gödel, Escher, Bach', Author: 'Douglas Hofstadter' }, pageCount: 777 },
    'geb-scan-1979.pdf',
  );
  assert.equal(fromFile.title, 'Gödel, Escher, Bach');
  assert.equal(fromFile.author, 'Douglas Hofstadter');
  assert.equal(fromFile.pageCount, 777);
  assert.deepEqual(fromFile.guessed, [], 'nothing was guessed');
});

test('empty metadata falls back to the filename and says so', () => {
  const guessed = fieldsFromPdf({ info: {}, pageCount: 320 }, 'Kent Beck - Test Driven Development.pdf');
  assert.equal(guessed.title, 'Test Driven Development');
  assert.equal(guessed.author, 'Kent Beck');
  assert.deepEqual(guessed.guessed, ['title', 'author']);
});

test('metadata that is really just the filename is ignored', () => {
  // Word and LaTeX both do this, constantly.
  const fromWord = fieldsFromPdf({ info: { Title: 'thesis-final-v3.docx' }, pageCount: 90 }, 'A Theory of Everything.pdf');
  assert.equal(fromWord.title, 'A Theory of Everything');
  assert.ok(fromWord.guessed.includes('title'));

  const untitled = fieldsFromPdf({ info: { Title: 'Untitled' }, pageCount: 5 }, 'Real Title.pdf');
  assert.equal(untitled.title, 'Real Title');
});

test('a page count that makes no sense is treated as unknown', () => {
  assert.equal(fieldsFromPdf({ info: {}, pageCount: 0 }, 'x.pdf').pageCount, null);
  assert.equal(fieldsFromPdf({ info: {} }, 'x.pdf').pageCount, null);
});

// --- the shelf --------------------------------------------------------------

test('the shelf leads with what is being read, most recently opened first', () => {
  const state = createEmptyState([]);
  state.reading.push(
    makeReading({ title: 'Finished thing', status: 'finished' }),
    makeReading({ title: 'Older open book', status: 'reading', lastOpenedAt: '2026-07-01' }),
    makeReading({ title: 'On the pile', status: 'to read' }),
    makeReading({ title: 'Yesterday', status: 'reading', lastOpenedAt: '2026-08-06' }),
  );
  assert.deepEqual(shelfOrder(state).map((b) => b.title), [
    'Yesterday',
    'Older open book',
    'On the pile',
    'Finished thing',
  ]);
});

test('the library size adds up the files, not the records', () => {
  const state = createEmptyState([]);
  state.reading.push(
    pdf({ title: 'A', fileSize: 1024 }),
    pdf({ title: 'B', fileSize: 2048 }),
    makeReading({ title: 'Hand-tracked' }),
  );
  assert.equal(libraryBytes(state), 3072);
});

test('a record whose file is not on this device is named, not hidden', () => {
  const state = createEmptyState([]);
  const here = pdf({ title: 'Here' });
  const gone = pdf({ title: 'Imported from the laptop' });
  const manual = makeReading({ title: 'Never had a file' });
  state.reading.push(here, gone, manual);

  const missing = booksMissingFiles(state, new Set([here.id]));
  assert.deepEqual(missing.map((b) => b.title), ['Imported from the laptop']);
  assert.equal(isPdf(manual), false, 'a hand-tracked book is not missing anything');
  assert.deepEqual(booksMissingFiles(state, [here.id, gone.id]), []);
});
