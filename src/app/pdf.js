// The pdf.js adapter.
//
// pdf.js is vendored under /vendor/pdfjs because the published site blocks
// external hosts (see vendor/pdfjs/README.md for the licence note). It is a
// couple of megabytes, so it is imported dynamically: someone who never opens
// a book never downloads it.
//
// Everything here returns plain values or throws a message worth showing. No
// pdf.js object escapes this module except the document handle, which the
// reader holds for as long as a book is open.

const VENDOR = '../../vendor/pdfjs/';

let libPromise = null;

/** Load pdf.js once, and point it at the worker and font data next to it. */
export function pdfjs() {
  if (libPromise) return libPromise;
  libPromise = import(/* @vite-ignore */ new URL(`${VENDOR}pdf.mjs`, import.meta.url).href)
    .then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL(`${VENDOR}pdf.worker.mjs`, import.meta.url).href;
      return lib;
    });
  libPromise.catch(() => { libPromise = null; });
  return libPromise;
}

const assetUrls = () => ({
  // Trailing slashes matter: pdf.js appends a filename to each of these.
  standardFontDataUrl: new URL(`${VENDOR}standard_fonts/`, import.meta.url).href,
  cMapUrl: new URL(`${VENDOR}cmaps/`, import.meta.url).href,
  cMapPacked: true,
});

/**
 * Open a PDF from bytes.
 *
 * pdf.js takes ownership of the buffer it is handed and detaches it, so the
 * caller's copy would silently become a zero-length array. It is copied here
 * rather than leaving that as a trap for the next caller.
 */
export async function openDocument(source) {
  const lib = await pdfjs();
  const bytes = source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : new Uint8Array(source);
  const task = lib.getDocument({ data: bytes.slice(), ...assetUrls() });
  try {
    return await task.promise;
  } catch (error) {
    throw new Error(describe(error));
  }
}

function describe(error) {
  const name = error?.name ?? '';
  if (name === 'PasswordException') return 'This PDF is password-protected, and Cairn cannot open it.';
  if (name === 'InvalidPDFException') return 'This file is not a PDF that can be read — it may be damaged.';
  if (name === 'MissingPDFException') return 'The file could not be found.';
  return error?.message ? `The PDF could not be opened: ${error.message}` : 'The PDF could not be opened.';
}

/** Title, author and page count, as far as the file admits to them. */
export async function readMetadata(doc) {
  let info = {};
  try {
    const meta = await doc.getMetadata();
    info = meta?.info ?? {};
  } catch {
    // Metadata is optional and frequently malformed. A file with none still
    // opens; the filename supplies the title.
    info = {};
  }
  return { info, pageCount: doc?.numPages ?? 0 };
}

/**
 * Draw a page onto a canvas at the given CSS width, accounting for the device
 * pixel ratio so text is not blurred on a retina screen.
 *
 * @returns {{width:number, height:number}} the CSS size that was drawn
 */
export async function renderPage(doc, pageNumber, canvas, { cssWidth, maxScale = 3 } = {}) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxScale, Math.max(0.1, cssWidth / base.width));
  const viewport = page.getViewport({ scale });
  const ratio = Math.min(3, window.devicePixelRatio || 1);

  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const context = canvas.getContext('2d', { alpha: false });
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  // Pages are drawn onto an opaque white ground rather than the page
  // background: a scanned page with no white of its own would otherwise show
  // the app's dark theme through it.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, viewport.width, viewport.height);

  const task = page.render({ canvasContext: context, viewport });
  try {
    await task.promise;
  } finally {
    page.cleanup();
  }
  return { width: Math.floor(viewport.width), height: Math.floor(viewport.height) };
}

/**
 * The first page, small, as a JPEG data URL — the cover on the shelf.
 *
 * It is kept deliberately small because it lives in localStorage with the rest
 * of the record: at 240px wide and quality 0.7 a cover is roughly 10–20 KB, so
 * a shelf of thirty books costs well under a megabyte.
 */
export async function renderCover(doc, { width = 240, quality = 0.7 } = {}) {
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    page.cleanup();
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    // A cover is a nicety. A book with no thumbnail still shelves and opens.
    return null;
  }
}

/** Text of one page, for search inside a book. */
export async function pageText(doc, pageNumber) {
  try {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    page.cleanup();
    return content.items.map((item) => item.str).join(' ');
  } catch {
    return '';
  }
}
