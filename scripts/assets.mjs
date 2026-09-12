// Static asset resolution, shared by the dev server and the desktop shell.
//
// Both take a URL path from an untrusted-ish caller (a browser, a renderer
// process) and turn it into a file inside the project. Getting the traversal
// guard right once, in a unit-tested place, beats getting it right twice.

import { extname, join, normalize, resolve, sep } from 'node:path';

export const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export function contentTypeFor(file) {
  return CONTENT_TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
}

/**
 * Resolve a URL path to an absolute file path inside `root`, or null if it
 * escapes, is malformed, or names nothing.
 *
 * Existence is deliberately not checked: the caller is about to read the file
 * anyway, and a stat here would only be a race with that read.
 *
 * @param {string} root      project directory
 * @param {string} urlPath   a request path, with or without query and hash
 * @returns {string|null}
 */
export function resolveAsset(root, urlPath) {
  const base = resolve(root);

  let clean;
  try {
    clean = decodeURIComponent(String(urlPath ?? '').split('?')[0].split('#')[0]);
  } catch {
    // A malformed percent-escape. Nothing sane is being asked for.
    return null;
  }
  // A NUL truncates the path in some syscalls, so a name containing one is not
  // the name that was checked.
  if (clean.includes('\0')) return null;

  if (clean === '' || clean.endsWith('/')) clean += 'index.html';

  // normalize() collapses `..` that stays inside the path; the leading ones it
  // cannot collapse are stripped, and the containment check below is the
  // backstop for anything either misses.
  const rel = normalize(clean).replace(/^([/\\]|\.\.([/\\]|$))+/, '');
  if (rel === '' || rel === '.') return null;

  const file = join(base, rel);
  if (file !== base && !file.startsWith(base + sep)) return null;
  return file;
}
