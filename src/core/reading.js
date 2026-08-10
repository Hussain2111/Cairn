// Reading: the logic behind the shelf and the reader.
//
// Nothing here touches the DOM, IndexedDB or pdf.js, so all of it is testable
// without a browser. The file bytes live in IndexedDB; what a book record holds
// is where you got to, what you marked, and enough about the file to say
// honestly whether it is still here.

import { todayISO } from './dates.js';
import { READING_STATUSES } from './schema.js';

/** Shelf order: what you are reading now, then the rest, then what is done. */
const STATUS_ORDER = ['reading', 'to read', 'paused', 'finished', 'abandoned'];

export function shelfOrder(state) {
  return [...(state?.reading ?? [])].sort((a, b) => {
    const byStatus = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (byStatus) return byStatus;
    // Most recently opened first inside a status, so picking up where you left
    // off is the first thing on the shelf.
    const opened = String(b.lastOpenedAt ?? '').localeCompare(String(a.lastOpenedAt ?? ''));
    return opened || String(a.title).localeCompare(String(b.title));
  });
}

export function bookById(state, id) {
  return (state?.reading ?? []).find((b) => b.id === id) ?? null;
}

export function isPdf(book) {
  return book?.source === 'pdf';
}

/** Pages in the file, or the hand-entered total, or nothing. */
export function totalPages(book) {
  const count = Number(book?.pageCount);
  if (Number.isFinite(count) && count > 0) return count;
  const total = Number(book?.total);
  return Number.isFinite(total) && total > 0 ? total : null;
}

export function progress(book) {
  if (book?.unit === 'percent') return Math.max(0, Math.min(1, (Number(book.position) || 0) / 100));
  const total = totalPages(book);
  if (!total) return 0;
  return Math.max(0, Math.min(1, (Number(book?.position) || 0) / total));
}

/** Keep a page inside the book. Page numbers are 1-based; 0 means "not started". */
export function clampPage(book, page) {
  const total = totalPages(book);
  const n = Math.round(Number(page));
  if (!Number.isFinite(n)) return 1;
  if (!total) return Math.max(1, n);
  return Math.min(total, Math.max(1, n));
}

/** The page to open at. A book never read opens at the first page, not page 0. */
export function openAtPage(book) {
  const position = Number(book?.position) || 0;
  return position >= 1 ? clampPage(book, position) : 1;
}

/**
 * Record where you got to. Reaching the last page marks the book finished,
 * because otherwise nothing ever does and the shelf fills with books that are
 * done but still say "reading".
 */
export function recordPosition(book, page, { today = todayISO() } = {}) {
  const total = totalPages(book);
  book.position = clampPage(book, page);
  book.updatedAt = today;
  book.lastOpenedAt = today;
  if (book.status === 'to read') book.status = 'reading';
  if (total && book.position >= total && book.status === 'reading') book.status = 'finished';
  return book;
}

// --- bookmarks --------------------------------------------------------------

export function bookmarks(book) {
  return [...(book?.bookmarks ?? [])].sort((a, b) => (Number(a.page) || 0) - (Number(b.page) || 0));
}

export function bookmarkOn(book, page) {
  return (book?.bookmarks ?? []).find((mark) => Number(mark.page) === Number(page)) ?? null;
}

// --- what the file is called ------------------------------------------------

// Download sites bolt their own name onto the filename. Stripping it is not
// cosmetic: it is the difference between a shelf you can read and one full of
// "(z-lib.org)".
const FILENAME_NOISE = [
  /\(\s*z-?lib(rary)?\.?(org)?\s*\)/gi,
  /\[\s*z-?lib(rary)?\.?(org)?\s*\]/gi,
  /\(\s*pdfdrive(\.com)?\s*\)/gi,
  /\(\s*annas?-archive[^)]*\)/gi,
  /\b(ebook|epub|pdf|retail|scan|ocr)\b/gi,
];

/** A readable title from a filename, for when the PDF metadata is empty. */
export function titleFromFilename(filename) {
  let name = String(filename ?? '').split(/[/\\]/).pop() ?? '';
  name = name.replace(/\.pdf$/i, '');
  for (const pattern of FILENAME_NOISE) name = name.replace(pattern, ' ');
  name = name.replace(/[_+]+/g, ' ').replace(/\s*-\s*/g, ' - ').replace(/\s{2,}/g, ' ').trim();
  name = name.replace(/^[-–—\s]+|[-–—\s]+$/g, '');
  if (!name) return 'Untitled';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Capitalised words, no digits, no lowercase connectives: "Kent Beck",
// "Ursula K Le Guin". A title made only of capitalised words -- "Test Driven
// Development" -- passes this too, which is what the tie-breakers below are for.
const LOOKS_LIKE_A_NAME = /^[A-Z][a-z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]*){0,3}$/;
const STARTS_WITH_ARTICLE = /^(the|a|an)\s/i;

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

/**
 * "Kent Beck - Test Driven Development.pdf" is a common shape, and so is the
 * reverse. The split is only made when one half is recognisably a person's
 * name; otherwise the whole string stays in the title, where being wrong costs
 * one edit instead of putting a chapter heading in the author field.
 */
export function splitFilename(filename) {
  const cleaned = titleFromFilename(filename);
  const parts = cleaned.split(' - ').map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return { title: cleaned, author: '' };

  const [left, right] = parts;
  const leftIsName = LOOKS_LIKE_A_NAME.test(left);
  const rightIsName = LOOKS_LIKE_A_NAME.test(right);

  if (leftIsName && !rightIsName) return { title: right, author: left };
  if (rightIsName && !leftIsName) return { title: left, author: right };
  if (!leftIsName && !rightIsName) return { title: cleaned, author: '' };

  // Both halves pass, so something has to break the tie.
  // An article all but settles it: books begin "The …", people do not.
  const leftArticle = STARTS_WITH_ARTICLE.test(left);
  const rightArticle = STARTS_WITH_ARTICLE.test(right);
  if (leftArticle !== rightArticle) {
    return leftArticle ? { title: left, author: right } : { title: right, author: left };
  }

  // Failing that, the shorter half is the name: titles run longer than people.
  const leftWords = wordCount(left);
  const rightWords = wordCount(right);
  if (leftWords !== rightWords) {
    return leftWords < rightWords ? { title: right, author: left } : { title: left, author: right };
  }

  // Same shape on both sides, so it is a coin flip and it does not call it.
  return { title: cleaned, author: '' };
}

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * Work out title, author and page count from what pdf.js could read, falling
 * back to the filename — which is usually all there is, because PDF metadata is
 * empty far more often than not.
 *
 * @param {{info?: object, pageCount?: number}} parsed
 * @param {string} filename
 */
export function fieldsFromPdf(parsed, filename) {
  const info = parsed?.info ?? {};
  const fromName = splitFilename(filename);

  let title = clean(info.Title);
  // Some producers write the filename, or a temp path, into the Title field.
  if (/\.(pdf|docx?|tex|indd)$/i.test(title) || /^untitled$/i.test(title)) title = '';

  const author = clean(info.Author);
  const guessed = [];
  if (!title) guessed.push('title');
  if (!author) guessed.push('author');

  return {
    title: title || fromName.title,
    author: author || fromName.author,
    pageCount: Number.isFinite(parsed?.pageCount) && parsed.pageCount > 0 ? parsed.pageCount : null,
    // Which fields came from the filename rather than the file, so the import
    // dialog can say what it guessed instead of pretending it knew.
    guessed,
  };
}

// --- the library as a whole -------------------------------------------------

export function libraryBytes(state) {
  return (state?.reading ?? []).reduce((total, book) => total + (Number(book.fileSize) || 0), 0);
}

/**
 * Records whose file is not on this device. This happens after an import: the
 * JSON carries the shelf, the reading positions and the bookmarks, but not the
 * books themselves.
 */
export function booksMissingFiles(state, storedIds) {
  const stored = storedIds instanceof Set ? storedIds : new Set(storedIds ?? []);
  return (state?.reading ?? []).filter((book) => isPdf(book) && !stored.has(book.id));
}

export function statusVariant(status) {
  if (status === 'finished') return 'teal';
  if (status === 'abandoned' || status === 'paused') return 'locked';
  return '';
}

export function isValidStatus(status) {
  return READING_STATUSES.includes(status);
}
