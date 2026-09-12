// The dev server and the desktop shell both turn a request path into a file on
// disk. These are the cases where getting that wrong would matter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { contentTypeFor, resolveAsset } from '../../scripts/assets.mjs';

const ROOT = '/srv/cairn';

test('serves the shell for the bare root and for directories', () => {
  assert.equal(resolveAsset(ROOT, '/'), join(ROOT, 'index.html'));
  assert.equal(resolveAsset(ROOT, ''), join(ROOT, 'index.html'));
  assert.equal(resolveAsset(ROOT, '/portfolio/'), join(ROOT, 'portfolio', 'index.html'));
});

test('resolves ordinary assets', () => {
  assert.equal(resolveAsset(ROOT, '/src/app/main.js'), join(ROOT, 'src', 'app', 'main.js'));
  assert.equal(resolveAsset(ROOT, '/styles/tokens.css'), join(ROOT, 'styles', 'tokens.css'));
});

test('query and hash are not part of the filename', () => {
  assert.equal(resolveAsset(ROOT, '/index.html?v=3'), join(ROOT, 'index.html'));
  assert.equal(resolveAsset(ROOT, '/index.html#/today'), join(ROOT, 'index.html'));
});

test('percent-escapes are decoded', () => {
  assert.equal(resolveAsset(ROOT, '/vendor/fflate/fflate.mjs'), join(ROOT, 'vendor', 'fflate', 'fflate.mjs'));
  assert.equal(resolveAsset(ROOT, '/a%20b.js'), join(ROOT, 'a b.js'));
});

test('no request escapes the project directory', () => {
  const outside = [
    '/../secrets.json',
    '../../etc/passwd',
    '/a/../../../etc/passwd',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/....//....//etc/passwd',
    '/..',
  ];
  for (const path of outside) {
    const file = resolveAsset(ROOT, path);
    assert.ok(
      file === null || file.startsWith(ROOT + '/'),
      `${path} resolved outside the root: ${file}`,
    );
  }
});

test('malformed and hostile paths are refused outright', () => {
  assert.equal(resolveAsset(ROOT, '/bad%ZZ'), null);
  assert.equal(resolveAsset(ROOT, '/a\0b.js'), null);
  assert.equal(resolveAsset(ROOT, null), join(ROOT, 'index.html'));
});

test('content types cover every asset the app ships', () => {
  assert.equal(contentTypeFor('/x/index.html'), 'text/html; charset=utf-8');
  assert.equal(contentTypeFor('main.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('fflate.mjs'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('tokens.css'), 'text/css; charset=utf-8');
  assert.equal(contentTypeFor('favicon.SVG'), 'image/svg+xml');
  assert.equal(contentTypeFor('manifest.webmanifest'), 'application/manifest+json');
  assert.equal(contentTypeFor('notes.txt'), 'application/octet-stream');
});
