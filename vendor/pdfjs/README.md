# pdf.js, vendored

Cairn renders PDFs in the browser with [pdf.js](https://mozilla.github.io/pdf.js/)
from Mozilla. The published site sets a strict Content-Security-Policy that
blocks every external host, so the library is committed here rather than pulled
from a CDN at run time. Nothing in this directory is written by Cairn.

**Version:** see `VERSION` (`pdfjs-dist` on npm).

**Licence:** Apache License 2.0 — the full text is in `LICENSE`. Apache-2.0 is
a permissive licence and is compatible with Cairn's MIT licence: it allows
redistribution in source form provided the licence text and any attribution
notices travel with it, which is what this directory does. It adds no copyleft
obligation on Cairn's own code. The bundled fonts under `standard_fonts/` carry
their own notices (`LICENSE_FOXIT`, `LICENSE_LIBERATION`) and are kept
alongside them.

## What is here, and why

| Path | Why it is needed |
| --- | --- |
| `pdf.mjs` | The library itself (the minified ES-module build). |
| `pdf.worker.mjs` | Parsing and rasterising run in a worker so the interface stays responsive on a 600-page book. |
| `standard_fonts/` | The fourteen standard PDF fonts. A document that references Helvetica without embedding it renders with the wrong metrics — or not at all — when these are missing. |
| `cmaps/` | Character maps for CJK encodings. Without them a Japanese or Chinese PDF renders as blank glyphs. |

`pdf.mjs.map`, the sandbox build (for embedded JavaScript in forms), the image
decoders and the prebuilt viewer are deliberately **not** vendored — Cairn
draws pages onto its own canvas and never runs a PDF's scripts.

## Updating

```bash
npm pack pdfjs-dist@<version>
tar xzf pdfjs-dist-<version>.tgz
cp package/build/pdf.min.mjs        vendor/pdfjs/pdf.mjs
cp package/build/pdf.worker.min.mjs vendor/pdfjs/pdf.worker.mjs
cp package/LICENSE                  vendor/pdfjs/LICENSE
cp -r package/standard_fonts/.      vendor/pdfjs/standard_fonts/
cp -r package/cmaps/.               vendor/pdfjs/cmaps/
echo "<version>" > vendor/pdfjs/VERSION
```

Then re-check the licence in the new release before committing, and run the
reading end-to-end tests.
