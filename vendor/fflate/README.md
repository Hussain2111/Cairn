# fflate

Vendored, not fetched from a CDN: Cairn is a static site with no build step and
no network dependency, and a spreadsheet importer that stops working because
someone else's CDN is down is worse than no importer.

- **Version:** 0.8.2
- **Licence:** MIT (see `LICENSE`) — permits use, modification and
  redistribution provided the copyright notice and licence text travel with it,
  which is why both are in this directory.
- **Upstream:** https://github.com/101arrowz/fflate
- **File:** `fflate.mjs` is the package's `esm/browser.js` build, unmodified.

## Why it is here

An `.xlsx` file is a ZIP archive of XML. Reading one means inflating it first,
and DEFLATE is not something to hand-roll. Only `unzipSync` is used, from
`src/core/xlsx.js`; the CSV path does not touch this file at all.
