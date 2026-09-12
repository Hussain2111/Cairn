#!/usr/bin/env node
// Minimal dependency-free static file server. Used for local development and
// as the Playwright webServer. ES modules need a real origin, so opening
// index.html from the filesystem will not work -- serve it instead.
//
// The desktop shell serves the same files over a custom protocol; the path
// resolution both rely on lives in ./assets.mjs.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentTypeFor, resolveAsset } from './assets.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 4321);

async function resolveFile(urlPath) {
  let file = resolveAsset(ROOT, urlPath);
  if (!file) return null;
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
  } catch {
    return null;
  }
  return file;
}

const server = createServer(async (req, res) => {
  const file = await resolveFile(req.url || '/');
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': contentTypeFor(file),
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`cairn serving ${ROOT} on http://127.0.0.1:${PORT}\n`);
});
